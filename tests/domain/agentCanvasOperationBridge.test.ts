import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyAgentCanvasActions,
    applyAgentDraftActions,
    createAgentCanvasSnapshot,
} from '../../src/canvas-adapters/agentCanvasOperationBridge.ts';

const base = {
    viewport: { x: 0, y: 0, zoom: 1 },
    title: 'Test',
    canvasSize: { width: 1200, height: 800 },
    now: '2026-08-06T00:00:00.000Z',
};

test('agent draft actions execute through node.add and return real node IDs', async () => {
    const result = await applyAgentDraftActions({
        actions: [{
            type: 'add_node',
            nodeType: 'image',
            prompt: 'A cinematic forest path',
            toolCallId: 'tool-call-1',
            imageModel: 'gemini-pro',
            aspectRatio: '16:9',
            resolution: '2K',
        }],
        nodes: [],
        ...base,
    });

    assert.equal(result.executions[0].status, 'succeeded');
    assert.equal(result.executions[0].nodeId, result.addedNodes[0].id);
    assert.equal(result.addedNodes[0].prompt, 'A cinematic forest path');
    assert.equal(result.addedNodes[0].imageModel, 'gemini-pro');
    assert.equal(result.addedNodes[0].resolution, '2K');
    assert.deepEqual({ x: result.addedNodes[0].x, y: result.addedNodes[0].y }, { x: 430, y: 270 });
});

test('invalid Agent image parameters fail without creating a legacy UI node', async () => {
    const result = await applyAgentDraftActions({
        actions: [{
            type: 'add_node',
            nodeType: 'image',
            prompt: 'A forest',
            toolCallId: 'tool-call-invalid',
            aspectRatio: '7:5',
        }],
        nodes: [],
        ...base,
    });

    assert.equal(result.executions[0].status, 'failed');
    assert.match(result.executions[0].error || '', /must be one of/);
    assert.equal(result.addedNodes.length, 0);
});

test('snapshot reads expose lightweight IDs and omit generated media payloads', async () => {
    const added = await applyAgentDraftActions({
        actions: [{ type: 'add_node', nodeType: 'image', prompt: 'red plane', toolCallId: 'add-red' }],
        nodes: [],
        ...base,
    });
    const nodes = added.addedNodes.map(node => ({ ...node, resultUrl: 'data:image/png;base64,SECRET' }));
    const result = await applyAgentCanvasActions({
        actions: [{ type: 'get_snapshot', toolCallId: 'read-1' }],
        nodes,
        ...base,
    });

    assert.equal(result.changed, false);
    assert.equal(result.executions[0].snapshot?.nodes[0].id, nodes[0].id);
    assert.doesNotMatch(JSON.stringify(result.executions[0].snapshot), /SECRET|resultUrl|base64/);
    assert.equal(result.snapshotVersion, createAgentCanvasSnapshot(nodes, 'Test').snapshotVersion);
});

test('Agent can update and delete an exact node after reading its snapshot', async () => {
    const added = await applyAgentDraftActions({
        actions: [{ type: 'add_node', nodeType: 'image', prompt: 'red plane', toolCallId: 'add-before-update' }],
        nodes: [],
        ...base,
    });
    const nodeId = added.addedNodes[0].id;
    const version = createAgentCanvasSnapshot(added.addedNodes, 'Test').snapshotVersion;
    const updated = await applyAgentCanvasActions({
        actions: [{
            type: 'update_node', toolCallId: 'update-red', nodeId, expectedSnapshotVersion: version,
            updates: { prompt: 'green plane', x: 42 },
        }],
        nodes: added.addedNodes,
        ...base,
    });

    assert.equal(updated.executions[0].status, 'succeeded');
    assert.equal(updated.nodes[0].prompt, 'green plane');
    assert.equal(updated.nodes[0].x, 42);

    const deleted = await applyAgentCanvasActions({
        actions: [{
            type: 'delete_node', toolCallId: 'delete-green', nodeId,
            expectedSnapshotVersion: updated.snapshotVersion,
        }],
        nodes: updated.nodes,
        ...base,
    });
    assert.equal(deleted.executions[0].status, 'succeeded');
    assert.equal(deleted.nodes.length, 0);
});

test('stale canvas writes fail without changing browser state', async () => {
    const added = await applyAgentDraftActions({
        actions: [{ type: 'add_node', nodeType: 'image', prompt: 'red plane', toolCallId: 'add-stale' }],
        nodes: [],
        ...base,
    });
    const result = await applyAgentCanvasActions({
        actions: [{
            type: 'delete_node', toolCallId: 'delete-stale', nodeId: added.addedNodes[0].id,
            expectedSnapshotVersion: 'canvas-v1-old',
        }],
        nodes: added.addedNodes,
        ...base,
    });

    assert.equal(result.executions[0].status, 'failed');
    assert.equal(result.executions[0].errorCode, 'stale_canvas_snapshot');
    assert.deepEqual(result.nodes, added.addedNodes);
});

test('Agent connects and disconnects exact nodes using current snapshot versions', async () => {
    const added = await applyAgentCanvasActions({
        actions: [
            { type: 'add_node', nodeType: 'image', prompt: 'source', toolCallId: 'add-source' },
            { type: 'add_node', nodeType: 'video', prompt: 'target', toolCallId: 'add-target' },
        ],
        nodes: [],
        ...base,
    });
    const [sourceId, targetId] = added.executions.map(execution => execution.nodeId as string);
    const connected = await applyAgentCanvasActions({
        actions: [{
            type: 'connect_nodes', toolCallId: 'connect-1', fromNodeId: sourceId, toNodeId: targetId,
            expectedSnapshotVersion: added.snapshotVersion,
        }],
        nodes: added.nodes,
        ...base,
    });
    assert.deepEqual(connected.nodes.find(node => node.id === targetId)?.parentIds, [sourceId]);

    const disconnected = await applyAgentCanvasActions({
        actions: [{
            type: 'disconnect_nodes', toolCallId: 'disconnect-1', fromNodeId: sourceId, toNodeId: targetId,
            expectedSnapshotVersion: connected.snapshotVersion,
        }],
        nodes: connected.nodes,
        ...base,
    });
    assert.deepEqual(disconnected.nodes.find(node => node.id === targetId)?.parentIds, []);
});
