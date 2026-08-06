import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { migrateLegacyWorkflow, validateCanvasProject } from '../../src/canvas-domain/index.ts';

test('legacy workflow migration preserves nodes, media URLs, positions, and explicit connections', async () => {
    const input = JSON.parse(await readFile('fixtures/legacy/basic-workflow.json', 'utf8'));
    const original = structuredClone(input);
    const result = migrateLegacyWorkflow(input, { now: '2026-08-06T00:00:00.000Z' });

    assert.deepEqual(input, original, 'migration must not mutate its source');
    assert.equal(result.project.nodes.length, 3);
    assert.equal(result.project.connections.length, 2);
    assert.deepEqual(result.project.viewport, { x: 30, y: -20, zoom: 0.8 });

    const image = result.project.nodes.find(node => node.id === 'legacy-image');
    assert.equal(image?.type, 'image');
    assert.equal((image?.payload as { legacyResultUrl?: string }).legacyResultUrl, '/library/images/fox.png');
    assert.equal(image?.status, 'succeeded');

    const placeholder = result.project.nodes.find(node => node.id === 'legacy-editor');
    assert.equal(placeholder?.type, 'legacy');
    assert.equal((placeholder?.payload as { legacyType: string }).legacyType, 'Image Editor');
    assert.ok(result.warnings.some(warning => warning.code === 'legacy_placeholder'));
    assert.ok(result.warnings.some(warning => warning.code === 'missing_parent'));
    assert.doesNotThrow(() => validateCanvasProject(result.project));
});

test('legacy migration produces deterministic connection IDs', async () => {
    const input = JSON.parse(await readFile('fixtures/legacy/basic-workflow.json', 'utf8'));
    const options = { now: '2026-08-06T00:00:00.000Z' };
    const first = migrateLegacyWorkflow(input, options);
    const second = migrateLegacyWorkflow(input, options);
    assert.deepEqual(first, second);
});
