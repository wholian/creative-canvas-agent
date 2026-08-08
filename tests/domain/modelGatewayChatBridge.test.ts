import assert from 'node:assert/strict';
import test from 'node:test';
import { CreativeAgentRuntime } from '../../server/agent/creativeAgentRuntime.js';
import { createCanvasChatModelGatewayRuntime } from '../../server/agent/modelGatewayRuntime.js';

function runtimeFor(responses: Array<Record<string, any>>, invocations: Array<Record<string, any>>) {
    const modelGatewayRuntime = {
        async invoke(request: Record<string, any>) {
            invocations.push(structuredClone(request));
            const response = responses.shift();
            if (!response) throw new Error('Fake Gateway has no response left.');
            return response;
        },
    };
    return new CreativeAgentRuntime({
        modelGatewayRuntime,
        modelName: 'fake-model',
        baseUrl: 'https://unused.example/v1',
    });
}

test('Pi Runtime executes a canvas tool and returns the real node ID to the model', async () => {
    const invocations: Array<Record<string, any>> = [];
    const runtime = runtimeFor([{
        traceId: 'trace-first',
        message: { role: 'assistant', content: '准备创建节点。', toolCalls: [{
            id: 'call-add-1', name: 'add_canvas_node', arguments: {
                node_type: 'image', prompt: '雾中的森林远景', aspect_ratio: '16:9', quality: '2K',
            },
        }] },
    }, {
        traceId: 'trace-second',
        message: { role: 'assistant', content: '森林图片草稿节点已经创建。' },
    }], invocations);

    const started = await runtime.startTurn({
        sessionId: 'session-add',
        message: '添加一个 16:9、2K 的森林图片节点',
    });
    assert.equal(started.status, 'awaiting_tool');
    assert.deepEqual(started.action, {
        type: 'add_node', nodeType: 'image', prompt: '雾中的森林远景', toolCallId: 'call-add-1',
        imageModel: 'gemini-pro', modelName: 'Nano Banana Pro', aspectRatio: '16:9', resolution: '2K',
    });

    const completed = await runtime.completeTool(started.id, [{
        toolCallId: 'call-add-1', status: 'succeeded', operation: 'add', nodeId: 'node-real-123',
    }]);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.response, '森林图片草稿节点已经创建。');
    assert.deepEqual(completed.traceIds, ['trace-first', 'trace-second']);
    assert.equal(invocations.length, 2);
    const addNodeSchema = invocations[0].tools.find(tool => tool.name === 'add_canvas_node').inputSchema;
    assert.deepEqual(addNodeSchema.properties.node_type.enum, ['image', 'video']);
    assert.deepEqual(addNodeSchema.properties.image_model.enum, ['gpt-image-1.5', 'gemini-pro', 'kling-v1-5', 'kling-v2-1']);
    assert.deepEqual(addNodeSchema.properties.quality.enum, ['Auto', '1K', '2K', '4K']);
    assert.equal(JSON.stringify(addNodeSchema).includes('"const"'), false);
    assert.deepEqual(invocations[1].messages.map(message => message.role).slice(-2), ['assistant', 'tool']);
    assert.match(invocations[1].messages.at(-1).content, /node-real-123/);
    assert.equal(invocations[1].messages.at(-1).toolCallId, 'call-add-1');
});

test('Pi Runtime owns multiple tool rounds instead of exposing a serialized continuation', async () => {
    const invocations: Array<Record<string, any>> = [];
    const runtime = runtimeFor([{
        traceId: 'trace-read',
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-read', name: 'get_canvas_snapshot', arguments: {} }] },
    }, {
        traceId: 'trace-delete',
        message: { role: 'assistant', content: '', toolCalls: [{
            id: 'call-delete', name: 'delete_canvas_node',
            arguments: { node_id: 'node-red', expected_snapshot_version: 'canvas-v1-current' },
        }] },
    }, {
        traceId: 'trace-final',
        message: { role: 'assistant', content: '红色飞机节点已删除。' },
    }], invocations);

    const first = await runtime.startTurn({ sessionId: 'session-delete', message: '删除红色飞机节点' });
    assert.equal(first.status, 'awaiting_tool');
    assert.equal(first.action?.type, 'get_snapshot');
    assert.equal('continuation' in first, false);

    const second = await runtime.completeTool(first.id, [{
        toolCallId: 'call-read', status: 'succeeded', operation: 'snapshot', snapshotVersion: 'canvas-v1-current',
        snapshot: { snapshotVersion: 'canvas-v1-current', title: 'Test', nodes: [{ id: 'node-red', title: '红色飞机' }], connections: [] },
    }]);
    assert.equal(second.status, 'awaiting_tool');
    assert.deepEqual(second.action, {
        type: 'delete_node', toolCallId: 'call-delete', nodeId: 'node-red', expectedSnapshotVersion: 'canvas-v1-current',
    });

    const completed = await runtime.completeTool(first.id, [{
        toolCallId: 'call-delete', status: 'succeeded', operation: 'delete', nodeId: 'node-red', snapshotVersion: 'canvas-v1-after',
    }]);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.toolRound, 2);
    assert.equal(invocations.length, 3);
});

test('stale canvas result gives the Agent the current snapshot for an automatic retry', async () => {
    const invocations: Array<Record<string, any>> = [];
    const runtime = runtimeFor([{
        traceId: 'trace-stale-write',
        message: { role: 'assistant', content: '', toolCalls: [{
            id: 'call-update-stale', name: 'update_canvas_node',
            arguments: {
                node_id: 'node-plane', expected_snapshot_version: 'canvas-v1-old',
                patch: { prompt: 'green paper plane' },
            },
        }] },
    }, {
        traceId: 'trace-retry-write',
        message: { role: 'assistant', content: '', toolCalls: [{
            id: 'call-update-retry', name: 'update_canvas_node',
            arguments: {
                node_id: 'node-plane', expected_snapshot_version: 'canvas-v1-current',
                patch: { prompt: 'green paper plane' },
            },
        }] },
    }, {
        traceId: 'trace-retry-final',
        message: { role: 'assistant', content: '已把纸飞机提示词改为绿色。' },
    }], invocations);

    const started = await runtime.startTurn({ sessionId: 'session-stale-retry', message: '把纸飞机改成绿色' });
    assert.equal(started.status, 'awaiting_tool');

    const retry = await runtime.completeTool(started.id, [{
        toolCallId: 'call-update-stale', status: 'failed', operation: 'update',
        errorCode: 'stale_canvas_snapshot', error: 'Canvas changed.',
        snapshotVersion: 'canvas-v1-current',
        snapshot: {
            snapshotVersion: 'canvas-v1-current', title: 'Test',
            nodes: [{ id: 'node-plane', title: '红色纸飞机', prompt: 'red paper plane' }],
            connections: [],
        },
    }]);

    assert.equal(retry.status, 'awaiting_tool');
    assert.equal(retry.action?.type, 'update_node');
    if (retry.action?.type === 'update_node') {
        assert.equal(retry.action.expectedSnapshotVersion, 'canvas-v1-current');
    }
    const recoveryToolResult = invocations[1].messages.at(-1).content;
    assert.match(recoveryToolResult, /stale_canvas_snapshot/);
    assert.match(recoveryToolResult, /canvas-v1-current/);
    assert.match(recoveryToolResult, /node-plane/);
    assert.match(recoveryToolResult, /Do not ask the user to wait or retry/);

    const completed = await runtime.completeTool(started.id, [{
        toolCallId: 'call-update-retry', status: 'succeeded', operation: 'update',
        nodeId: 'node-plane', snapshotVersion: 'canvas-v1-after',
    }]);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.response, '已把纸飞机提示词改为绿色。');
});

test('image generation pauses in Runtime for approval before any paid execution', async () => {
    const invocations: Array<Record<string, any>> = [];
    const runtime = runtimeFor([{
        traceId: 'trace-generation-request',
        message: { role: 'assistant', content: '', toolCalls: [{
            id: 'call-generate', name: 'request_image_generation',
            arguments: { node_id: 'image-7', expected_snapshot_version: 'canvas-v1-ready' },
        }] },
    }, {
        traceId: 'trace-generation-result',
        message: { role: 'assistant', content: '图片已经按确认的参数生成。' },
    }], invocations);

    const started = await runtime.startTurn({ sessionId: 'session-generation', message: '生成这个图片节点' });
    const proposal = {
        proposalId: 'proposal-call-generate',
        toolCallId: 'call-generate',
        toolName: 'request_image_generation',
        risk: 'cost' as const,
        target: { type: 'node' as const, id: 'image-7', label: 'Image 7' },
        display: { title: '生成图片', summary: '将产生模型费用', parameters: {} },
        createdAt: new Date().toISOString(),
    };
    const awaitingApproval = await runtime.completeTool(started.id, [{
        toolCallId: 'call-generate', status: 'awaiting_approval', operation: 'request_generation', proposal,
    }]);
    assert.equal(awaitingApproval.status, 'awaiting_approval');
    assert.equal(invocations.length, 1);

    const approved = await runtime.resolveApproval(started.id, 'approved');
    assert.equal(approved.status, 'awaiting_tool');
    assert.equal(approved.action?.type, 'request_generation');
    if (approved.action?.type === 'request_generation') assert.equal(approved.action.approvalDecision, 'approved');

    const completed = await runtime.completeTool(started.id, [{
        toolCallId: 'call-generate', status: 'succeeded', operation: 'request_generation',
        nodeId: 'image-7', proposalId: proposal.proposalId,
        generationJobId: 'job-image-7', generationJobStatus: 'succeeded', artifactId: 'artifact-image-7',
        resultUrl: '/library/images/image-7.png',
    }]);
    assert.equal(completed.status, 'completed');
    assert.match(invocations[1].messages.at(-1).content, /image-7\.png/);
    assert.match(invocations[1].messages.at(-1).content, /proposal-call-generate/);
    assert.match(invocations[1].messages.at(-1).content, /job-image-7/);
    assert.match(invocations[1].messages.at(-1).content, /artifact-image-7/);
});

test('rejecting image approval returns a tool result without executing generation', async () => {
    const invocations: Array<Record<string, any>> = [];
    const runtime = runtimeFor([{
        traceId: 'trace-reject-request',
        message: { role: 'assistant', content: '', toolCalls: [{
            id: 'call-reject', name: 'request_image_generation',
            arguments: { node_id: 'image-reject', expected_snapshot_version: 'canvas-v1-ready' },
        }] },
    }, {
        traceId: 'trace-reject-final',
        message: { role: 'assistant', content: '已取消图片生成。' },
    }], invocations);
    const started = await runtime.startTurn({ sessionId: 'session-reject', message: '生成图片' });
    const proposal = {
        proposalId: 'proposal-reject', toolCallId: 'call-reject', toolName: 'request_image_generation',
        risk: 'cost' as const, target: { type: 'node' as const, id: 'image-reject', label: 'Image' },
        display: { title: '生成图片', summary: '将产生费用', parameters: {} }, createdAt: new Date().toISOString(),
    };
    const waiting = await runtime.completeTool(started.id, [{
        toolCallId: 'call-reject', status: 'awaiting_approval', operation: 'request_generation', proposal,
    }]);
    assert.equal(waiting.status, 'awaiting_approval');
    const completed = await runtime.resolveApproval(started.id, 'rejected');
    assert.equal(completed.status, 'completed');
    assert.match(invocations[1].messages.at(-1).content, /user_rejected/);
    assert.equal(invocations.length, 2);
});

test('Runtime fails explicitly when the model exceeds five tool rounds', async () => {
    const invocations: Array<Record<string, any>> = [];
    const responses = Array.from({ length: 6 }, (_, index) => ({
        traceId: `trace-loop-${index + 1}`,
        message: { role: 'assistant', content: '', toolCalls: [{
            id: `call-loop-${index + 1}`, name: 'get_canvas_snapshot', arguments: {},
        }] },
    }));
    const runtime = runtimeFor(responses, invocations);
    let turn = await runtime.startTurn({ sessionId: 'session-loop', message: '不断读取画布' });
    for (let index = 1; index <= 5; index += 1) {
        assert.equal(turn.status, 'awaiting_tool');
        turn = await runtime.completeTool(turn.id, [{
            toolCallId: `call-loop-${index}`, status: 'succeeded', operation: 'snapshot',
            snapshotVersion: `canvas-v${index}`, snapshot: { nodes: [], connections: [] },
        }]);
    }
    assert.equal(turn.status, 'failed');
    assert.match(turn.error || '', /exceeded the 5-round/);
    assert.equal(invocations.length, 6);
});

test('server Gateway factory executes through HTTP Transport and records a redacted trace', async () => {
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
