import {
    ModelGatewayError,
    type ModelAdapter,
    type ModelInvocationResult,
    type ModelMessage,
    type ModelToolCall,
    type ResolvedModelInvocation,
} from './types.ts';

export interface OpenAIChatCompletionRequest {
    model: string;
    messages: Array<{
        role: ModelMessage['role'];
        content: string;
        tool_call_id?: string;
        tool_calls?: Array<{
            id: string;
            type: 'function';
            function: { name: string; arguments: string };
        }>;
    }>;
    tools?: Array<{
        type: 'function';
        function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
        };
    }>;
    tool_choice?: 'auto';
    temperature?: number;
    max_tokens?: number;
}

export interface OpenAIChatCompletionResponse {
    id: string;
    choices: Array<{
        message: {
            role: 'assistant';
            content?: string | null;
            tool_calls?: Array<{
                id: string;
                type: 'function';
                function: { name: string; arguments: string };
            }>;
        };
        finish_reason?: string | null;
    }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
    };
}

export interface OpenAIChatTransport {
    complete(request: OpenAIChatCompletionRequest): Promise<OpenAIChatCompletionResponse>;
}

function toOpenAIMessage(message: ModelMessage): OpenAIChatCompletionRequest['messages'][number] {
    return {
        role: message.role,
        content: message.content,
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
        ...(message.toolCalls?.length ? {
            tool_calls: message.toolCalls.map(toolCall => ({
                id: toolCall.id,
                type: 'function' as const,
                function: {
                    name: toolCall.name,
                    arguments: JSON.stringify(toolCall.arguments),
                },
            })),
        } : {}),
    };
}

function parseToolCallArguments(toolCall: NonNullable<OpenAIChatCompletionResponse['choices'][number]['message']['tool_calls']>[number]): ModelToolCall {
    try {
        const parsed = JSON.parse(toolCall.function.arguments || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        return {
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: parsed as Record<string, unknown>,
        };
    } catch {
        throw new ModelGatewayError(
            'provider_error',
            `OpenAI-compatible tool call ${toolCall.id} returned invalid JSON arguments.`,
        );
    }
}

export class OpenAIChatAdapter implements ModelAdapter {
    readonly protocol = 'openai-chat' as const;
    private readonly transport: OpenAIChatTransport;

    constructor(transport: OpenAIChatTransport) {
        this.transport = transport;
    }

    async invoke(request: ResolvedModelInvocation): Promise<ModelInvocationResult> {
        const payload: OpenAIChatCompletionRequest = {
            model: request.model.upstreamModel,
            messages: request.messages.map(toOpenAIMessage),
            ...(request.tools?.length ? {
                tools: request.tools.map(tool => ({
                    type: 'function' as const,
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema,
                    },
                })),
                tool_choice: 'auto' as const,
            } : {}),
            ...(typeof request.parameters.temperature === 'number'
                ? { temperature: request.parameters.temperature }
                : {}),
            ...(typeof request.parameters.max_tokens === 'number'
                ? { max_tokens: request.parameters.max_tokens }
                : {}),
        };

        let response: OpenAIChatCompletionResponse;
        try {
            response = await this.transport.complete(payload);
        } catch (error) {
            if (error instanceof ModelGatewayError) throw error;
            throw new ModelGatewayError(
                'provider_error',
                error instanceof Error ? error.message : 'OpenAI-compatible provider request failed.',
            );
        }

        const choice = response.choices?.[0];
        if (!choice?.message) {
            throw new ModelGatewayError('provider_error', 'OpenAI-compatible provider returned no assistant message.');
        }
        const toolCalls = choice.message.tool_calls?.map(parseToolCallArguments) || [];
        return {
            requestId: response.id,
            modelId: request.model.id,
            providerId: request.provider.id,
            protocol: this.protocol,
            message: {
                role: 'assistant',
                content: choice.message.content || '',
                ...(toolCalls.length ? { toolCalls } : {}),
            },
            finishReason: toolCalls.length ? 'tool_calls' : 'stop',
            ...(response.usage ? {
                usage: {
                    inputTokens: response.usage.prompt_tokens || 0,
                    outputTokens: response.usage.completion_tokens || 0,
                },
            } : {}),
        };
    }
}
