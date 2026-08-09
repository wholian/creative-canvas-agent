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
        expectedNodeVersion: snapshot.nodes[0].nodeVersion,
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

test('image generation proposal freezes connected upstream images for approval', () => {
    const reference = imageNode({
        id: 'image-reference', resultUrl: '/library/images/reference.png',
        status: 'success' as NodeData['status'],
    });
    const target = imageNode({ id: 'image-target', parentIds: [reference.id] });
    const nodes = [reference, target];
    const snapshot = createAgentCanvasSnapshot(nodes, 'Film');
    const targetVersion = snapshot.nodes.find(node => node.id === target.id)?.nodeVersion;
    assert.ok(targetVersion);

    const result = prepareImageGenerationProposal({
        toolCallId: 'call-reference', nodeId: target.id, expectedNodeVersion: targetVersion,
    }, nodes, 'Film');

    assert.equal(result.status, 'awaiting_approval');
    if (result.status !== 'awaiting_approval') return;
    assert.equal(result.proposal.display.parameters.referenceInputCount, 1);
    assert.deepEqual(result.proposal.display.parameters.referencePreviews, ['/library/images/reference.png']);
    assert.deepEqual(result.proposal.arguments.referenceImages, [{
        sourceNodeId: 'image-reference', url: '/library/images/reference.png',
    }]);
});

test('image generation proposal rejects stale target node content', () => {
    const original = imageNode();
    const originalVersion = createAgentCanvasSnapshot([original], 'Film').nodes[0].nodeVersion;
    const result = prepareImageGenerationProposal({
        toolCallId: 'call-stale',
        nodeId: 'image-1',
        expectedNodeVersion: originalVersion,
    }, [imageNode({ prompt: 'A changed forest prompt' })], 'Film');

    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') return;
    assert.equal(result.errorCode, 'stale_node_snapshot');
    assert.equal(result.currentNode?.prompt, 'A changed forest prompt');
});

test('image generation proposal ignores layout-only changes', () => {
    const original = imageNode();
    const expectedNodeVersion = createAgentCanvasSnapshot([original], 'Film').nodes[0].nodeVersion;
    const moved = imageNode({ x: 999, y: -400 });
    const result = prepareImageGenerationProposal({
        toolCallId: 'call-moved', nodeId: 'image-1', expectedNodeVersion,
    }, [moved], 'Film');

    assert.equal(result.status, 'awaiting_approval');
});

test('approved generation may reattach while its node is loading', () => {
    const original = imageNode();
    const expectedNodeVersion = createAgentCanvasSnapshot([original], 'Film').nodes[0].nodeVersion;
    const loading = imageNode({ status: 'loading' as NodeData['status'] });
    const result = prepareImageGenerationProposal({
        toolCallId: 'call-reattach', nodeId: 'image-1', expectedNodeVersion, approvalDecision: 'approved',
    }, [loading], 'Film');

    assert.equal(result.status, 'awaiting_approval');
    if (result.status !== 'awaiting_approval') return;
    assert.equal(result.proposal.proposalId, 'proposal-call-reattach');
});

test('image generation proposal rejects unsupported or incomplete targets', () => {
    const node = imageNode({ type: 'Video' as NodeData['type'] });
    const snapshot = createAgentCanvasSnapshot([node], 'Film');
    const result = prepareImageGenerationProposal({
        toolCallId: 'call-video',
        nodeId: node.id,
        expectedNodeVersion: snapshot.nodes[0].nodeVersion,
    }, [node], 'Film');

    assert.equal(result.status, 'failed');
    if (result.status !== 'failed') return;
    assert.equal(result.errorCode, 'unsupported_generation_target');
});
