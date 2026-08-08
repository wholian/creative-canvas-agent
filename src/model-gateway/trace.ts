import type {
    GatewayInvocationResult,
    ModelGatewayErrorCode,
    ModelInvocationRequest,
    ModelProtocol,
} from './types.ts';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEYS = new Set([
    'apikey',
    'authorization',
    'accesstoken',
    'refreshtoken',
    'clientsecret',
    'apisecret',
    'password',
    'credential',
    'credentials',
    'token',
]);

function normalizedKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function scrubString(value: string): string {
    return value
        .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, `Bearer ${REDACTED}`)
        .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[op]_[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{12,})\b/g, REDACTED);
}

function redactTraceValueInternal<T>(value: T, parentKey?: string): T {
    if (typeof value === 'string') return scrubString(value) as T;
    if (Array.isArray(value)) return value.map(item => redactTraceValueInternal(item, parentKey)) as T;
    if (!value || typeof value !== 'object') return value;

    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (normalizedKey(key) === 'base64' && typeof child === 'string') {
            output[key] = `[MEDIA_DATA_REDACTED length=${child.length}]`;
            continue;
        }
        const isSensitive = SENSITIVE_KEYS.has(normalizedKey(key));
        const isSchemaPropertyDefinition = normalizedKey(parentKey || '') === 'properties'
            && child !== null
            && typeof child === 'object'
            && ('type' in child || '$ref' in child);
        output[key] = isSensitive && !isSchemaPropertyDefinition
            ? REDACTED
            : redactTraceValueInternal(child, key);
    }
    return output as T;
}

export function redactTraceValue<T>(value: T): T {
    return redactTraceValueInternal(value);
}

export interface ModelTraceRoute {
    providerId: string;
    protocol: ModelProtocol;
    upstreamModel: string;
    normalizedParameters: Record<string, string | number | boolean>;
}

export interface ModelTraceRecord {
    traceId: string;
    status: 'running' | 'succeeded' | 'failed';
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    request: ModelInvocationRequest;
    route?: ModelTraceRoute;
    response?: GatewayInvocationResult;
    error?: {
        code: ModelGatewayErrorCode;
        message: string;
        path?: string;
        httpStatus?: number;
        retryable?: boolean;
    };
}

export interface ModelTraceStore {
    save(record: ModelTraceRecord): void;
    get(traceId: string): ModelTraceRecord | undefined;
    list(): ModelTraceRecord[];
}

export class InMemoryModelTraceStore implements ModelTraceStore {
    private readonly records = new Map<string, ModelTraceRecord>();

    save(record: ModelTraceRecord): void {
        this.records.set(record.traceId, redactTraceValue(structuredClone(record)));
    }

    get(traceId: string): ModelTraceRecord | undefined {
        const record = this.records.get(traceId);
        return record ? structuredClone(record) : undefined;
    }

    list(): ModelTraceRecord[] {
        return [...this.records.values()].map(record => structuredClone(record));
    }
}
