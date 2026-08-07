import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MOCK_MODELS,
    MOCK_PROVIDER,
    MockModelAdapter,
    ModelGateway,
    ModelGatewayError,
    ModelRegistry,
    OpenAIChatAdapter,
    type ModelDefinition,
    type OpenAIChatCompletionRequest,
    type OpenAIChatTransport,
} from '../../src/model-gateway/index.ts';

function createRegistry(): ModelRegistry {
    return new ModelRegistry({ providers: [MOCK_PROVIDER], models: MOCK_MODELS });
}

function assertGatewayError(error: unknown, code: string, path?: string): boolean {
    assert.ok(error instanceof ModelGatewayError);
    assert.equal(error.code, code);
    if (path !== undefined) assert.equal(error.path, path);
    return true;
}

test('model registry separates stable model IDs from provider and upstream model names', () => {
    const registry = createRegistry();
    const model = registry.getModel('mock.chat.tool-use');

    assert.equal(model.providerId, 'mock');
    assert.equal(model.protocol, 'mock');
    assert.equal(model.upstreamModel, 'mock-chat-tool-use');
    assert.deepEqual(model.capabilities, ['chat', 'tool_calling']);
    assert.deepEqual(registry.listModels('tool_calling').map(candidate => candidate.id), ['mock.chat.tool-use']);
});

test('registry refuses a model whose protocol is unsupported by its provider', () => {
    const registry = new ModelRegistry({ providers: [MOCK_PROVIDER] });
    const invalidModel: ModelDefinition = {
        ...MOCK_MODELS[0],
        id: 'invalid.protocol-model',
        protocol: 'openai-chat',
    };

    assert.throws(
        () => registry.registerModel(invalidModel),
        error => assertGatewayError(error, 'protocol_mismatch', 'model.protocol'),
    );
});

test('registry applies defaults and rejects unknown or out-of-range parameters', () => {
    const registry = createRegistry();
    const resolved = registry.resolve({
        modelId: 'mock.chat.basic',
        capability: 'chat',
        messages: [{ role: 'user', content: 'hello' }],
    });

    assert.deepEqual(resolved.parameters, { temperature: 0.7, max_tokens: 2048 });
    assert.throws(
        () => registry.resolve({
            modelId: 'mock.chat.basic',
            capability: 'chat',
            messages: [{ role: 'user', content: 'hello' }],
            parameters: { temperature: 3 },
        }),
        error => assertGatewayError(error, 'invalid_parameter', 'parameters.temperature'),
    );
    assert.throws(
        () => registry.resolve({
            modelId: 'mock.chat.basic',
            capability: 'chat',
            messages: [{ role: 'user', content: 'hello' }],
            parameters: { hidden_provider_flag: true },
        }),
        error => assertGatewayError(error, 'invalid_parameter', 'parameters.hidden_provider_flag'),
    );
});

test('registry blocks tools on a model without tool-calling capability', () => {
    const registry = createRegistry();
    assert.throws(
        () => registry.resolve({
            modelId: 'mock.chat.basic',
            capability: 'chat',
            messages: [{ role: 'user', content: 'add a node' }],
            tools: [{ name: 'add_canvas_node', description: 'Add a node', inputSchema: {} }],
        }),
        error => assertGatewayError(error, 'unsupported_capability', 'tools'),
    );
});

test('mock gateway returns a deterministic normal assistant response without network access', async () => {
    const gateway = new ModelGateway(createRegistry(), [new MockModelAdapter()]);
    const result = await gateway.invoke({
        modelId: 'mock.chat.basic',
        capability: 'chat',
        messages: [{ role: 'user', content: 'hello canvas' }],
    });

    assert.equal(result.providerId, 'mock');
    assert.equal(result.protocol, 'mock');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.message.content, 'Mock response: hello canvas');
    assert.ok(result.usage?.inputTokens);
});

test('mock tool-use model returns a canonical tool call rather than provider-specific output', async () => {
    const gateway = new ModelGateway(createRegistry(), [new MockModelAdapter()]);
    const result = await gateway.invoke({
        modelId: 'mock.chat.tool-use',
        capability: 'chat',
        messages: [{ role: 'user', content: '创建一个森林图片节点' }],
        tools: [{
            name: 'add_canvas_node',
            description: 'Add an editable node to the canvas',
            inputSchema: {
                type: 'object',
                properties: { node_type: { type: 'string' }, prompt: { type: 'string' } },
            },
        }],
    });

    assert.equal(result.finishReason, 'tool_calls');
    assert.equal(result.message.toolCalls?.[0].name, 'add_canvas_node');
    assert.deepEqual(result.message.toolCalls?.[0].arguments, {
        node_type: 'image',
        prompt: '创建一个森林图片节点',
    });
});

test('mock provider failures use one structured gateway error', async () => {
    const gateway = new ModelGateway(createRegistry(), [new MockModelAdapter()]);
    await assert.rejects(
        gateway.invoke({
            modelId: 'mock.chat.error',
            capability: 'chat',
            messages: [{ role: 'user', content: 'fail intentionally' }],
        }),
        error => assertGatewayError(error, 'provider_error'),
    );
});

test('gateway fails explicitly when a registered protocol has no adapter', async () => {
    const gateway = new ModelGateway(createRegistry());
    await assert.rejects(
        gateway.invoke({
            modelId: 'mock.chat.basic',
            capability: 'chat',
            messages: [{ role: 'user', content: 'hello' }],
        }),
        error => assertGatewayError(error, 'adapter_not_found'),
    );
});

function createOpenAICompatibleRegistry(): ModelRegistry {
    return new ModelRegistry({
        providers: [{
            id: 'third-party-gateway',
            displayName: 'Third-party OpenAI-compatible Gateway',
            protocols: ['openai-chat'],
        }],
        models: [{
            id: 'agent.gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash via Gateway',
            providerId: 'third-party-gateway',
            protocol: 'openai-chat',
            upstreamModel: 'gemini-2.5-flash',
            capabilities: ['chat', 'tool_calling'],
            inputModalities: ['text'],
            outputModalities: ['text'],
            parameters: {
                temperature: { type: 'number', minimum: 0, maximum: 2, default: 0.7 },
                max_tokens: { type: 'number', minimum: 1, maximum: 8192, default: 2048 },
            },
        }],
    });
}

test('OpenAI-compatible adapter translates canonical messages and tools in both directions', async () => {
    let captured: OpenAIChatCompletionRequest | undefined;
    const transport: OpenAIChatTransport = {
        async complete(request) {
            captured = structuredClone(request);
            return {
                id: 'chatcmpl-test-1',
                choices: [{
                    message: {
                        role: 'assistant',
                        content: 'I will add the draft.',
                        tool_calls: [{
                            id: 'call-add-node',
                            type: 'function',
                            function: {
                                name: 'add_canvas_node',
                                arguments: JSON.stringify({ node_type: 'image', prompt: '森林远景' }),
                            },
                        }],
                    },
                    finish_reason: 'tool_calls',
                }],
                usage: { prompt_tokens: 42, completion_tokens: 18 },
            };
        },
    };
    const gateway = new ModelGateway(createOpenAICompatibleRegistry(), [new OpenAIChatAdapter(transport)]);
    const result = await gateway.invoke({
        modelId: 'agent.gemini-2.5-flash',
        capability: 'chat',
        messages: [
            { role: 'system', content: 'You are the canvas agent.' },
            { role: 'user', content: '增加一个森林远景节点' },
        ],
        tools: [{
            name: 'add_canvas_node',
            description: 'Add one editable canvas node',
            inputSchema: { type: 'object', required: ['node_type', 'prompt'] },
        }],
    });

    assert.equal(captured?.model, 'gemini-2.5-flash');
    assert.deepEqual(captured?.messages.map(message => message.role), ['system', 'user']);
    assert.equal(captured?.tools?.[0].function.name, 'add_canvas_node');
    assert.equal(captured?.temperature, 0.7);
    assert.equal(captured?.max_tokens, 2048);
    assert.equal(result.modelId, 'agent.gemini-2.5-flash');
    assert.equal(result.providerId, 'third-party-gateway');
    assert.equal(result.finishReason, 'tool_calls');
    assert.deepEqual(result.message.toolCalls?.[0], {
        id: 'call-add-node',
        name: 'add_canvas_node',
        arguments: { node_type: 'image', prompt: '森林远景' },
    });
    assert.deepEqual(result.usage, { inputTokens: 42, outputTokens: 18 });
});

test('OpenAI-compatible adapter preserves assistant tool calls and tool results on the second turn', async () => {
    let captured: OpenAIChatCompletionRequest | undefined;
    const transport: OpenAIChatTransport = {
        async complete(request) {
            captured = structuredClone(request);
            return {
                id: 'chatcmpl-test-2',
                choices: [{ message: { role: 'assistant', content: '节点已创建。' }, finish_reason: 'stop' }],
            };
        },
    };
    const gateway = new ModelGateway(createOpenAICompatibleRegistry(), [new OpenAIChatAdapter(transport)]);
    await gateway.invoke({
        modelId: 'agent.gemini-2.5-flash',
        capability: 'chat',
        messages: [
            { role: 'user', content: '增加图片节点' },
            {
                role: 'assistant',
                content: '',
                toolCalls: [{
                    id: 'call-1',
                    name: 'add_canvas_node',
                    arguments: { node_type: 'image', prompt: '森林' },
                }],
            },
            { role: 'tool', toolCallId: 'call-1', content: JSON.stringify({ status: 'succeeded', node_id: 'node-123' }) },
        ],
    });

    assert.equal(captured?.messages[1].tool_calls?.[0].id, 'call-1');
    assert.equal(captured?.messages[2].tool_call_id, 'call-1');
    assert.match(captured?.messages[2].content || '', /node-123/);
});
