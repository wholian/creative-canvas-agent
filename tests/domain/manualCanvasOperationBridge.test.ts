import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAgentDraftActions } from '../../src/canvas-adapters/agentCanvasOperationBridge.ts';
import {
    applyManualNodeAdd,
    applyManualNodeUpdate,
} from '../../src/canvas-adapters/manualCanvasOperationBridge.ts';
import type { NodeData, NodeType } from '../../src/types.ts';

const NOW = '2026-08-07T00:00:00.000Z';
const VIEWPORT = { x: 0, y: 0, zoom: 1 };
const IMAGE_NODE = 'Image' as NodeType.IMAGE;

function imageNode(overrides: Partial<NodeData> = {}): NodeData {
    return {
        id: 'image-1',
        type: IMAGE_NODE,
        title: 'Image Draft',
        x: 100,
        y: 200,
        prompt: '',
        status: 'idle' as NodeData['status'],
        model: 'Nano Banana Pro',
        imageModel: 'gemini-pro',
        aspectRatio: 'Auto',
        resolution: 'Auto',
        parentIds: [],
        ...overrides,
    };
}

test('manual image creation executes through node.add and preserves an empty draft prompt', async () => {
    const result = await applyManualNodeAdd({
        nodes: [],
        viewport: VIEWPORT,
        title: 'Manual test',
        nodeType: IMAGE_NODE,
        nodeId: 'manual-image-1',
        operationId: 'manual-add-1',
        position: { x: 320, y: 180 },
        now: NOW,
    });

    assert.equal(result.status, 'succeeded');
    assert.equal(result.projectRevision, 1);
    assert.equal(result.node?.id, 'manual-image-1');
    assert.equal(result.node?.prompt, '');
    assert.equal(result.node?.imageModel, 'gemini-pro');
    assert.equal(result.node?.aspectRatio, 'Auto');
    assert.deepEqual({ x: result.node?.x, y: result.node?.y }, { x: 320, y: 180 });
});

test('manual core parameter update executes through node.update and preserves legacy-only UI state', async () => {
    const original = imageNode({
        resultUrl: 'https://example.com/previous.png',
        isPromptExpanded: true,
    });
    const result = await applyManualNodeUpdate({
        nodes: [original],
        viewport: VIEWPORT,
        title: 'Manual test',
        nodeId: original.id,
        operationId: 'manual-update-1',
        updates: {
            prompt: 'A fox in a misty forest',
            imageModel: 'gpt-image-1.5',
            aspectRatio: '16:9',
            resolution: '2K',
        },
        now: NOW,
    });

    assert.equal(result.status, 'succeeded');
    assert.equal(result.node?.prompt, 'A fox in a misty forest');
    assert.equal(result.node?.imageModel, 'gpt-image-1.5');
    assert.equal(result.node?.aspectRatio, '16:9');
    assert.equal(result.node?.resolution, '2K');
    assert.equal(result.node?.resultUrl, original.resultUrl);
    assert.equal(result.node?.isPromptExpanded, true);
    assert.equal(original.prompt, '');
});

test('invalid manual parameters return a structured error without mutating the legacy node', async () => {
    const original = imageNode();
    const before = structuredClone(original);
    const result = await applyManualNodeUpdate({
        nodes: [original],
        viewport: VIEWPORT,
        title: 'Manual test',
        nodeId: original.id,
        operationId: 'manual-update-invalid',
        updates: { aspectRatio: '7:5' },
        now: NOW,
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.error?.code, 'invalid_value');
    assert.equal(result.error?.path, 'payload.aspectRatio');
    assert.match(result.error?.message || '', /must be one of/);
    assert.deepEqual(original, before);
});

test('manual and Agent image paths produce equivalent domain-managed legacy fields', async () => {
    const manualDraft = await applyManualNodeAdd({
        nodes: [],
        viewport: VIEWPORT,
        title: 'Equivalence',
        nodeType: IMAGE_NODE,
        nodeId: 'manual-image',
        operationId: 'manual-add-equivalence',
        position: { x: 430, y: 270 },
        now: NOW,
    });
    assert.ok(manualDraft.node);
    const manualUpdated = await applyManualNodeUpdate({
        nodes: [manualDraft.node],
        viewport: VIEWPORT,
        title: 'Equivalence',
        nodeId: manualDraft.node.id,
        operationId: 'manual-update-equivalence',
        updates: {
            prompt: 'A cinematic forest path',
            imageModel: 'gemini-pro',
            aspectRatio: '16:9',
            resolution: '2K',
        },
        now: NOW,
    });
    const agent = await applyAgentDraftActions({
        actions: [{
            type: 'add_node',
            nodeType: 'image',
            prompt: 'A cinematic forest path',
            toolCallId: 'agent-equivalence',
            imageModel: 'gemini-pro',
            aspectRatio: '16:9',
            resolution: '2K',
        }],
        nodes: [],
        viewport: VIEWPORT,
        title: 'Equivalence',
        canvasSize: { width: 1200, height: 800 },
        now: NOW,
    });

    assert.ok(manualUpdated.node);
    const managed = (node: NodeData) => ({
        type: node.type,
        prompt: node.prompt,
        imageModel: node.imageModel,
        aspectRatio: node.aspectRatio,
        resolution: node.resolution,
    });
    assert.deepEqual(managed(manualUpdated.node), managed(agent.addedNodes[0]));
});
