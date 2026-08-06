import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAgentDraftActions } from '../../src/canvas-adapters/agentCanvasOperationBridge.ts';

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
        viewport: { x: 0, y: 0, zoom: 1 },
        title: 'Test',
        canvasSize: { width: 1200, height: 800 },
        now: '2026-08-06T00:00:00.000Z',
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
        viewport: { x: 0, y: 0, zoom: 1 },
        title: 'Test',
        canvasSize: { width: 1200, height: 800 },
        now: '2026-08-06T00:00:00.000Z',
    });

    assert.equal(result.executions[0].status, 'failed');
    assert.match(result.executions[0].error || '', /must be one of/);
    assert.equal(result.addedNodes.length, 0);
});
