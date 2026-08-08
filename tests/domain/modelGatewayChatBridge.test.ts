import assert from 'node:assert/strict';
import test from 'node:test';
import { HumanMessage } from '@langchain/core/messages';
import {
    completeCanvasToolAgent,
    startCanvasToolAgent,
} from '../../server/agent/graph/chatGraph.js';
import { createCanvasChatModelGatewayRuntime } from '../../server/agent/modelGatewayRuntime.js';

test('feature-gated canvas chat uses the unified Gateway for both tool-call turns', async () => {
    const invocations: Array<Record<string, any>> = [];
    const modelGatewayRuntime = {
        async invoke(request: Record<string, any>) {
            invocations.push(structuredClone(request));
            if (invocations.length === 1) {
                return {
                    traceId: 'trace-first',
                    message: {
                        role: 'assistant',
                        content: '准备创建节点。',
                        toolCalls: [{
                            id: 'call-add-1',
                            name: 'add_canvas_node',
                            arguments: {
                                node_type: 'image',
                                prompt: '雾中的森林远景',
                                aspect_ratio: '16:9',
                                quality: '2K',
                            },
                        }],
                    },
                };
            }
            return {
                traceId: 'trace-second',
                message: { role: 'assistant', content: '森林图片草稿节点已经创建。' },
            };
        },
    };
    const config = {
        apiKey: 'not-used-by-fake-runtime',
        baseUrl: 'https://unused.example/v1',
        modelName: 'unused-upstream-name',
        modelGatewayRuntime,
    };

    const started = await startCanvasToolAgent(
        [new HumanMessage('添加一个 16:9、2K 的森林图片节点')],
        config,
    );

    assert.equal(started.status, 'awaiting_client');
    assert.deepEqual(started.traceIds, ['trace-first']);
    assert.deepEqual(started.actions, [{
        type: 'add_node',
        nodeType: 'image',
        prompt: '雾中的森林远景',
        toolCallId: 'call-add-1',
        imageModel: 'gemini-pro',
        modelName: 'Nano Banana Pro',
        aspectRatio: '16:9',
        resolution: '2K',
    }]);
    assert.equal(invocations[0].messages[0].role, 'system');
    assert.equal(invocations[0].messages[1].role, 'user');
    assert.ok(invocations[0].tools.some(tool => tool.name === 'get_canvas_snapshot'));
    assert.ok(invocations[0].tools.some(tool => tool.name === 'add_canvas_node'));

    const completed = await completeCanvasToolAgent(
        started.continuation,
        [{ toolCallId: 'call-add-1', status: 'succeeded', nodeId: 'node-real-123' }],
        config,
    );

    assert.equal(completed.response, '森林图片草稿节点已经创建。');
    assert.deepEqual(completed.traceIds, ['trace-second']);
    assert.equal(invocations.length, 2);
    assert.ok(invocations[1].tools.some(tool => tool.name === 'delete_canvas_node'));
    assert.deepEqual(invocations[1].messages.map(message => message.role).slice(-2), ['assistant', 'tool']);
    assert.match(invocations[1].messages.at(-1).content, /node-real-123/);
    assert.equal(invocations[1].messages.at(-1).toolCallId, 'call-add-1');
});

test('canvas chat can read a snapshot and use its exact ID in a later tool round', async () => {
    const invocations: Array<Record<string, any>> = [];
    const modelGatewayRuntime = {
        async invoke(request: Record<string, any>) {
            invocations.push(structuredClone(request));
            if (invocations.length === 1) return {
                traceId: 'trace-read',
                message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-read', name: 'get_canvas_snapshot', arguments: {} }] },
            };
            if (invocations.length === 2) return {
                traceId: 'trace-delete',
                message: { role: 'assistant', content: '', toolCalls: [{
                    id: 'call-delete', name: 'delete_canvas_node',
                    arguments: { node_id: 'node-red', expected_snapshot_version: 'canvas-v1-current' },
                }] },
            };
            return { traceId: 'trace-final', message: { role: 'assistant', content: '红色飞机节点已删除。' } };
        },
    };
    const config = {
        apiKey: 'unused', baseUrl: 'https://unused.example/v1', modelName: 'unused', modelGatewayRuntime,
    };

    const started = await startCanvasToolAgent([new HumanMessage('删除红色飞机节点')], config);
    assert.equal(started.status, 'awaiting_client');
    assert.equal(started.actions[0].type, 'get_snapshot');

    const afterRead = await completeCanvasToolAgent(started.continuation, [{
        toolCallId: 'call-read', status: 'succeeded', operation: 'snapshot', snapshotVersion: 'canvas-v1-current',
        snapshot: { snapshotVersion: 'canvas-v1-current', title: 'Test', nodes: [{ id: 'node-red', title: '红色飞机' }], connections: [] },
    }], config);
    assert.equal(afterRead.status, 'awaiting_client');
    assert.deepEqual(afterRead.actions[0], {
        type: 'delete_node', toolCallId: 'call-delete', nodeId: 'node-red', expectedSnapshotVersion: 'canvas-v1-current',
    });
    assert.match(invocations[1].messages.at(-1).content, /node-red/);

    const completed = await completeCanvasToolAgent(afterRead.continuation, [{
        toolCallId: 'call-delete', status: 'succeeded', operation: 'delete', nodeId: 'node-red', snapshotVersion: 'canvas-v1-after',
    }], config);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.response, '红色飞机节点已删除。');
    assert.equal(invocations.length, 3);
    assert.deepEqual(invocations[2].messages.map(message => message.role).slice(-4), ['assistant', 'tool', 'assistant', 'tool']);
});

test('server runtime factory executes through HTTP Transport and records a redacted trace', async () => {
    let authorization = '';
    const runtime = createCanvasChatModelGatewayRuntime({
        apiKey: 'sk-runtime-secret',
        baseUrl: 'https://gateway.example/v1',
        modelName: 'gemini-2.5-flash',
        timeoutMs: 1000,
    }, {
        fetchImplementation: async (_input: RequestInfo | URL, init?: RequestInit) => {
            authorization = new Headers(init?.headers).get('authorization') || '';
            return new Response(JSON.stringify({
                id: 'chatcmpl-runtime',
                choices: [{ message: { role: 'assistant', content: 'runtime ok' } }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        },
    });

    const result = await runtime.invoke({
        messages: [{ role: 'user', content: 'hello runtime' }],
        parameters: { temperature: 0, max_tokens: 50 },
    });

    assert.equal(result.message.content, 'runtime ok');
    assert.equal(authorization, 'Bearer sk-runtime-secret');
    const traces = runtime.traceStore.list();
    assert.equal(traces.length, 1);
    assert.equal(traces[0].status, 'succeeded');
    assert.doesNotMatch(JSON.stringify(traces), /sk-runtime-secret/);
});
