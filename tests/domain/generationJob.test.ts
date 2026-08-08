import assert from 'node:assert/strict';
import test from 'node:test';
import { GenerationJobManager } from '../../src/generation-domain/index.ts';

function createManager() {
    let tick = 0;
    return new GenerationJobManager({
        jobIdFactory: () => 'job-1',
        artifactIdFactory: () => 'artifact-1',
        now: () => `2026-08-08T00:00:0${tick++}.000Z`,
    });
}

function createQueued(manager: GenerationJobManager) {
    return manager.createQueued({
        proposalId: 'proposal-1',
        targetNodeId: 'image-1',
        request: {
            prompt: 'A red paper plane',
            modelId: 'gemini-pro',
            aspectRatio: '1:1',
            quality: '1K',
        },
    });
}

test('approved image work starts as one queued GenerationJob', () => {
    const manager = createManager();
    const job = createQueued(manager);

    assert.equal(job.status, 'queued');
    assert.equal(job.attempt, 0);
    assert.equal(job.request.type, 'image');
    assert.equal(job.request.prompt, 'A red paper plane');
    assert.equal(job.artifactId, undefined);
});

test('mock execution moves queued to running to succeeded and records an Artifact', async () => {
    const manager = createManager();
    const queued = createQueued(manager);
    let observedStatus = '';

    const completed = await manager.execute(queued.id, async job => {
        observedStatus = job.status;
        return { url: '/library/images/paper-plane.png', mimeType: 'image/png' };
    });

    assert.equal(observedStatus, 'running');
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.attempt, 1);
    assert.equal(completed.artifactId, 'artifact-1');
    assert.deepEqual(manager.getArtifact('artifact-1'), {
        id: 'artifact-1',
        type: 'image',
        sourceJobId: 'job-1',
        url: '/library/images/paper-plane.png',
        mimeType: 'image/png',
        createdAt: '2026-08-08T00:00:02.000Z',
    });
});

test('failed mock execution records an error and creates no Artifact', async () => {
    const manager = createManager();
    const queued = createQueued(manager);

    const failed = await manager.execute(queued.id, async () => {
        throw new Error('provider unavailable');
    });

    assert.equal(failed.status, 'failed');
    assert.equal(failed.error?.code, 'generation_failed');
    assert.equal(failed.error?.message, 'provider unavailable');
    assert.equal(failed.artifactId, undefined);
    assert.deepEqual(manager.listArtifacts(), []);
});

test('invalid transitions and concurrent jobs for one node are rejected', () => {
    const manager = createManager();
    const queued = createQueued(manager);

    assert.throws(() => manager.markSucceeded(queued.id, { url: '/too-early.png' }), /queued to succeeded/);
    assert.throws(() => createQueued(manager), /already has active generation job/);
});

test('returned jobs and Artifacts are defensive copies', async () => {
    const manager = createManager();
    const queued = createQueued(manager);
    const completed = await manager.execute(queued.id, async () => ({ url: '/original.png' }));
    completed.request.prompt = 'mutated';
    const artifact = manager.getArtifact(completed.artifactId!);
    if (!artifact) throw new Error('Expected artifact.');
    artifact.url = '/mutated.png';

    assert.equal(manager.getJob(queued.id)?.request.prompt, 'A red paper plane');
    assert.equal(manager.getArtifact(completed.artifactId!)?.url, '/original.png');
});
