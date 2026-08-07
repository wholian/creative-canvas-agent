import {
    ModelGatewayError,
    type ModelAdapter,
    type ModelInvocationResult,
    type ResolvedModelInvocation,
} from './types.ts';

function estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
}

export class MockModelAdapter implements ModelAdapter {
    readonly protocol = 'mock' as const;

    async invoke(request: ResolvedModelInvocation): Promise<ModelInvocationResult> {
        const requestId = `mock-request-${crypto.randomUUID()}`;
        const inputText = request.messages.map(message => message.content).join('\n');

        if (request.model.upstreamModel === 'mock-chat-error') {
            const errorMode = request.parameters.error_mode;
            if (errorMode === 'timeout') {
                throw new ModelGatewayError(
                    'provider_timeout',
                    'Mock provider timed out on purpose.',
                    undefined,
                    { retryable: true },
                );
            }
            if (errorMode === '401') {
                throw new ModelGatewayError(
                    'provider_access_denied',
                    'Mock provider rejected the credentials on purpose.',
                    undefined,
                    { httpStatus: 401, retryable: false },
                );
            }
            if (errorMode === '404') {
                throw new ModelGatewayError(
                    'provider_endpoint_not_found',
                    'Mock provider endpoint was not found on purpose.',
                    undefined,
                    { httpStatus: 404, retryable: false },
                );
            }
            if (errorMode === '429') {
                throw new ModelGatewayError(
                    'provider_rate_limited',
                    'Mock provider rate limit was reached on purpose.',
                    undefined,
                    { httpStatus: 429, retryable: true },
                );
            }
            throw new ModelGatewayError(
                'provider_error',
                'Mock provider rejected the request on purpose.',
                undefined,
                { retryable: false },
            );
        }

        if (request.model.upstreamModel === 'mock-chat-tool-use') {
            const tool = request.tools?.[0];
            if (!tool) {
                throw new ModelGatewayError('invalid_request', 'Mock tool-use model requires at least one tool.', 'tools');
            }
            return {
                requestId,
                modelId: request.model.id,
                providerId: request.provider.id,
                protocol: this.protocol,
                message: {
                    role: 'assistant',
                    content: '',
                    toolCalls: [{
                        id: `mock-tool-${crypto.randomUUID()}`,
                        name: tool.name,
                        arguments: {
                            node_type: 'image',
                            prompt: request.messages.at(-1)?.content || 'Mock image draft',
                        },
                    }],
                },
                finishReason: 'tool_calls',
                usage: {
                    inputTokens: estimateTokens(inputText),
                    outputTokens: 24,
                },
            };
        }

        const content = `Mock response: ${request.messages.at(-1)?.content || ''}`;
        return {
            requestId,
            modelId: request.model.id,
            providerId: request.provider.id,
            protocol: this.protocol,
            message: { role: 'assistant', content },
            finishReason: 'stop',
            usage: {
                inputTokens: estimateTokens(inputText),
                outputTokens: estimateTokens(content),
            },
        };
    }
}
