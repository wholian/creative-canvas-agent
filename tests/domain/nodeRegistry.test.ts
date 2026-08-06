import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CanvasValidationError,
    createBuiltInNodeRegistry,
    validateCanvasNode,
    validateCanvasProject,
} from '../../src/canvas-domain/index.ts';

const NOW = '2026-08-06T00:00:00.000Z';

function imageNode(overrides: Record<string, unknown> = {}) {
    return {
        id: 'node-image-1',
        type: 'image',
        typeVersion: 1,
        title: 'Forest draft',
        position: { x: 10, y: 20 },
        size: { width: 340, height: 340 },
        status: 'idle',
        payload: {
            prompt: 'A quiet forest at dawn',
            aspectRatio: '16:9',
            quality: '2K',
            referenceArtifactIds: [],
        },
        artifactIds: [],
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

test('built-in registry exposes text, image, and video definitions', () => {
    const registry = createBuiltInNodeRegistry();
    assert.deepEqual(registry.list().map(definition => definition.type), ['text', 'image', 'video', 'legacy']);
    assert.deepEqual(registry.get('image').capabilities, ['editable', 'generatable', 'connectable']);
});

test('valid image node is normalized without losing its payload', () => {
    const node = validateCanvasNode(imageNode());
    assert.equal(node.type, 'image');
    assert.deepEqual(node.payload, {
        prompt: 'A quiet forest at dawn',
        modelId: undefined,
        aspectRatio: '16:9',
        quality: '2K',
        referenceArtifactIds: [],
        legacyResultUrl: undefined,
    });
});

test('missing required image prompt fails with a structured path', () => {
    assert.throws(
        () => validateCanvasNode(imageNode({ payload: { referenceArtifactIds: [] } })),
        (error: unknown) => error instanceof CanvasValidationError
            && error.code === 'missing_field'
            && error.path === 'payload.prompt',
    );
});

test('invalid image quality reports its legal enum values', () => {
    assert.throws(
        () => validateCanvasNode(imageNode({ payload: { prompt: 'x', quality: 'ultra', referenceArtifactIds: [] } })),
        (error: unknown) => error instanceof CanvasValidationError
            && error.code === 'invalid_value'
            && error.message.includes('Auto, 1K, 2K, 4K'),
    );
});

test('unknown node type fails explicitly', () => {
    assert.throws(
        () => validateCanvasNode(imageNode({ type: 'mystery' })),
        (error: unknown) => error instanceof CanvasValidationError
            && error.code === 'unknown_node_type',
    );
});

test('project validation rejects a connection to a missing node', () => {
    assert.throws(
        () => validateCanvasProject({
            schemaVersion: 2,
            id: 'project-1',
            title: 'Test',
            revision: 0,
            createdAt: NOW,
            updatedAt: NOW,
            nodes: [imageNode()],
            connections: [{
                id: 'connection-1',
                from: { nodeId: 'node-image-1' },
                to: { nodeId: 'missing' },
                kind: 'reference',
                createdAt: NOW,
            }],
            viewport: { x: 0, y: 0, zoom: 1 },
        }),
        (error: unknown) => error instanceof CanvasValidationError
            && error.path === 'connection',
    );
});
