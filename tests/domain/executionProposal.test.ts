import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareImageGenerationProposal } from '../../src/agent-runtime/executionProposal.ts';
import { createAgentCanvasSnapshot } from '../../src/canvas-adapters/agentCanvasOperationBridge.ts';
import type { NodeData } from '../../src/types.ts';

function imageNode(overrides: Partial<NodeData> = {}): NodeData {
    return {
        id: 'image-1',
        type: 'Image' as NodeData['type'],
        title: 'Forest frame',
        x: 20,
        y: 30,
        prompt: 'A quiet forest at dawn',
        status: 'idle' as NodeData['status'],
        model: 'Nano Banana Pro',
        imageModel: 'gemini-pro',
        aspectRatio: '16:9',
        resolution: '2K',
        parentIds: [],
        ...overrides,
    };
}

test('image generation proposal exposes current node settings without executing', () => {
    const nodes = [imageNode()];
    const snapshot = createAgentCanvasSnapshot(nodes, 'Film');
    const result = prepareImageGenerationProposal({
        toolCallId: 'call-generate-1',
        nodeId: 'image-1',
        expectedSnapshotVersion: snapshot.snapshotVersion,
    }, nodes, 'Film');

    assert.equal(result.status, 'awaiting_approval');
    if (result.status !== 'awaiting_approval') return;
    assert.equal(result.proposal.toolName, 'request_image_generation');
    assert.equal(result.proposal.target.id, 'image-1');
    assert.equal(result.proposal.display.parameters.prompt, 'A quiet forest at dawn');
    assert.equal(result.proposal.display.parameters.aspectRatio, '16:9');
    assert.equal(result.proposal.display.parameters.quality, '2K');
    assert.equal(result.proposal.display.estimatedCost?.amount, 0.49);
});

test('image generation proposal rejects stale canvas state', () => {
    const result = prepareImageGenerationProposal({
        toolCallId: 'call-stale',
        nodeId: 'image-1',
        expectedSnapshotVersion: 'canvas-v1-old',
    }, [imageNode()], 'Film');

    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') return;
    assert.equal(result.errorCode, 'stale_canvas_snapshot');
});

test('image generation proposal rejects unsupported or incomplete targets', () => {
    const node = imageNode({ type: 'Video' as NodeData['type'] });
    const snapshot = createAgentCanvasSnapshot([node], 'Film');
    const result = prepareImageGenerationProposal({
        toolCallId: 'call-video',
        nodeId: node.id,
        expectedSnapshotVersion: snapshot.snapshotVersion,
    }, [node], 'Film');

    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') return;
    assert.equal(result.errorCode, 'unsupported_generation_target');
});
