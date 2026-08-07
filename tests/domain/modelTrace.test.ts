import assert from 'node:assert/strict';
import test from 'node:test';
import {
    InMemoryModelTraceStore,
    MOCK_MODELS,
    MOCK_PROVIDER,
    MockModelAdapter,
    ModelGateway,
    ModelGatewayError,
    ModelRegistry,
    redactTraceValue,
    type ModelTraceRecord,
} from '../../src/model-gateway/index.ts';

function createRegistry(): ModelRegistry {
    return new ModelRegistry({ providers: [MOCK_PROVIDER], models: MOCK_MODELS });
}

test('trace redaction removes credential values without corrupting token usage or tool schemas', () => {
    const value = redactTraceValue({
        apiKey: 'super-secret-key',
        Authorization: 'Bearer provider-secret',
        nested: {
            access_token: 'access-secret',
            inputTokens: 42,
            credentials: { clientId: 'client-id', secret: 'nested-secret' },
        },
        prompt: 'Header Authorization: Bearer inline-secret and key sk-1234567890abcdef',
        inputSchema: {
            properties: {
                token: { type: 'string', description: 'A user-supplied field definition, not a credential value.' },
            },
        },
    });

    assert.equal(value.apiKey, '[REDACTED]');
    assert.equal(value.Authorization, '[REDACTED]');
    assert.equal(value.nested.access_token, '[REDACTED]');
    assert.equal(value.nested.inputTokens, 42);
    assert.equal(value.nested.credentials, '[REDACTED]');
    assert.equal(value.prompt, 'Header Authorization: Bearer [REDACTED] and key [REDACTED]');
    assert.deepEqual(value.inputSchema.properties.token, {
        type: 'string',
        description: 'A user-supplied field definition, not a credential value.',
    });
});

test('trace store keeps defensive redacted snapshots', () => {
    const store = new InMemoryModelTraceStore();
    const record: ModelTraceRecord = {
        traceId: 'trace-defensive',
        status: 'running',
        startedAt: '2026-08-07T00:00:00.000Z',
        request: {
            modelId: 'mock.chat.basic',
            capability: 'chat',
            messages: [{ role: 'user', content: 'Bearer private-value' }],
        },
    };
    store.save(record);
    const first = store.get(record.traceId);
    assert.ok(first);
    first.request.modelId = 'mutated';

    const second = store.get(record.traceId);
    assert.equal(second?.request.modelId, 'mock.chat.basic');
    assert.equal(second?.request.messages[0].content, 'Bearer [REDACTED]');
    assert.equal(record.request.messages[0].content, 'Bearer private-value');
});

test('gateway records route, normalized parameters, response and duration for a successful call', async () => {
    const traceStore = new InMemoryModelTraceStore();
    const times = [1_000, 1_125];
    const gateway = new ModelGateway(createRegistry(), [new MockModelAdapter()], {
        traceStore,
        traceIdFactory: () => 'trace-success',
        now: () => times.shift() ?? 1_125,
    });
    const result = await gateway.invoke({
        modelId: 'mock.chat.basic',
        capability: 'chat',
        messages: [{ role: 'user', content: 'hello trace' }],
    });
    const trace = traceStore.get('trace-success');

    assert.equal(result.traceId, 'trace-success');
    assert.equal(trace?.status, 'succeeded');
    assert.equal(trace?.durationMs, 125);
    assert.deepEqual(trace?.route, {
        providerId: 'mock',
        protocol: 'mock',
        upstreamModel: 'mock-chat-basic',
        normalizedParameters: { temperature: 0.7, max_tokens: 2048 },
    });
    assert.equal(trace?.response?.message.content, 'Mock response: hello trace');
    assert.equal(trace?.response?.traceId, 'trace-success');
});

test('gateway trace records canonical tool calls and the following tool result message', async () => {
    const traceStore = new InMemoryModelTraceStore();
    const gateway = new ModelGateway(createRegistry(), [new MockModelAdapter()], {
        traceStore,
        traceIdFactory: () => 'trace-tool-result',
        now: (() => {
            const values = [2_000, 2_010];
            return () => values.shift() ?? 2_010;
        })(),
    });
    await gateway.invoke({
        modelId: 'mock.chat.tool-use',
        capability: 'chat',
        messages: [
            { role: 'user', content: 'add a node' },
            {
                role: 'assistant',
                content: '',
                toolCalls: [{ id: 'call-1', name: 'add_canvas_node', arguments: { node_type: 'image', prompt: 'forest' } }],
            },
            { role: 'tool', toolCallId: 'call-1', content: JSON.stringify({ status: 'succeeded', node_id: 'node-123' }) },
        ],
        tools: [{ name: 'add_canvas_node', description: 'Add a node', inputSchema: { type: 'object' } }],
    });
    const trace = traceStore.get('trace-tool-result');

    assert.equal(trace?.request.messages[1].toolCalls?.[0].id, 'call-1');
    assert.equal(trace?.request.messages[2].toolCallId, 'call-1');
    assert.match(trace?.request.messages[2].content || '', /node-123/);
    assert.equal(trace?.response?.message.toolCalls?.[0].name, 'add_canvas_node');
});

test('gateway records structured provider failures and attaches traceId to the thrown error', async () => {
    const traceStore = new InMemoryModelTraceStore();
    const gateway = new ModelGateway(createRegistry(), [new MockModelAdapter()], {
        traceStore,
        traceIdFactory: () => 'trace-failure',
        now: (() => {
            const values = [3_000, 3_075];
            return () => values.shift() ?? 3_075;
        })(),
    });

    await assert.rejects(
        gateway.invoke({
            modelId: 'mock.chat.error',
            capability: 'chat',
            messages: [{ role: 'user', content: 'fail' }],
        }),
        error => {
            assert.ok(error instanceof ModelGatewayError);
            assert.equal(error.code, 'provider_error');
            assert.equal(error.traceId, 'trace-failure');
            return true;
        },
    );
    const trace = traceStore.get('trace-failure');
    assert.equal(trace?.status, 'failed');
    assert.equal(trace?.durationMs, 75);
    assert.equal(trace?.error?.code, 'provider_error');
    assert.equal(trace?.route?.upstreamModel, 'mock-chat-error');
    assert.equal(trace?.response, undefined);
});

test('mock traces distinguish timeout, 401, 404 and 429 retry behavior', async () => {
    const cases = [
        { mode: 'timeout', code: 'provider_timeout', status: undefined, retryable: true },
        { mode: '401', code: 'provider_access_denied', status: 401, retryable: false },
        { mode: '404', code: 'provider_endpoint_not_found', status: 404, retryable: false },
        { mode: '429', code: 'provider_rate_limited', status: 429, retryable: true },
    ] as const;

    for (const scenario of cases) {
        const traceStore = new InMemoryModelTraceStore();
        const traceId = `trace-${scenario.mode}`;
        const gateway = new ModelGateway(createRegistry(), [new MockModelAdapter()], {
            traceStore,
            traceIdFactory: () => traceId,
            now: () => 5_000,
        });
        await assert.rejects(
            gateway.invoke({
                modelId: 'mock.chat.error',
                capability: 'chat',
                messages: [{ role: 'user', content: `simulate ${scenario.mode}` }],
                parameters: { error_mode: scenario.mode },
            }),
            error => error instanceof ModelGatewayError
                && error.code === scenario.code
                && error.httpStatus === scenario.status
                && error.retryable === scenario.retryable,
        );
        const trace = traceStore.get(traceId);
        assert.equal(trace?.error?.code, scenario.code);
        assert.equal(trace?.error?.httpStatus, scenario.status);
        assert.equal(trace?.error?.retryable, scenario.retryable);
    }
});

test('gateway records validation failures before a provider route is selected', async () => {
    const traceStore = new InMemoryModelTraceStore();
    const gateway = new ModelGateway(createRegistry(), [new MockModelAdapter()], {
        traceStore,
        traceIdFactory: () => 'trace-validation-failure',
        now: () => 4_000,
    });

    await assert.rejects(
        gateway.invoke({
            modelId: 'missing.model',
            capability: 'chat',
            messages: [{ role: 'user', content: 'hello' }],
        }),
        error => error instanceof ModelGatewayError && error.code === 'model_not_found',
    );
    const trace = traceStore.get('trace-validation-failure');
    assert.equal(trace?.status, 'failed');
    assert.equal(trace?.error?.code, 'model_not_found');
    assert.equal(trace?.route, undefined);
});
