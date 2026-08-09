import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConnectionHoverTarget } from '../../src/canvas-ui/connectionHitTest.ts';

test('connection dragging recognizes an exact target connector outside the node card', () => {
    assert.deepEqual(resolveConnectionHoverTarget({
        sourceNodeId: 'image-source',
        pointerX: 900,
        connector: { nodeId: 'image-target', side: 'left' },
    }), { nodeId: 'image-target', side: 'left' });
});

test('connection dragging uses the real rendered node bounds for card drops', () => {
    assert.deepEqual(resolveConnectionHoverTarget({
        sourceNodeId: 'image-source',
        pointerX: 650,
        node: { nodeId: 'image-target', left: 600, width: 300 },
    }), { nodeId: 'image-target', side: 'left' });
    assert.deepEqual(resolveConnectionHoverTarget({
        sourceNodeId: 'image-source',
        pointerX: 850,
        node: { nodeId: 'image-target', left: 600, width: 300 },
    }), { nodeId: 'image-target', side: 'right' });
});

test('connection dragging never targets the source node itself', () => {
    assert.equal(resolveConnectionHoverTarget({
        sourceNodeId: 'image-source',
        pointerX: 650,
        connector: { nodeId: 'image-source', side: 'right' },
        node: { nodeId: 'image-source', left: 600, width: 300 },
    }), null);
});
