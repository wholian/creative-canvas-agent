/**
 * chatGraph.js
 * 
 * LangGraph state graph for the chat agent.
 * Defines the workflow: receives messages → processes with LLM → returns response.
 * 
 * NOTE: This is a simple conversational agent. If more complex multi-step
 * workflows, tool usage, or agent loops are needed, consider converting
 * to Python LangGraph which has a more mature ecosystem.
 */

import { StateGraph, MessagesAnnotation, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";
import OpenAI from "openai";
import { CHAT_AGENT_SYSTEM_PROMPT, TOPIC_GENERATION_PROMPT } from "../prompts/system.js";

// ============================================================================
// MODEL CONFIGURATION
// ============================================================================

/**
 * A third-party gateway can expose an OpenAI-compatible Chat Completions API.
 * Its base URL must be the API root (for example https://gateway.example/v1),
 * not a full /chat/completions URL.
 */
function normalizeOpenAIBaseUrl(baseUrl) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    if (normalized.endsWith("/chat/completions")) {
        return normalized.slice(0, -"/chat/completions".length);
    }
    if (normalized.endsWith("/messages")) {
        throw new Error("GEMINI_BASE_URL must point to an OpenAI-compatible API root ending in /v1, not an Anthropic /messages endpoint.");
    }
    return normalized;
}

function toOpenAIMessage(message) {
    const type = message._getType?.();
    return {
        role: type === "system" ? "system" : type === "ai" ? "assistant" : "user",
        content: message.content,
    };
}

function toGatewayMessage(message) {
    if (typeof message.content !== 'string') {
        throw new Error('Model Gateway v0.1 currently supports text-only Chat messages.');
    }
    const type = message._getType?.();
    return {
        role: type === 'system' ? 'system' : type === 'ai' ? 'assistant' : 'user',
        content: message.content,
    };
}

const IMAGE_MODEL_SETTINGS = {
    "gpt-image-1.5": {
        name: "GPT Image 1.5",
        aspectRatios: ["Auto", "1024x1024", "1536x1024", "1024x1536"],
        resolutions: ["Auto", "1K", "2K", "4K"],
        defaultResolution: "Auto",
    },
    "gemini-pro": {
        name: "Nano Banana Pro",
        aspectRatios: ["Auto", "1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9"],
        resolutions: ["1K", "2K", "4K"],
        defaultResolution: "1K",
    },
    "kling-v1-5": {
        name: "Kling V1.5",
        aspectRatios: ["Auto", "1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "21:9"],
        resolutions: ["1K", "2K"],
        defaultResolution: "1K",
    },
    "kling-v2-1": {
        name: "Kling V2.1",
        aspectRatios: ["Auto", "1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "21:9"],
        resolutions: ["1K", "2K"],
        defaultResolution: "1K",
    },
};

const SNAPSHOT_VERSION_PROPERTY = {
    type: "string",
    description: "The exact snapshot_version returned by get_canvas_snapshot. Required for safe writes to existing canvas state.",
};

const CANVAS_TOOLS = [
    {
        type: "function",
        function: {
            name: "get_canvas_snapshot",
            description: "Read a lightweight snapshot of canvas nodes, connections, exact IDs, and snapshot version. Call this before referring to, updating, deleting, or connecting existing nodes.",
            parameters: { type: "object", additionalProperties: false, properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "add_canvas_node",
            description: "Add one editable image or video draft node. This tool never generates media.",
            parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                    node_type: { type: "string", enum: ["image", "video"] },
                    prompt: { type: "string", description: "Editable generation prompt, 1 to 4000 characters." },
                    image_model: { type: "string", enum: Object.keys(IMAGE_MODEL_SETTINGS) },
                    aspect_ratio: {
                        type: "string",
                        enum: [...new Set(Object.values(IMAGE_MODEL_SETTINGS).flatMap(model => model.aspectRatios))],
                    },
                    quality: { type: "string", enum: ["Auto", "1K", "2K", "4K"] },
                    expected_snapshot_version: SNAPSHOT_VERSION_PROPERTY,
                },
                required: ["node_type", "prompt"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "update_canvas_node",
            description: "Update supported editable fields on one existing node without replacing the whole canvas.",
            parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                    node_id: { type: "string" },
                    expected_snapshot_version: SNAPSHOT_VERSION_PROPERTY,
                    patch: {
                        type: "object",
                        additionalProperties: false,
                        minProperties: 1,
                        properties: {
                            title: { type: "string" }, prompt: { type: "string" },
                            x: { type: "number" }, y: { type: "number" }, model: { type: "string" },
                            aspect_ratio: { type: "string" }, resolution: { type: "string" },
                        },
                    },
                },
                required: ["node_id", "expected_snapshot_version", "patch"],
            },
        },
    },
    ...["delete_canvas_node", "connect_canvas_nodes", "disconnect_canvas_nodes"].map(name => ({
        type: "function",
        function: {
            name,
            description: name === "delete_canvas_node"
                ? "Delete one explicitly identified existing node and its incident connections."
                : `${name.startsWith("disconnect") ? "Disconnect" : "Connect"} an existing parent node (from_node_id) ${name.startsWith("disconnect") ? "from" : "to"} a child node (to_node_id).`,
            parameters: name === "delete_canvas_node" ? {
                type: "object", additionalProperties: false,
                properties: { node_id: { type: "string" }, expected_snapshot_version: SNAPSHOT_VERSION_PROPERTY },
                required: ["node_id", "expected_snapshot_version"],
            } : {
                type: "object", additionalProperties: false,
                properties: {
                    from_node_id: { type: "string" }, to_node_id: { type: "string" },
                    expected_snapshot_version: SNAPSHOT_VERSION_PROPERTY,
                },
                required: ["from_node_id", "to_node_id", "expected_snapshot_version"],
            },
        },
    })),
    {
        type: "function",
        function: {
            name: "request_image_generation",
            description: "Request human approval to generate media for one existing image node. This pauses before any paid model call. Read the canvas snapshot first and use its exact node ID and snapshot version.",
            parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                    node_id: { type: "string" },
                    expected_snapshot_version: SNAPSHOT_VERSION_PROPERTY,
                },
                required: ["node_id", "expected_snapshot_version"],
            },
        },
    },
];

const GATEWAY_CANVAS_TOOLS = CANVAS_TOOLS.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    inputSchema: tool.function.parameters,
}));

function toOpenAIToolCalls(toolCalls = []) {
    return toolCalls.map(toolCall => ({
        id: toolCall.id,
        type: 'function',
        function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
        },
    }));
}

function toGatewayToolCalls(toolCalls = []) {
    return toolCalls.map(toolCall => ({
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: JSON.parse(toolCall.function.arguments || '{}'),
    }));
}

function createOpenAIClient(apiKey, baseUrl) {
    return new OpenAI({
        apiKey,
        baseURL: normalizeOpenAIBaseUrl(baseUrl),
    });
}

function validateCanvasToolCall(toolCall) {
    try {
        const args = JSON.parse(toolCall.function.arguments || "{}");
        const name = toolCall.type === "function" ? toolCall.function?.name : "";
        if (name === "get_canvas_snapshot") {
            return { toolCallId: toolCall.id, action: { type: "get_snapshot", toolCallId: toolCall.id } };
        }
        const version = typeof args.expected_snapshot_version === "string" ? args.expected_snapshot_version.trim() : "";
        if (name === "update_canvas_node") {
            const patch = args.patch && typeof args.patch === "object" && !Array.isArray(args.patch) ? args.patch : {};
            const supported = ["title", "prompt", "x", "y", "model", "aspect_ratio", "resolution"];
            const updates = Object.fromEntries(Object.entries(patch)
                .filter(([key]) => supported.includes(key))
                .map(([key, value]) => [key === "aspect_ratio" ? "aspectRatio" : key, value]));
            if (typeof args.node_id !== "string" || !args.node_id || !version || Object.keys(updates).length === 0) {
                return { toolCallId: toolCall.id, error: "update_canvas_node requires node_id, expected_snapshot_version, and at least one supported patch field." };
            }
            return { toolCallId: toolCall.id, action: { type: "update_node", toolCallId: toolCall.id, nodeId: args.node_id, expectedSnapshotVersion: version, updates } };
        }
        if (name === "delete_canvas_node") {
            if (typeof args.node_id !== "string" || !args.node_id || !version) {
                return { toolCallId: toolCall.id, error: "delete_canvas_node requires node_id and expected_snapshot_version." };
            }
            return { toolCallId: toolCall.id, action: { type: "delete_node", toolCallId: toolCall.id, nodeId: args.node_id, expectedSnapshotVersion: version } };
        }
        if (name === "request_image_generation") {
            if (typeof args.node_id !== "string" || !args.node_id || !version) {
                return { toolCallId: toolCall.id, error: "request_image_generation requires node_id and expected_snapshot_version." };
            }
            return {
                toolCallId: toolCall.id,
                action: {
                    type: "request_generation",
                    generationType: "image",
                    toolCallId: toolCall.id,
                    nodeId: args.node_id,
                    expectedSnapshotVersion: version,
                },
            };
        }
        if (name === "connect_canvas_nodes" || name === "disconnect_canvas_nodes") {
            if (typeof args.from_node_id !== "string" || !args.from_node_id || typeof args.to_node_id !== "string" || !args.to_node_id || !version) {
                return { toolCallId: toolCall.id, error: `${name} requires from_node_id, to_node_id, and expected_snapshot_version.` };
            }
            return { toolCallId: toolCall.id, action: {
                type: name === "connect_canvas_nodes" ? "connect_nodes" : "disconnect_nodes",
                toolCallId: toolCall.id, fromNodeId: args.from_node_id, toNodeId: args.to_node_id,
                expectedSnapshotVersion: version,
            } };
        }
        if (name !== "add_canvas_node") {
            return { toolCallId: toolCall.id, error: "Unknown canvas tool." };
        }
        const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
        if (!(["image", "video"].includes(args.node_type)) || !prompt || prompt.length > 4000) {
            return {
                toolCallId: toolCall.id,
                error: "add_canvas_node requires node_type (image or video) and a prompt from 1 to 4000 characters.",
            };
        }
        const action = {
            toolCallId: toolCall.id,
            action: {
                type: "add_node",
                nodeType: args.node_type,
                prompt,
                toolCallId: toolCall.id,
                ...(version ? { expectedSnapshotVersion: version } : {}),
            },
        };

        if (args.node_type === "image") {
            const imageModel = args.image_model || "gemini-pro";
            const settings = IMAGE_MODEL_SETTINGS[imageModel];
            const aspectRatio = args.aspect_ratio || "Auto";
            const resolution = args.quality || settings.defaultResolution;

            if (!settings || !settings.aspectRatios.includes(aspectRatio) || !settings.resolutions.includes(resolution)) {
                return {
                    toolCallId: toolCall.id,
                    error: `Unsupported image settings. ${imageModel} supports aspect ratios ${settings?.aspectRatios.join(", ") || "none"} and quality ${settings?.resolutions.join(", ") || "none"}.`,
                };
            }

            action.action.imageModel = imageModel;
            action.action.modelName = settings.name;
            action.action.aspectRatio = aspectRatio;
            action.action.resolution = resolution;
        }

        return action;
    } catch {
        return {
            toolCallId: toolCall.id,
            error: "Canvas tool arguments must be valid JSON.",
        };
    }
}

function createAwaitingClientResult({ engine, requestMessages, assistantMessage, traceId }) {
    const toolCalls = assistantMessage.tool_calls || [];
    const validatedCalls = toolCalls.map(validateCanvasToolCall);
    return {
        status: "awaiting_client",
        actions: validatedCalls.flatMap(result => result.action ? [result.action] : []),
        continuation: {
            engine,
            requestMessages,
            assistantMessage: {
                content: assistantMessage.content || "",
                tool_calls: toolCalls,
            },
            validatedCalls,
        },
        traceIds: traceId ? [traceId] : [],
    };
}

/**
 * Start a native OpenAI-compatible tool call. The browser owns canvas state,
 * so this pauses before the tool-result turn until the browser reports what
 * it actually created.
 */
export async function startCanvasToolAgent(messages, { apiKey, baseUrl, modelName, modelGatewayRuntime }) {
    const sourceMessages = [
        new SystemMessage(CHAT_AGENT_SYSTEM_PROMPT),
        ...messages,
    ];
    let assistantMessage;
    let requestMessages;
    let engine = 'legacy-openai';
    let traceId;

    const canUseGateway = modelGatewayRuntime
        && sourceMessages.every(message => typeof message.content === 'string');
    if (canUseGateway) {
        requestMessages = sourceMessages.map(toGatewayMessage);
        const gatewayResult = await modelGatewayRuntime.invoke({
            messages: requestMessages,
            tools: GATEWAY_CANVAS_TOOLS,
            parameters: { temperature: 0.7, max_tokens: 2048 },
        });
        assistantMessage = {
            content: gatewayResult.message.content,
            tool_calls: toOpenAIToolCalls(gatewayResult.message.toolCalls),
        };
        engine = 'model-gateway';
        traceId = gatewayResult.traceId;
    } else {
        const client = createOpenAIClient(apiKey, baseUrl);
        requestMessages = sourceMessages.map(toOpenAIMessage);
        const firstCompletion = await client.chat.completions.create({
            model: modelName || "gemini-2.0-flash",
            messages: requestMessages,
            tools: CANVAS_TOOLS,
            tool_choice: "auto",
            temperature: 0.7,
            max_tokens: 2048,
        });
        assistantMessage = firstCompletion.choices?.[0]?.message;
    }
    if (!assistantMessage) {
        throw new Error("The OpenAI-compatible gateway returned no assistant message.");
    }

    const toolCalls = assistantMessage.tool_calls || [];
    if (toolCalls.length === 0) {
        return {
            status: "completed",
            response: assistantMessage.content || "",
            actions: [],
            traceIds: traceId ? [traceId] : [],
        };
    }

    return createAwaitingClientResult({ engine, requestMessages, assistantMessage, traceId });
}

/**
 * Resume a paused tool-call turn using the browser's actual action result.
 */
export async function completeCanvasToolAgent(
    continuation,
    executions,
    { apiKey, baseUrl, modelName, modelGatewayRuntime },
) {
    const executionByToolCallId = new Map(
        (Array.isArray(executions) ? executions : [])
            .filter(execution => execution && typeof execution.toolCallId === "string")
            .map(execution => [execution.toolCallId, execution])
    );
    const toolMessages = continuation.validatedCalls.map(result => {
        if (result.error) {
            return {
                role: "tool",
                tool_call_id: result.toolCallId,
                content: JSON.stringify({ status: "rejected", error: result.error }),
            };
        }
        const execution = executionByToolCallId.get(result.toolCallId);
        if (execution?.status === "succeeded") {
            return {
                role: "tool",
                tool_call_id: result.toolCallId,
                content: JSON.stringify({
                    status: "succeeded",
                    operation: execution.operation,
                    snapshot_version: execution.snapshotVersion,
                    snapshot: execution.snapshot,
                    node_id: execution.nodeId,
                    connection_id: execution.connectionId,
                    deleted_connection_ids: execution.deletedConnectionIds,
                    result_url: execution.resultUrl,
                    proposal_id: execution.proposalId,
                }),
            };
        }
        return {
            role: "tool",
            tool_call_id: result.toolCallId,
            content: JSON.stringify({
                status: "failed",
                code: execution?.errorCode,
                error: execution?.error || "The browser did not confirm this canvas operation.",
            }),
        };
    });

    let assistantMessage;
    let traceId;
    let requestMessages;
    if (continuation.engine === 'model-gateway') {
        if (!modelGatewayRuntime) {
            throw new Error('Model Gateway runtime is unavailable for this pending canvas action.');
        }
        requestMessages = [
            ...continuation.requestMessages,
            {
                role: 'assistant',
                content: continuation.assistantMessage.content,
                toolCalls: toGatewayToolCalls(continuation.assistantMessage.tool_calls),
            },
            ...toolMessages.map(message => ({
                role: 'tool',
                toolCallId: message.tool_call_id,
                content: message.content,
            })),
        ];
        const gatewayResult = await modelGatewayRuntime.invoke({
            messages: requestMessages,
            tools: GATEWAY_CANVAS_TOOLS,
            parameters: { temperature: 0.7, max_tokens: 2048 },
        });
        assistantMessage = {
            content: gatewayResult.message.content,
            tool_calls: toOpenAIToolCalls(gatewayResult.message.toolCalls),
        };
        traceId = gatewayResult.traceId;
    } else {
        const client = createOpenAIClient(apiKey, baseUrl);
        requestMessages = [
            ...continuation.requestMessages,
            {
                role: "assistant",
                content: continuation.assistantMessage.content,
                tool_calls: continuation.assistantMessage.tool_calls,
            },
            ...toolMessages,
        ];
        const nextCompletion = await client.chat.completions.create({
            model: modelName || "gemini-2.0-flash",
            messages: requestMessages,
            tools: CANVAS_TOOLS,
            tool_choice: "auto",
            temperature: 0.7,
            max_tokens: 2048,
        });
        assistantMessage = nextCompletion.choices?.[0]?.message;
    }
    if (!assistantMessage) {
        throw new Error("The OpenAI-compatible gateway returned no assistant message after tool execution.");
    }
    if ((assistantMessage.tool_calls || []).length > 0) {
        return createAwaitingClientResult({
            engine: continuation.engine,
            requestMessages,
            assistantMessage,
            traceId,
        });
    }

    return {
        status: "completed",
        response: assistantMessage.content || "已完成画布操作。",
        traceIds: traceId ? [traceId] : [],
    };
}

/**
 * Creates the model used by the canvas chat agent.
 * With GEMINI_BASE_URL set, this uses an OpenAI-compatible gateway instead of
 * Google's native Gemini endpoint. The variable name is kept for backward
 * compatibility with the rest of the project configuration.
 */
export function createModel(apiKey, { baseUrl, modelName } = {}) {
    if (baseUrl) {
        const client = createOpenAIClient(apiKey, baseUrl);

        return {
            async invoke(messages) {
                const completion = await client.chat.completions.create({
                    model: modelName || "gemini-2.0-flash",
                    messages: messages.map(toOpenAIMessage),
                    temperature: 0.7,
                    max_tokens: 2048,
                });
                const content = completion.choices?.[0]?.message?.content;
                if (!content) {
                    throw new Error("The OpenAI-compatible gateway returned no message content.");
                }
                return new AIMessage(content);
            },
        };
    }

    return new ChatGoogleGenerativeAI({
        model: modelName || "gemini-2.0-flash",
        apiKey: apiKey,
        temperature: 0.7,
        maxOutputTokens: 2048,
    });
}

// ============================================================================
// GRAPH NODES
// ============================================================================

/**
 * Agent node - processes messages with the LLM
 * @param {object} state - Current graph state with messages
 * @param {object} config - Runtime config including API key
 * @returns {object} Updated state with AI response
 */
async function agentNode(state, config) {
    const model = createModel(config.configurable?.apiKey, config.configurable);

    // Build messages array with system prompt
    const systemMessage = new SystemMessage(CHAT_AGENT_SYSTEM_PROMPT);
    const allMessages = [systemMessage, ...state.messages];

    // Invoke the model
    const response = await model.invoke(allMessages);

    return {
        messages: [response],
    };
}

// ============================================================================
// GRAPH DEFINITION
// ============================================================================

/**
 * Create and compile the chat graph
 * Simple flow: START → agent → END
 */
export function createChatGraph() {
    const workflow = new StateGraph(MessagesAnnotation)
        .addNode("agent", agentNode)
        .addEdge("__start__", "agent")
        .addEdge("agent", END);

    return workflow.compile();
}

// ============================================================================
// TOPIC GENERATION
// ============================================================================

/**
 * Generate a topic title for the conversation
 * @param {Array} messages - Conversation messages
 * @param {string} apiKey - Google AI API key
 * @returns {Promise<string>} Generated topic title
 */
export async function generateTopicTitle(messages, apiKey, config = {}) {
    const model = createModel(apiKey, config);

    // Build context from messages (limit to first few for efficiency)
    const contextMessages = messages.slice(0, 6);
    const conversationSummary = contextMessages
        .map(m => `${m._getType?.() === 'human' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');

    const prompt = `${TOPIC_GENERATION_PROMPT}\n\nConversation:\n${conversationSummary}`;

    const response = await model.invoke([new HumanMessage(prompt)]);

    // Extract just the topic text
    return response.content.toString().trim();
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    createChatGraph,
    createModel,
    generateTopicTitle,
    startCanvasToolAgent,
    completeCanvasToolAgent,
};
