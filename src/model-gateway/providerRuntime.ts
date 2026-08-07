import { ModelGatewayError } from './types.ts';

export interface ProviderRuntimeConfig {
    providerId: string;
    baseUrl: string;
    apiKey: string;
    timeoutMs?: number;
}

export interface ProviderRuntimeSummary {
    providerId: string;
    baseUrl: string;
    timeoutMs: number;
    apiKeyConfigured: boolean;
}

const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;
const MIN_PROVIDER_TIMEOUT_MS = 1;
const MAX_PROVIDER_TIMEOUT_MS = 300_000;
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function validateRuntimeConfig(config: ProviderRuntimeConfig): Required<ProviderRuntimeConfig> {
    if (!STABLE_ID_PATTERN.test(config.providerId)) {
        throw new ModelGatewayError(
            'invalid_request',
            'Provider runtime config requires a stable providerId.',
            'providerId',
        );
    }
    if (!config.baseUrl.trim()) {
        throw new ModelGatewayError('invalid_request', 'Provider baseUrl is required.', 'baseUrl');
    }
    if (!config.apiKey.trim()) {
        throw new ModelGatewayError('invalid_request', 'Provider apiKey is required.', 'apiKey');
    }

    const timeoutMs = config.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_PROVIDER_TIMEOUT_MS || timeoutMs > MAX_PROVIDER_TIMEOUT_MS) {
        throw new ModelGatewayError(
            'invalid_request',
            `Provider timeoutMs must be an integer between ${MIN_PROVIDER_TIMEOUT_MS} and ${MAX_PROVIDER_TIMEOUT_MS}.`,
            'timeoutMs',
        );
    }

    return {
        providerId: config.providerId,
        baseUrl: config.baseUrl.trim(),
        apiKey: config.apiKey.trim(),
        timeoutMs,
    };
}

function cloneConfig(config: Required<ProviderRuntimeConfig>): Required<ProviderRuntimeConfig> {
    return { ...config };
}

function summarizeConfig(config: Required<ProviderRuntimeConfig>): ProviderRuntimeSummary {
    return {
        providerId: config.providerId,
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
        apiKeyConfigured: Boolean(config.apiKey),
    };
}

export class ProviderRuntimeConfigStore {
    private readonly configs = new Map<string, Required<ProviderRuntimeConfig>>();

    constructor(configs: ProviderRuntimeConfig[] = []) {
        configs.forEach(config => this.upsert(config));
    }

    upsert(config: ProviderRuntimeConfig): ProviderRuntimeSummary {
        const validated = validateRuntimeConfig(config);
        this.configs.set(validated.providerId, validated);
        return summarizeConfig(validated);
    }

    require(providerId: string): Required<ProviderRuntimeConfig> {
        const config = this.configs.get(providerId);
        if (!config) {
            throw new ModelGatewayError(
                'provider_not_found',
                `No runtime configuration exists for provider ${providerId}.`,
                'providerId',
            );
        }
        return cloneConfig(config);
    }

    describe(providerId: string): ProviderRuntimeSummary | undefined {
        const config = this.configs.get(providerId);
        return config ? summarizeConfig(config) : undefined;
    }

    list(): ProviderRuntimeSummary[] {
        return Array.from(this.configs.values(), summarizeConfig);
    }
}
