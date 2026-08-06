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
    const store = new InMemoryCanvasProjectStore([
        createCanvasProject({ id: 'project-graph', title: 'Graph', now: NOW }),
    ]);
    const runner = new CanvasOperationRunner({ store, idFactory: () => 'generated-id', now: () => NOW });
    return { runner };
}

function operation(
    operationId: string,
    baseRevision: number,
    type: CanvasOperation['type'],
    payload: unknown,
): CanvasOperation {
    return {
        operationId,
        projectId: 'project-graph',
        actor: { type: 'user' },
        baseRevision,
        type,
        payload,
        createdAt: NOW,
    };
}

function addText(operationId: string, nodeId: string, revision: number): CanvasOperation {
    return operation(operationId, revision, 'node.add', {
        nodeId,
        type: 'text',
        position: { x: revision * 10, y: 0 },
        payload: { text: nodeId },
    });
}

test('connection.add requires both endpoint nodes', async () => {
    const { runner } = setup();
    await runner.execute(addText('add-a', 'node-a', 0));
    const result = await runner.execute(operation('connect-missing', 1, 'connection.add', {
        from: { nodeId: 'node-a' },
        to: { nodeId: 'missing' },
        kind: 'sequence',
    }));
    assert.equal(result.status, 'rejected');
    assert.match(result.error?.message || '', /existing nodes/);
});

test('node.delete cascades its explicit connections', async () => {
    const { runner } = setup();
    await runner.execute(addText('add-a', 'node-a', 0));
    await runner.execute(addText('add-b', 'node-b', 1));
    const connected = await runner.execute(operation('connect-ab', 2, 'connection.add', {
        connectionId: 'connection-ab',
        from: { nodeId: 'node-a' },
        to: { nodeId: 'node-b' },
        kind: 'sequence',
    }));
    assert.equal(connected.status, 'succeeded');
    const deleted = await runner.execute(operation('delete-a', 3, 'node.delete', { nodeId: 'node-a' }));
    assert.deepEqual(deleted.data?.deletedConnectionIds, ['connection-ab']);
    const snapshot = await runner.getSnapshot('project-graph');
    assert.deepEqual(snapshot.nodes.map(node => node.id), ['node-b']);
    assert.equal(snapshot.connections.length, 0);
});

test('equivalent duplicate connections are rejected', async () => {
    const { runner } = setup();
    await runner.execute(addText('add-a', 'node-a', 0));
    await runner.execute(addText('add-b', 'node-b', 1));
    const payload = { from: { nodeId: 'node-a' }, to: { nodeId: 'node-b' }, kind: 'reference' };
    await runner.execute(operation('connect-1', 2, 'connection.add', payload));
    const duplicate = await runner.execute(operation('connect-2', 3, 'connection.add', payload));
    assert.equal(duplicate.status, 'rejected');
    assert.match(duplicate.error?.message || '', /already exists/);
});

test('atomic batch rolls back earlier successful operations when a later operation fails', async () => {
    const { runner } = setup();
    const results = await runner.executeBatch([
        addText('batch-add-a', 'node-a', 0),
        operation('batch-connect-missing', 1, 'connection.add', {
            from: { nodeId: 'node-a' },
            to: { nodeId: 'missing' },
            kind: 'sequence',
        }),
    ]);
    assert.equal(results[0].error?.code, 'transaction_rolled_back');
    assert.equal(results[1].status, 'rejected');
    const snapshot = await runner.getSnapshot('project-graph');
    assert.equal(snapshot.revision, 0);
    assert.equal(snapshot.nodes.length, 0);
});
