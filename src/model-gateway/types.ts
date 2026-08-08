export type ModelProtocol =
    | 'mock'
    | 'openai-chat'
    | 'openai-image-chat'
    | 'gemini-generate-content'
    | 'async-media-job';

export type ModelCapability =
    | 'chat'
    | 'tool_calling'
    | 'image_generation'
    | 'image_editing'
    | 'video_generation';

export type ModelInvocationCapability = 'chat' | 'image_generation';

export type ModelModality = 'text' | 'image' | 'video' | 'audio';

export type ModelParameterType = 'string' | 'number' | 'boolean';

export interface ModelParameterDefinition {
    type: ModelParameterType;
    description?: string;
    required?: boolean;
    default?: string | number | boolean;
    enum?: Array<string | number | boolean>;
    minimum?: number;
    maximum?: number;
}

export interface ModelProviderDefinition {
    id: string;
    displayName: string;
    protocols: ModelProtocol[];
}

export interface ModelDefinition {
    id: string;
    displayName: string;
    providerId: string;
    protocol: ModelProtocol;
    upstreamModel: string;
    capabilities: ModelCapability[];
    inputModalities: ModelModality[];
    outputModalities: ModelModality[];
    parameters: Record<string, ModelParameterDefinition>;
}

export interface ModelMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    toolCallId?: string;
    toolCalls?: ModelToolCall[];
}

export interface ModelToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

export interface ModelToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

export interface ModelInvocationRequest {
    modelId: string;
    capability: ModelInvocationCapability;
    messages: ModelMessage[];
    tools?: ModelToolDefinition[];
    parameters?: Record<string, unknown>;
}

export interface ResolvedModelInvocation extends ModelInvocationRequest {
    model: ModelDefinition;
    provider: ModelProviderDefinition;
    parameters: Record<string, string | number | boolean>;
}

export interface ModelInvocationResult {
    requestId: string;
    modelId: string;
    providerId: string;
    protocol: ModelProtocol;
    message: {
        role: 'assistant';
        content: string;
        toolCalls?: ModelToolCall[];
    };
    artifacts?: Array<{
        type: 'image';
        mimeType: string;
        base64: string;
        byteLength: number;
    }>;
    finishReason: 'stop' | 'tool_calls';
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}

export interface GatewayInvocationResult extends ModelInvocationResult {
    traceId: string;
}

export interface ModelAdapter {
    readonly protocol: ModelProtocol;
    invoke(request: ResolvedModelInvocation): Promise<ModelInvocationResult>;
}

export type ModelGatewayErrorCode =
    | 'duplicate_provider'
    | 'duplicate_model'
    | 'provider_not_found'
    | 'model_not_found'
    | 'protocol_mismatch'
    | 'unsupported_capability'
    | 'invalid_request'
    | 'invalid_parameter'
    | 'adapter_not_found'
    | 'provider_timeout'
    | 'provider_access_denied'
    | 'provider_endpoint_not_found'
    | 'provider_rate_limited'
    | 'provider_error';

export class ModelGatewayError extends Error {
    readonly code: ModelGatewayErrorCode;
    readonly path?: string;
    readonly httpStatus?: number;
    readonly retryable?: boolean;
    traceId?: string;

    constructor(
        code: ModelGatewayErrorCode,
        message: string,
        path?: string,
        details: { httpStatus?: number; retryable?: boolean } = {},
    ) {
        super(message);
        this.name = 'ModelGatewayError';
        this.code = code;
        this.path = path;
        this.httpStatus = details.httpStatus;
        this.retryable = details.retryable;
    }
}
