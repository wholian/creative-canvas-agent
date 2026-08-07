import {
    ModelGatewayError,
    type ModelCapability,
    type ModelDefinition,
    type ModelInvocationRequest,
    type ModelParameterDefinition,
    type ModelProviderDefinition,
    type ResolvedModelInvocation,
} from './types.ts';

const MODEL_PROTOCOLS = new Set(['mock', 'openai-chat', 'gemini-generate-content', 'async-media-job']);
const MODEL_CAPABILITIES = new Set(['chat', 'tool_calling', 'image_generation', 'image_editing', 'video_generation']);
const MODEL_MODALITIES = new Set(['text', 'image', 'video', 'audio']);

function cloneProvider(provider: ModelProviderDefinition): ModelProviderDefinition {
    return structuredClone(provider);
}

function cloneModel(model: ModelDefinition): ModelDefinition {
    return structuredClone(model);
}

function assertIdentifier(value: string, path: string): void {
    if (typeof value !== 'string' || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value)) {
        throw new ModelGatewayError('invalid_request', `${path} must be a stable lowercase identifier.`, path);
    }
}

function validateParameterDefinition(name: string, definition: ModelParameterDefinition): void {
    const path = `parameters.${name}`;
    if (!['string', 'number', 'boolean'].includes(definition.type)) {
        throw new ModelGatewayError('invalid_request', `${path}.type is unsupported.`, `${path}.type`);
    }
    if (definition.default !== undefined && typeof definition.default !== definition.type) {
        throw new ModelGatewayError('invalid_request', `${path}.default must be a ${definition.type}.`, `${path}.default`);
    }
    if (definition.enum?.length === 0) {
        throw new ModelGatewayError('invalid_request', `${path}.enum cannot be empty.`, `${path}.enum`);
    }
    if (definition.default !== undefined && definition.enum && !definition.enum.includes(definition.default)) {
        throw new ModelGatewayError('invalid_request', `${path}.default must be one of its enum values.`, `${path}.default`);
    }
}

function normalizeParameter(
    name: string,
    value: unknown,
    definition: ModelParameterDefinition,
): string | number | boolean {
    const path = `parameters.${name}`;
    if (typeof value !== definition.type) {
        throw new ModelGatewayError('invalid_parameter', `${path} must be a ${definition.type}.`, path);
    }
    const normalized = value as string | number | boolean;
    if (definition.enum && !definition.enum.includes(normalized)) {
        throw new ModelGatewayError(
            'invalid_parameter',
            `${path} must be one of: ${definition.enum.join(', ')}.`,
            path,
        );
    }
    if (typeof normalized === 'number') {
        if (definition.minimum !== undefined && normalized < definition.minimum) {
            throw new ModelGatewayError('invalid_parameter', `${path} must be at least ${definition.minimum}.`, path);
        }
        if (definition.maximum !== undefined && normalized > definition.maximum) {
            throw new ModelGatewayError('invalid_parameter', `${path} must be at most ${definition.maximum}.`, path);
        }
    }
    return normalized;
}

export class ModelRegistry {
    private readonly providers = new Map<string, ModelProviderDefinition>();
    private readonly models = new Map<string, ModelDefinition>();

    constructor({
        providers = [],
        models = [],
    }: {
        providers?: ModelProviderDefinition[];
        models?: ModelDefinition[];
    } = {}) {
        providers.forEach(provider => this.registerProvider(provider));
        models.forEach(model => this.registerModel(model));
    }

    registerProvider(provider: ModelProviderDefinition): void {
        assertIdentifier(provider.id, 'provider.id');
        if (!provider.displayName?.trim()) {
            throw new ModelGatewayError('invalid_request', 'provider.displayName is required.', 'provider.displayName');
        }
        if (!Array.isArray(provider.protocols) || provider.protocols.length === 0) {
            throw new ModelGatewayError('invalid_request', 'provider.protocols cannot be empty.', 'provider.protocols');
        }
        if (provider.protocols.some(protocol => !MODEL_PROTOCOLS.has(protocol))) {
            throw new ModelGatewayError('invalid_request', 'provider.protocols contains an unsupported protocol.', 'provider.protocols');
        }
        if (this.providers.has(provider.id)) {
            throw new ModelGatewayError('duplicate_provider', `Model provider already exists: ${provider.id}.`);
        }
        this.providers.set(provider.id, cloneProvider(provider));
    }

    registerModel(model: ModelDefinition): void {
        assertIdentifier(model.id, 'model.id');
        if (this.models.has(model.id)) {
            throw new ModelGatewayError('duplicate_model', `Model already exists: ${model.id}.`);
        }
        const provider = this.providers.get(model.providerId);
        if (!provider) {
            throw new ModelGatewayError('provider_not_found', `Model provider not found: ${model.providerId}.`, 'model.providerId');
        }
        if (!provider.protocols.includes(model.protocol)) {
            throw new ModelGatewayError(
                'protocol_mismatch',
                `Provider ${provider.id} does not support protocol ${model.protocol}.`,
                'model.protocol',
            );
        }
        if (!model.displayName?.trim() || !model.upstreamModel?.trim()) {
            throw new ModelGatewayError('invalid_request', 'Model displayName and upstreamModel are required.', 'model');
        }
        if (!Array.isArray(model.capabilities) || model.capabilities.length === 0) {
            throw new ModelGatewayError('invalid_request', 'model.capabilities cannot be empty.', 'model.capabilities');
        }
        if (model.capabilities.some(capability => !MODEL_CAPABILITIES.has(capability))) {
            throw new ModelGatewayError('invalid_request', 'model.capabilities contains an unsupported capability.', 'model.capabilities');
        }
        if (!Array.isArray(model.inputModalities) || model.inputModalities.some(modality => !MODEL_MODALITIES.has(modality))) {
            throw new ModelGatewayError('invalid_request', 'model.inputModalities contains an unsupported modality.', 'model.inputModalities');
        }
        if (!Array.isArray(model.outputModalities) || model.outputModalities.some(modality => !MODEL_MODALITIES.has(modality))) {
            throw new ModelGatewayError('invalid_request', 'model.outputModalities contains an unsupported modality.', 'model.outputModalities');
        }
        if (!model.parameters || typeof model.parameters !== 'object' || Array.isArray(model.parameters)) {
            throw new ModelGatewayError('invalid_request', 'model.parameters must be an object.', 'model.parameters');
        }
        Object.entries(model.parameters).forEach(([name, definition]) => {
            assertIdentifier(name, `parameters.${name}`);
            validateParameterDefinition(name, definition);
        });
        this.models.set(model.id, cloneModel(model));
    }

    getProvider(providerId: string): ModelProviderDefinition {
        const provider = this.providers.get(providerId);
        if (!provider) throw new ModelGatewayError('provider_not_found', `Model provider not found: ${providerId}.`);
        return cloneProvider(provider);
    }

    getModel(modelId: string): ModelDefinition {
        const model = this.models.get(modelId);
        if (!model) throw new ModelGatewayError('model_not_found', `Model not found: ${modelId}.`, 'modelId');
        return cloneModel(model);
    }

    listModels(capability?: ModelCapability): ModelDefinition[] {
        return [...this.models.values()]
            .filter(model => !capability || model.capabilities.includes(capability))
            .map(cloneModel);
    }

    resolve(request: ModelInvocationRequest): ResolvedModelInvocation {
        const model = this.getModel(request.modelId);
        if (!model.capabilities.includes(request.capability)) {
            throw new ModelGatewayError(
                'unsupported_capability',
                `Model ${model.id} does not support capability ${request.capability}.`,
                'capability',
            );
        }
        if (!Array.isArray(request.messages) || request.messages.length === 0) {
            throw new ModelGatewayError('invalid_request', 'messages cannot be empty.', 'messages');
        }
        if (request.tools?.length && !model.capabilities.includes('tool_calling')) {
            throw new ModelGatewayError(
                'unsupported_capability',
                `Model ${model.id} does not support tool calling.`,
                'tools',
            );
        }

        const inputParameters = request.parameters || {};
        const unknown = Object.keys(inputParameters).find(name => !model.parameters[name]);
        if (unknown) {
            throw new ModelGatewayError(
                'invalid_parameter',
                `Unknown parameter for ${model.id}: ${unknown}.`,
                `parameters.${unknown}`,
            );
        }
        const normalizedParameters: Record<string, string | number | boolean> = {};
        for (const [name, definition] of Object.entries(model.parameters)) {
            const supplied = inputParameters[name];
            if (supplied === undefined) {
                if (definition.default !== undefined) normalizedParameters[name] = definition.default;
                else if (definition.required) {
                    throw new ModelGatewayError('invalid_parameter', `parameters.${name} is required.`, `parameters.${name}`);
                }
                continue;
            }
            normalizedParameters[name] = normalizeParameter(name, supplied, definition);
        }

        return {
            ...structuredClone(request),
            model,
            provider: this.getProvider(model.providerId),
            parameters: normalizedParameters,
        };
    }
}
