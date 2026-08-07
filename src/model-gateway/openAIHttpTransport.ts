import type {
    OpenAIChatCompletionRequest,
    OpenAIChatCompletionResponse,
    OpenAIChatTransport,
} from './openAIChatAdapter.ts';
import { ProviderRuntimeConfigStore } from './providerRuntime.ts';
import { ModelGatewayError } from './types.ts';

type FetchImplementation = typeof fetch;

export function normalizeOpenAICompatibleBaseUrl(baseUrl: string): string {
    const trimmed = baseUrl.trim();
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new ModelGatewayError('invalid_request', 'Provider baseUrl must be a valid absolute URL.', 'baseUrl');
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new ModelGatewayError('invalid_request', 'Provider baseUrl must use http or https.', 'baseUrl');
    }
    if (parsed.username || parsed.password) {
        throw new ModelGatewayError('invalid_request', 'Provider baseUrl must not contain credentials.', 'baseUrl');
    }
    if (parsed.search || parsed.hash) {
        throw new ModelGatewayError('invalid_request', 'Provider baseUrl must not contain a query or fragment.', 'baseUrl');
    }

    let pathname = parsed.pathname.replace(/\/+$/, '');
    if (/\/messages$/i.test(pathname)) {
        throw new ModelGatewayError(
            'invalid_request',
            'OpenAI-compatible baseUrl must not point to an Anthropic /messages endpoint.',
            'baseUrl',
        );
    }
    pathname = pathname.replace(/\/chat\/completions$/i, '');
    parsed.pathname = pathname || '/';

    return parsed.toString().replace(/\/$/, '');
}

function mapHttpError(status: number): ModelGatewayError {
    if (status === 401 || status === 403) {
        return new ModelGatewayError(
            'provider_access_denied',
            `OpenAI-compatible provider denied access (HTTP ${status}).`,
            undefined,
            { httpStatus: status, retryable: false },
        );
    }
    if (status === 404) {
        return new ModelGatewayError(
            'provider_endpoint_not_found',
            'OpenAI-compatible provider endpoint was not found (HTTP 404). Check the Base URL.',
            undefined,
            { httpStatus: status, retryable: false },
        );
    }
    if (status === 429) {
        return new ModelGatewayError(
            'provider_rate_limited',
            'OpenAI-compatible provider rate limit was reached (HTTP 429).',
            undefined,
            { httpStatus: status, retryable: true },
        );
    }
    return new ModelGatewayError(
        'provider_error',
        `OpenAI-compatible provider failed (HTTP ${status}).`,
        undefined,
        { httpStatus: status, retryable: status >= 500 },
    );
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException
        ? error.name === 'AbortError'
        : error instanceof Error && error.name === 'AbortError';
}

export class OpenAICompatibleHttpTransport implements OpenAIChatTransport {
    private readonly configs: ProviderRuntimeConfigStore;
    private readonly fetchImplementation: FetchImplementation;

    constructor(configs: ProviderRuntimeConfigStore, fetchImplementation: FetchImplementation = fetch) {
        this.configs = configs;
        this.fetchImplementation = fetchImplementation;
    }

    async complete(
        request: OpenAIChatCompletionRequest,
        context: { providerId: string },
    ): Promise<OpenAIChatCompletionResponse> {
        const config = this.configs.require(context.providerId);
        const baseUrl = normalizeOpenAICompatibleBaseUrl(config.baseUrl);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

        try {
            const response = await this.fetchImplementation(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify(request),
                signal: controller.signal,
            });

            if (!response.ok) throw mapHttpError(response.status);

            try {
                return await response.json() as OpenAIChatCompletionResponse;
            } catch {
                throw new ModelGatewayError(
                    'provider_error',
                    'OpenAI-compatible provider returned invalid JSON.',
                    undefined,
                    { httpStatus: response.status, retryable: false },
                );
            }
        } catch (error) {
            if (error instanceof ModelGatewayError) throw error;
            if (isAbortError(error)) {
                throw new ModelGatewayError(
                    'provider_timeout',
                    `OpenAI-compatible provider timed out after ${config.timeoutMs} ms.`,
                    undefined,
                    { retryable: true },
                );
            }
            throw new ModelGatewayError(
                'provider_error',
                'OpenAI-compatible provider request could not be completed.',
                undefined,
                { retryable: true },
            );
        } finally {
            clearTimeout(timeout);
        }
    }
}
