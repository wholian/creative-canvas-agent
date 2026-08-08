import {
    InMemoryModelTraceStore,
    ModelGateway,
    ModelRegistry,
    OpenAICompatibleHttpTransport,
    OpenAIImageChatAdapter,
    ProviderRuntimeConfigStore,
} from '../src/model-gateway/index.ts';

const IMAGE_PROVIDER_ID = 'canvas-image-provider';
const IMAGE_MODEL_ID = 'image.gemini-2.5-flash';

/**
 * Server-owned image generation runtime. Canvas and routes use a canonical
 * request while this adapter owns the provider's Chat Completions wire format.
 */
export function createImageModelGatewayRuntime(config, options = {}) {
    const traceStore = options.traceStore || new InMemoryModelTraceStore();
    const registry = new ModelRegistry({
        providers: [{
            id: IMAGE_PROVIDER_ID,
            displayName: 'Canvas Image Provider',
            protocols: ['openai-image-chat'],
        }],
        models: [{
            id: IMAGE_MODEL_ID,
            displayName: 'Gemini 2.5 Flash Image',
            providerId: IMAGE_PROVIDER_ID,
            protocol: 'openai-image-chat',
            upstreamModel: config.modelName,
            capabilities: ['image_generation'],
            inputModalities: ['text'],
            outputModalities: ['image'],
            parameters: {
                aspect_ratio: {
                    type: 'string',
                    enum: ['1:1', '3:4', '4:3', '3:2', '2:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
                    default: '1:1',
                },
                image_size: {
                    type: 'string',
                    enum: ['1K', '2K', '4K'],
                    default: '1K',
                },
            },
        }],
    });
    const runtimeConfigs = new ProviderRuntimeConfigStore([{
        providerId: IMAGE_PROVIDER_ID,
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
        [new OpenAIImageChatAdapter(transport)],
        { traceStore },
    );

    return {
        traceStore,
        async generateImage({ prompt, aspectRatio = '1:1', resolution = '1K' }) {
            return gateway.invoke({
                modelId: IMAGE_MODEL_ID,
                capability: 'image_generation',
                messages: [{ role: 'user', content: prompt }],
                parameters: {
                    aspect_ratio: aspectRatio === 'Auto' ? '1:1' : aspectRatio,
                    image_size: resolution === 'Auto' ? '1K' : resolution,
                },
            });
        },
    };
}
