import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ModelGateway,
    ModelGatewayError,
    ModelRegistry,
    OpenAIChatAdapter,
    OpenAICompatibleHttpTransport,
    ProviderRuntimeConfigStore,
    normalizeOpenAICompatibleBaseUrl,
    type ModelDefinition,
    type ModelProviderDefinition,
} from '../../src/model-gateway/index.ts';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function completionResponse(id = 'chatcmpl-http-test'): Response {
    return jsonResponse({
        id,
        choices: [{
            message: { role: 'assistant', content: 'transport ok' },
            finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
    });
}

function assertGatewayError(
    error: unknown,
    expected: { code: string; httpStatus?: number; retryable?: boolean; path?: string },
): boolean {
    assert.ok(error instanceof ModelGatewayError);
    assert.equal(error.code, expected.code);
    if (expected.httpStatus !== undefined) assert.equal(error.httpStatus, expected.httpStatus);
    if (expected.retryable !== undefined) assert.equal(error.retryable, expected.retryable);
    if (expected.path !== undefined) assert.equal(error.path, expected.path);
    return true;
}

test('OpenAI-compatible Base URL normalization appends the endpoint exactly once', () => {
    assert.equal(
        normalizeOpenAICompatibleBaseUrl(' https://gateway.example/v1/ '),
        'https://gateway.example/v1',
    );
    assert.equal(
        normalizeOpenAICompatibleBaseUrl('https://gateway.example/v1/chat/completions'),
        'https://gateway.example/v1',
    );
    assert.equal(
        normalizeOpenAICompatibleBaseUrl('http://127.0.0.1:8080/'),
        'http://127.0.0.1:8080',
    );
});

test('OpenAI-compatible Base URL rejects endpoint mismatches and embedded secrets', () => {
    assert.throws(
        () => normalizeOpenAICompatibleBaseUrl('https://gateway.example/v1/messages'),
        error => assertGatewayError(error, { code: 'invalid_request', path: 'baseUrl' }),
    );
    assert.throws(
        () => normalizeOpenAICompatibleBaseUrl('https://user:secret@gateway.example/v1'),
        error => assertGatewayError(error, { code: 'invalid_request', path: 'baseUrl' }),
    );
    assert.throws(
        () => normalizeOpenAICompatibleBaseUrl('https://gateway.example/v1?api_key=secret'),
        error => assertGatewayError(error, { code: 'invalid_request', path: 'baseUrl' }),
    );
});

test('provider runtime summaries expose configuration state but never the API key', () => {
    const store = new ProviderRuntimeConfigStore([{
        providerId: 'gateway-a',
        baseUrl: 'https://gateway-a.example/v1',
        apiKey: 'sk-secret-value',
        timeoutMs: 12_345,
    }]);

    const summary = store.describe('gateway-a');
    assert.deepEqual(summary, {
        providerId: 'gateway-a',
        baseUrl: 'https://gateway-a.example/v1',
        timeoutMs: 12_345,
        apiKeyConfigured: true,
    });
    assert.doesNotMatch(JSON.stringify(store.list()), /sk-secret-value/);
});

test('HTTP transport sends OpenAI-compatible JSON and provider-specific authorization', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fakeFetch: typeof fetch = async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return completionResponse();
    };
    const configs = new ProviderRuntimeConfigStore([{
        providerId: 'gateway-a',
        baseUrl: 'https://gateway-a.example/v1/chat/completions',
        apiKey: 'key-for-a',
    }]);
    const transport = new OpenAICompatibleHttpTransport(configs, fakeFetch);

    const result = await transport.complete({
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'hello' }],
    }, { providerId: 'gateway-a' });

    assert.equal(capturedUrl, 'https://gateway-a.example/v1/chat/completions');
    assert.equal(capturedInit?.method, 'POST');
    assert.deepEqual(capturedInit?.headers, {
        'Content-Type': 'application/json',
        Authorization: 'Bearer key-for-a',
    });
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'hello' }],
    });
    assert.equal(result.id, 'chatcmpl-http-test');
});

test('one HTTP transport routes multiple OpenAI-compatible providers independently', async () => {
    const requestedUrls: string[] = [];
    const authorizations: string[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
        requestedUrls.push(String(input));
        authorizations.push(new Headers(init?.headers).get('authorization') || '');
        return completionResponse(`response-${requestedUrls.length}`);
    };
    const providers: ModelProviderDefinition[] = [
        { id: 'gateway-a', displayName: 'Gateway A', protocols: ['openai-chat'] },
        { id: 'gateway-b', displayName: 'Gateway B', protocols: ['openai-chat'] },
    ];
    const createModel = (id: string, providerId: string): ModelDefinition => ({
        id,
        displayName: id,
        providerId,
        protocol: 'openai-chat',
        upstreamModel: 'shared-upstream-name',
        capabilities: ['chat'],
        inputModalities: ['text'],
        outputModalities: ['text'],
        parameters: {},
    });
    const registry = new ModelRegistry({
        providers,
        models: [createModel('chat.gateway-a', 'gateway-a'), createModel('chat.gateway-b', 'gateway-b')],
    });
    const configs = new ProviderRuntimeConfigStore([
        { providerId: 'gateway-a', baseUrl: 'https://a.example/v1', apiKey: 'key-a' },
        { providerId: 'gateway-b', baseUrl: 'https://b.example/openai/v1', apiKey: 'key-b' },
    ]);
    const gateway = new ModelGateway(registry, [
        new OpenAIChatAdapter(new OpenAICompatibleHttpTransport(configs, fakeFetch)),
    ]);

    await gateway.invoke({
        modelId: 'chat.gateway-a',
        capability: 'chat',
        messages: [{ role: 'user', content: 'A' }],
    });
    await gateway.invoke({
        modelId: 'chat.gateway-b',
        capability: 'chat',
        messages: [{ role: 'user', content: 'B' }],
    });

    assert.deepEqual(requestedUrls, [
        'https://a.example/v1/chat/completions',
        'https://b.example/openai/v1/chat/completions',
    ]);
    assert.deepEqual(authorizations, ['Bearer key-a', 'Bearer key-b']);
});

for (const scenario of [
    { status: 401, code: 'provider_access_denied', retryable: false },
    { status: 403, code: 'provider_access_denied', retryable: false },
    { status: 404, code: 'provider_endpoint_not_found', retryable: false },
    { status: 429, code: 'provider_rate_limited', retryable: true },
    { status: 500, code: 'provider_error', retryable: true },
    { status: 400, code: 'provider_error', retryable: false },
] as const) {
    test(`HTTP transport maps ${scenario.status} to ${scenario.code}`, async () => {
        const configs = new ProviderRuntimeConfigStore([{
            providerId: 'gateway-a',
            baseUrl: 'https://gateway.example/v1',
            apiKey: 'secret',
        }]);
        const transport = new OpenAICompatibleHttpTransport(
            configs,
            async () => jsonResponse({ error: { message: 'upstream detail must not leak' } }, scenario.status),
        );

        await assert.rejects(
            transport.complete({ model: 'model', messages: [] }, { providerId: 'gateway-a' }),
            error => {
                assertGatewayError(error, scenario);
                assert.doesNotMatch((error as Error).message, /upstream detail/);
                return true;
            },
        );
    });
}

test('HTTP transport aborts a request at the configured timeout', async () => {
    const configs = new ProviderRuntimeConfigStore([{
        providerId: 'slow-gateway',
        baseUrl: 'https://slow.example/v1',
        apiKey: 'secret',
        timeoutMs: 5,
    }]);
    const fakeFetch: typeof fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
        });
    });
    const transport = new OpenAICompatibleHttpTransport(configs, fakeFetch);

    await assert.rejects(
        transport.complete({ model: 'model', messages: [] }, { providerId: 'slow-gateway' }),
        error => assertGatewayError(error, { code: 'provider_timeout', retryable: true }),
    );
});

test('HTTP transport rejects a successful response with invalid JSON', async () => {
    const configs = new ProviderRuntimeConfigStore([{
        providerId: 'gateway-a',
        baseUrl: 'https://gateway.example/v1',
        apiKey: 'secret',
    }]);
    const transport = new OpenAICompatibleHttpTransport(
        configs,
        async () => new Response('not-json', { status: 200 }),
    );

    await assert.rejects(
        transport.complete({ model: 'model', messages: [] }, { providerId: 'gateway-a' }),
        error => assertGatewayError(error, { code: 'provider_error', httpStatus: 200, retryable: false }),
    );
});
