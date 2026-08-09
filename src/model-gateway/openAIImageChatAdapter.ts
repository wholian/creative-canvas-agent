import {
    ModelGatewayError,
    type ModelAdapter,
    type ModelInvocationResult,
    type ResolvedModelInvocation,
} from './types.ts';

export interface OpenAIImageChatRequest {
    model: string;
    messages: Array<{
        role: 'user';
        content: string | Array<
            | { type: 'text'; text: string }
            | { type: 'image_url'; image_url: { url: string } }
        >;
    }>;
    modalities: ['text', 'image'];
    image_config: {
        aspect_ratio: string;
        image_size: string;
    };
}

export interface OpenAIImageChatResponse {
    id: string;
    choices: Array<{
        message: { role: 'assistant'; content?: string | null };
        finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpenAIImageChatTransport {
    generateImage(
        request: OpenAIImageChatRequest,
        context: { providerId: string },
    ): Promise<OpenAIImageChatResponse>;
}

const DATA_IMAGE_PATTERN = /data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\r\n]+)/i;

function extractImage(content: string): { mimeType: string; base64: string; byteLength: number } {
    const match = content.match(DATA_IMAGE_PATTERN);
    if (!match) {
        throw new ModelGatewayError('provider_error', 'OpenAI-compatible image model returned no Base64 image.');
    }
    const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
    const base64 = match[2].replace(/\s/g, '');
    const paddingLength = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    const byteLength = Math.floor(base64.length * 3 / 4) - paddingLength;
    if (byteLength === 0) {
        throw new ModelGatewayError('provider_error', 'OpenAI-compatible image model returned an empty image.');
    }
    return { mimeType, base64, byteLength };
}

function stripInlineImage(content: string): string {
    return content
        .replace(/!\[[^\]]*\]\(data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\r\n]+\)/gi, '')
        .trim();
}

export class OpenAIImageChatAdapter implements ModelAdapter {
    readonly protocol = 'openai-image-chat' as const;
    private readonly transport: OpenAIImageChatTransport;

    constructor(transport: OpenAIImageChatTransport) {
        this.transport = transport;
    }

    async invoke(request: ResolvedModelInvocation): Promise<ModelInvocationResult> {
        if (request.capability !== 'image_generation') {
            throw new ModelGatewayError('unsupported_capability', 'OpenAI image Chat adapter only supports image_generation.');
        }
        const prompt = [...request.messages].reverse().find(message => message.role === 'user')?.content?.trim();
        if (!prompt) throw new ModelGatewayError('invalid_request', 'Image generation requires a user prompt.', 'messages');

        const referenceImages = request.inputArtifacts || [];
        const requestContent: OpenAIImageChatRequest['messages'][number]['content'] = referenceImages.length
            ? [
                { type: 'text', text: prompt },
                ...referenceImages.map(reference => ({
                    type: 'image_url' as const,
                    image_url: { url: reference.url },
                })),
            ]
            : prompt;
        const payload: OpenAIImageChatRequest = {
            model: request.model.upstreamModel,
            messages: [{ role: 'user', content: requestContent }],
            modalities: ['text', 'image'],
            image_config: {
                aspect_ratio: String(request.parameters.aspect_ratio),
                image_size: String(request.parameters.image_size),
            },
        };

        let response: OpenAIImageChatResponse;
        try {
            response = await this.transport.generateImage(payload, { providerId: request.provider.id });
        } catch (error) {
            if (error instanceof ModelGatewayError) throw error;
            throw new ModelGatewayError(
                'provider_error',
                error instanceof Error ? error.message : 'OpenAI-compatible image request failed.',
            );
        }

        const content = response.choices?.[0]?.message?.content || '';
        const image = extractImage(content);
        return {
            requestId: response.id,
            modelId: request.model.id,
            providerId: request.provider.id,
            protocol: this.protocol,
            message: { role: 'assistant', content: stripInlineImage(content) },
            artifacts: [{ type: 'image', ...image }],
            finishReason: 'stop',
            ...(response.usage ? {
                usage: {
                    inputTokens: response.usage.prompt_tokens || 0,
                    outputTokens: response.usage.completion_tokens || 0,
                },
            } : {}),
        };
    }
}
