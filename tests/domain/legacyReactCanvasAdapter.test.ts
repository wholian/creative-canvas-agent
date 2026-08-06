import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { adaptLegacyReactCanvas } from '../../src/canvas-adapters/legacyReactCanvasAdapter.ts';

test('read-only React adapter produces an equivalent domain graph', async () => {
    const workflow = JSON.parse(await readFile('fixtures/legacy/basic-workflow.json', 'utf8'));
    const originalNodes = structuredClone(workflow.nodes);
    const result = adaptLegacyReactCanvas({
        id: workflow.id,
        title: workflow.title,
        nodes: workflow.nodes,
        viewport: workflow.viewport,
    }, '2026-08-06T00:00:00.000Z');

    assert.deepEqual(workflow.nodes, originalNodes);
    assert.equal(result.project.nodes.length, workflow.nodes.length);
    assert.equal(result.project.connections.length, 2);
    assert.deepEqual(
        result.project.nodes.map(node => ({ id: node.id, x: node.position.x, y: node.position.y })),
        workflow.nodes.map((node: { id: string; x: number; y: number }) => ({ id: node.id, x: node.x, y: node.y })),
    );
});
