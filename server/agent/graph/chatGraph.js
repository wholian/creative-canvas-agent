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

const CANVAS_TOOLS = [{
    type: "function",
    function: {
        name: "add_canvas_node",
        description: "Add one editable image or video draft node to the user's canvas. This tool never generates media.",
        parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
                node_type: {
                    type: "string",
                    enum: ["image", "video"],
                    description: "Use image for a still-image generation draft and video for a video-generation draft.",
                },
                prompt: {
                    type: "string",
                    description: "A concise, editable generation prompt derived from the user's request.",
                },
                image_model: {
                    type: "string",
                    enum: Object.keys(IMAGE_MODEL_SETTINGS),
                    description: "For image nodes only. Set it only when the user specifies a model; otherwise omit it.",
                },
                aspect_ratio: {
                    type: "string",
                    enum: [...new Set(Object.values(IMAGE_MODEL_SETTINGS).flatMap(model => model.aspectRatios))],
                    description: "For image nodes only. Set it only when the user specifies a canvas ratio or pixel size; otherwise omit it.",
                },
                quality: {
                    type: "string",
                    enum: ["Auto", "1K", "2K", "4K"],
                    description: "For image nodes only. This is the provider quality/resolution preset; set it only when the user specifies it.",
                },
            },
            required: ["node_type", "prompt"],
        },
    },
}];

function createOpenAIClient(apiKey, baseUrl) {
    return new OpenAI({
        apiKey,
        baseURL: normalizeOpenAIBaseUrl(baseUrl),
    });
}

function validateCanvasToolCall(toolCall) {
    if (toolCall.type !== "function" || toolCall.function?.name !== "add_canvas_node") {
        return {
            toolCallId: toolCall.id,
            error: "Unknown canvas tool. Only add_canvas_node is available.",
        };
    }

    try {
        const args = JSON.parse(toolCall.function.arguments || "{}");
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
            error: "add_canvas_node arguments must be valid JSON.",
        };
    }
}

/**
 * Start a native OpenAI-compatible tool call. The browser owns canvas state,
 * so this pauses before the tool-result turn until the browser reports what
 * it actually created.
 */
export async function startCanvasToolAgent(messages, { apiKey, baseUrl, modelName }) {
    const client = createOpenAIClient(apiKey, baseUrl);
    const requestMessages = [
        new SystemMessage(CHAT_AGENT_SYSTEM_PROMPT),
        ...messages,
    ].map(toOpenAIMessage);

    const firstCompletion = await client.chat.completions.create({
        model: modelName || "gemini-2.0-flash",
        messages: requestMessages,
        tools: CANVAS_TOOLS,
        tool_choice: "auto",
        temperature: 0.7,
        max_tokens: 2048,
    });
    const assistantMessage = firstCompletion.choices?.[0]?.message;
    if (!assistantMessage) {
        throw new Error("The OpenAI-compatible gateway returned no assistant message.");
    }

    const toolCalls = assistantMessage.tool_calls || [];
    if (toolCalls.length === 0) {
        return {
            status: "completed",
            response: assistantMessage.content || "",
            actions: [],
        };
    }

    const validatedCalls = toolCalls.map(validateCanvasToolCall);
    const actions = validatedCalls.flatMap(result => result.action ? [result.action] : []);
    return {
        status: "awaiting_client",
        actions,
        continuation: {
            requestMessages,
            assistantMessage: {
                content: assistantMessage.content || "",
                tool_calls: toolCalls,
            },
            validatedCalls,
        },
    };
}

/**
 * Resume a paused tool-call turn using the browser's actual action result.
 */
export async function completeCanvasToolAgent(continuation, executions, { apiKey, baseUrl, modelName }) {
    const client = createOpenAIClient(apiKey, baseUrl);
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
        if (execution?.status === "succeeded" && typeof execution.nodeId === "string" && execution.nodeId) {
            return {
                role: "tool",
                tool_call_id: result.toolCallId,
                content: JSON.stringify({
                    status: "succeeded",
                    node_id: execution.nodeId,
                    action: result.action,
                    note: "The browser created the editable draft node. No media was generated.",
                }),
            };
        }
        return {
            role: "tool",
            tool_call_id: result.toolCallId,
            content: JSON.stringify({
                status: "failed",
                error: execution?.error || "The browser did not confirm creation of this canvas node.",
            }),
        };
    });

    const finalCompletion = await client.chat.completions.create({
        model: modelName || "gemini-2.0-flash",
        messages: [
            ...continuation.requestMessages,
            {
                role: "assistant",
                content: continuation.assistantMessage.content,
                tool_calls: continuation.assistantMessage.tool_calls,
            },
            ...toolMessages,
        ],
        temperature: 0.7,
        max_tokens: 2048,
    });
    const finalMessage = finalCompletion.choices?.[0]?.message;
    if (!finalMessage) {
        throw new Error("The OpenAI-compatible gateway returned no final message after tool execution.");
    }

    return {
        response: finalMessage.content || "已完成画布操作。",
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
