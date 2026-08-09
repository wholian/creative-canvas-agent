import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

const EMPTY_USAGE = Object.freeze({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function textFromContent(content) {
    if (typeof content === 'string') return content;
    return (content || [])
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n');
}

function toGatewayMessages(context) {
    const messages = [];
    if (context.systemPrompt) {
        messages.push({ role: 'system', content: context.systemPrompt });
    }
    for (const message of context.messages) {
        if (message.role === 'user') {
            messages.push({ role: 'user', content: textFromContent(message.content) });
            continue;
        }
        if (message.role === 'assistant') {
            messages.push({
                role: 'assistant',
                content: textFromContent(message.content),
                ...(message.content.some(part => part.type === 'toolCall') ? {
                    toolCalls: message.content
                        .filter(part => part.type === 'toolCall')
                        .map(part => ({ id: part.id, name: part.name, arguments: part.arguments })),
                } : {}),
            });
            continue;
        }
        messages.push({
            role: 'tool',
            toolCallId: message.toolCallId,
            content: textFromContent(message.content),
        });
    }
    return messages;
}

function toGatewayTools(tools = []) {
    return tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters,
    }));
}

function usageFromGateway(usage) {
    const input = usage?.inputTokens || 0;
    const output = usage?.outputTokens || 0;
    return {
        ...EMPTY_USAGE,
        input,
        output,
        totalTokens: input + output,
        cost: { ...EMPTY_USAGE.cost },
    };
}

function messageFromGateway(model, result) {
    const content = [];
    if (result.message.content) {
        content.push({ type: 'text', text: result.message.content });
    }
    for (const toolCall of result.message.toolCalls || []) {
        content.push({
            type: 'toolCall',
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
        });
    }
    return {
        role: 'assistant',
        content,
        api: model.api,
        provider: model.provider,
        model: model.id,
        responseId: result.requestId,
        usage: usageFromGateway(result.usage),
        stopReason: result.message.toolCalls?.length ? 'toolUse' : 'stop',
        timestamp: Date.now(),
    };
}

function errorMessage(model, error) {
    return {
        role: 'assistant',
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } },
        stopReason: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
    };
}

/**
 * Adapts the project's canonical Model Gateway to Pi's streaming contract.
 * The current Gateway is request/response based, so v0.1 emits one final
 * assistant event. Pi still owns transcript assembly and the native Tool Loop.
 */
export function createPiModelGatewayAdapter({
    modelGatewayRuntime,
    modelName,
    baseUrl,
    onTrace,
}) {
    if (!modelGatewayRuntime) {
        throw new Error('Creative Agent Runtime requires the unified Model Gateway.');
    }

    const model = {
        id: modelName || 'canvas-chat',
        name: modelName || 'Canvas Chat',
        api: 'openai-completions',
        provider: 'openai',
        baseUrl: baseUrl || '',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 2_048,
    };

    const streamFn = (_model, context, options = {}) => {
        const stream = createAssistantMessageEventStream();
        void modelGatewayRuntime.invoke({
            messages: toGatewayMessages(context),
            tools: toGatewayTools(context.tools),
            parameters: { temperature: 0.7, max_tokens: 2048 },
        }, { signal: options.signal }).then(result => {
            if (result.traceId) onTrace?.(result.traceId);
            const message = messageFromGateway(model, result);
            stream.push({ type: 'done', reason: message.stopReason, message });
        }).catch(error => {
            const message = errorMessage(model, error);
            stream.push({ type: 'error', reason: 'error', error: message });
        });
        return stream;
    };

    return { model, streamFn };
}
