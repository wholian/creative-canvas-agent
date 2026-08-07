import { ModelRegistry } from './registry.ts';
import {
    ModelGatewayError,
    type ModelAdapter,
    type ModelInvocationRequest,
    type ModelInvocationResult,
    type ModelProtocol,
} from './types.ts';

export class ModelGateway {
    private readonly adapters = new Map<ModelProtocol, ModelAdapter>();
    private readonly registry: ModelRegistry;

    constructor(registry: ModelRegistry, adapters: ModelAdapter[] = []) {
        this.registry = registry;
        adapters.forEach(adapter => this.registerAdapter(adapter));
    }

    registerAdapter(adapter: ModelAdapter): void {
        if (this.adapters.has(adapter.protocol)) {
            throw new ModelGatewayError('invalid_request', `Adapter already exists for protocol ${adapter.protocol}.`);
        }
        this.adapters.set(adapter.protocol, adapter);
    }

    async invoke(request: ModelInvocationRequest): Promise<ModelInvocationResult> {
        const resolved = this.registry.resolve(request);
        const adapter = this.adapters.get(resolved.model.protocol);
        if (!adapter) {
            throw new ModelGatewayError(
                'adapter_not_found',
                `No adapter registered for protocol ${resolved.model.protocol}.`,
            );
        }
        return adapter.invoke(resolved);
    }
}
