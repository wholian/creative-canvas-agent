import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CanvasOperationRunner,
    createCanvasProject,
    InMemoryCanvasProjectStore,
    type CanvasOperation,
} from '../../src/canvas-domain/index.ts';

const NOW = '2026-08-06T00:00:00.000Z';

function setup() {
    const project = createCanvasProject({ id: 'project-1', title: 'Test', now: NOW });
    const store = new InMemoryCanvasProjectStore([project]);
    let nextId = 1;
    const runner = new CanvasOperationRunner({
        store,
        idFactory: () => `node-${nextId++}`,
        now: () => NOW,
    });
    return { runner, store };
}

function addImage(overrides: Partial<CanvasOperation> = {}): CanvasOperation {
    return {
        operationId: 'op-add-1',
        projectId: 'project-1',
        actor: { type: 'agent', id: 'creative-agent' },
        baseRevision: 0,
        type: 'node.add',
        payload: {
            type: 'image',
            title: 'Forest',
            position: { x: 120, y: 80 },
            payload: { prompt: 'A forest in morning mist', aspectRatio: '16:9', referenceArtifactIds: [] },
        },
        createdAt: NOW,
        ...overrides,
    };
}

test('node.add returns the real node ID and increments project revision', async () => {
    const { runner } = setup();
    const result = await runner.execute(addImage());
    assert.equal(result.status, 'succeeded');
    assert.equal(result.projectRevision, 1);
    assert.deepEqual(result.affectedIds, ['node-1']);
    assert.equal(result.data?.nodeId, 'node-1');
    const snapshot = await runner.getSnapshot('project-1');
    assert.equal(snapshot.nodes.length, 1);
    assert.equal(snapshot.nodes[0].id, 'node-1');
});

test('replaying the same operationId is idempotent', async () => {
    const { runner } = setup();
    const first = await runner.execute(addImage());
    const replay = await runner.execute(addImage());
    assert.deepEqual(replay, first);
    assert.equal((await runner.getSnapshot('project-1')).nodes.length, 1);
});

test('reusing an operationId with different content is rejected', async () => {
    const { runner } = setup();
    await runner.execute(addImage());
    const result = await runner.execute(addImage({ payload: { type: 'text', position: { x: 0, y: 0 }, payload: { text: 'different' } } }));
    assert.equal(result.status, 'rejected');
    assert.equal(result.error?.code, 'operation_id_conflict');
});

test('stale baseRevision is rejected without changing the project', async () => {
    const { runner } = setup();
    await runner.execute(addImage());
    const stale = await runner.execute(addImage({ operationId: 'op-add-2' }));
    assert.equal(stale.status, 'rejected');
    assert.equal(stale.error?.code, 'revision_conflict');
    assert.equal((await runner.getSnapshot('project-1')).nodes.length, 1);
});

test('node.update changes only requested fields', async () => {
    const { runner } = setup();
    await runner.execute(addImage());
    const result = await runner.execute({
        operationId: 'op-update-1',
        projectId: 'project-1',
        actor: { type: 'user' },
        baseRevision: 1,
        type: 'node.update',
        payload: { nodeId: 'node-1', patch: { payload: { prompt: 'A forest at blue hour' } } },
        createdAt: NOW,
    });
    assert.equal(result.status, 'succeeded');
    const node = (await runner.getSnapshot('project-1')).nodes[0];
    assert.equal((node.payload as { prompt: string }).prompt, 'A forest at blue hour');
    assert.deepEqual(node.position, { x: 120, y: 80 });
    assert.equal(node.title, 'Forest');
});

test('agent cannot update a locked node', async () => {
    const { runner, store } = setup();
    await runner.execute(addImage());
    const project = await store.get('project-1');
    assert.ok(project);
    project.nodes[0].locked = true;
    await store.save(project);
    const result = await runner.execute({
        operationId: 'op-update-locked',
        projectId: 'project-1',
        actor: { type: 'agent' },
        baseRevision: 1,
        type: 'node.update',
        payload: { nodeId: 'node-1', patch: { title: 'Should fail' } },
        createdAt: NOW,
    });
    assert.equal(result.status, 'rejected');
    assert.match(result.error?.message || '', /locked/);
});

test('store snapshots are defensive copies', async () => {
    const { runner } = setup();
    await runner.execute(addImage());
    const snapshot = await runner.getSnapshot('project-1');
    snapshot.nodes.length = 0;
    assert.equal((await runner.getSnapshot('project-1')).nodes.length, 1);
});
