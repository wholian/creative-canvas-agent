import {
    InMemoryModelTraceStore,
    ModelGateway,
    ModelRegistry,
    OpenAIChatAdapter,
    OpenAICompatibleHttpTransport,
    ProviderRuntimeConfigStore,
} from '../../src/model-gateway/index.ts';

const CHAT_PROVIDER_ID = 'canvas-chat-provider';
const CHAT_MODEL_ID = 'agent.canvas-chat';

/**
 * Assemble the server-side Chat gateway once at startup. The API key remains
 * in the runtime config store and never enters the model registry or traces.
 */
export function createCanvasChatModelGatewayRuntime(config, options = {}) {
    const traceStore = options.traceStore || new InMemoryModelTraceStore();
    const registry = new ModelRegistry({
        providers: [{
            id: CHAT_PROVIDER_ID,
            displayName: 'Canvas Chat Provider',
            protocols: ['openai-chat'],
        }],
        models: [{
            id: CHAT_MODEL_ID,
            displayName: 'Canvas Chat Model',
            providerId: CHAT_PROVIDER_ID,
            protocol: 'openai-chat',
            upstreamModel: config.modelName,
            capabilities: ['chat', 'tool_calling'],
            inputModalities: ['text'],
            outputModalities: ['text'],
            parameters: {
                temperature: { type: 'number', minimum: 0, maximum: 2, default: 0.7 },
                max_tokens: { type: 'number', minimum: 1, maximum: 32_768, default: 2048 },
            },
        }],
    });
    const runtimeConfigs = new ProviderRuntimeConfigStore([{
        providerId: CHAT_PROVIDER_ID,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        timeoutMs: config.timeoutMs,
    }]);
    const transport = new OpenAICompatibleHttpTransport(
        runtimeConfigs,
        options.fetchImplementation || fetch,
    );
    const gateway = new ModelGateway(
        registry,
        [new OpenAIChatAdapter(transport)],
        { traceStore },
    );

    return {
        traceStore,
        invoke({ messages, tools = undefined, parameters = undefined }) {
            return gateway.invoke({
                modelId: CHAT_MODEL_ID,
                capability: 'chat',
                messages,
                tools,
                parameters,
            });
        },
    };
}
