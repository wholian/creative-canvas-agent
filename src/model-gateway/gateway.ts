import { ModelRegistry } from './registry.ts';
import {
    ModelGatewayError,
    type GatewayInvocationResult,
    type ModelAdapter,
    type ModelInvocationRequest,
    type ModelInvocationOptions,
    type ModelProtocol,
} from './types.ts';
import type { ModelTraceRecord, ModelTraceStore } from './trace.ts';

interface ModelGatewayOptions {
    traceStore?: ModelTraceStore;
    now?: () => number;
    traceIdFactory?: () => string;
}

export class ModelGateway {
    private readonly adapters = new Map<ModelProtocol, ModelAdapter>();
    private readonly registry: ModelRegistry;
    private readonly traceStore?: ModelTraceStore;
    private readonly now: () => number;
    private readonly traceIdFactory: () => string;

    constructor(registry: ModelRegistry, adapters: ModelAdapter[] = [], options: ModelGatewayOptions = {}) {
        this.registry = registry;
        this.traceStore = options.traceStore;
        this.now = options.now || (() => Date.now());
        this.traceIdFactory = options.traceIdFactory || (() => `trace-${crypto.randomUUID()}`);
        adapters.forEach(adapter => this.registerAdapter(adapter));
    }

    registerAdapter(adapter: ModelAdapter): void {
        if (this.adapters.has(adapter.protocol)) {
            throw new ModelGatewayError('invalid_request', `Adapter already exists for protocol ${adapter.protocol}.`);
        }
        this.adapters.set(adapter.protocol, adapter);
    }

    async invoke(request: ModelInvocationRequest, options: ModelInvocationOptions = {}): Promise<GatewayInvocationResult> {
        const traceId = this.traceIdFactory();
        const startedAtMs = this.now();
        let trace: ModelTraceRecord = {
            traceId,
            status: 'running',
            startedAt: new Date(startedAtMs).toISOString(),
            request: structuredClone(request),
        };
        this.traceStore?.save(trace);

        try {
            const resolved = this.registry.resolve(request);
            trace = {
                ...trace,
                route: {
                    providerId: resolved.provider.id,
                    protocol: resolved.model.protocol,
                    upstreamModel: resolved.model.upstreamModel,
                    normalizedParameters: structuredClone(resolved.parameters),
                },
            };
            this.traceStore?.save(trace);

            const adapter = this.adapters.get(resolved.model.protocol);
            if (!adapter) {
                throw new ModelGatewayError(
                    'adapter_not_found',
                    `No adapter registered for protocol ${resolved.model.protocol}.`,
                );
            }
            const adapterResult = await adapter.invoke(resolved, options);
            const result: GatewayInvocationResult = { ...adapterResult, traceId };
            const finishedAtMs = this.now();
            trace = {
                ...trace,
                status: 'succeeded',
                finishedAt: new Date(finishedAtMs).toISOString(),
                durationMs: Math.max(0, finishedAtMs - startedAtMs),
                response: structuredClone(result),
            };
            this.traceStore?.save(trace);
            return result;
        } catch (error) {
            const gatewayError = error instanceof ModelGatewayError
                ? error
                : new ModelGatewayError(
                    'provider_error',
                    error instanceof Error ? error.message : 'Model invocation failed.',
                );
            gatewayError.traceId = traceId;
            const finishedAtMs = this.now();
            trace = {
                ...trace,
                status: 'failed',
                finishedAt: new Date(finishedAtMs).toISOString(),
                durationMs: Math.max(0, finishedAtMs - startedAtMs),
                error: {
                    code: gatewayError.code,
                    message: gatewayError.message,
                    ...(gatewayError.path ? { path: gatewayError.path } : {}),
                    ...(gatewayError.httpStatus !== undefined ? { httpStatus: gatewayError.httpStatus } : {}),
                    ...(gatewayError.retryable !== undefined ? { retryable: gatewayError.retryable } : {}),
                },
            };
            this.traceStore?.save(trace);
            throw gatewayError;
        }
    }
}
