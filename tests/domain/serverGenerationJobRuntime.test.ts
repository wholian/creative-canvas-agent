import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerGenerationJobRuntime } from '../../server/generationJobRuntime.js';
import { GenerationJobManager } from '../../src/generation-domain/index.ts';

function input(overrides: Record<string, unknown> = {}) {
    return {
        proposalId: 'proposal-server-1',
        targetNodeId: 'image-node-server-1',
        request: {
            prompt: 'A yellow kitten',
            modelId: 'gemini-pro',
            aspectRatio: '1:1',
            quality: '1K',
        },
        ...overrides,
    };
}

function manager() {
    return new GenerationJobManager({
        jobIdFactory: () => 'server-job-1',
        artifactIdFactory: () => 'server-artifact-1',
        now: () => '2026-08-09T00:00:00.000Z',
    });
}

test('proposalId creates one server job and one provider execution across reconnects', async () => {
    let executionCount = 0;
    let resolveExecution!: (value: { url: string; mimeType: string }) => void;
    const executionResult = new Promise<{ url: string; mimeType: string }>(resolve => {
        resolveExecution = resolve;
    });
    const runtime = new ServerGenerationJobRuntime({
        manager: manager(),
        executeImage: async () => {
            executionCount += 1;
            return executionResult;
        },
    });

    const first = runtime.createImageJob(input());
    const reconnected = runtime.createImageJob(input());
    assert.equal(first.created, true);
    assert.equal(reconnected.created, false);
    assert.equal(first.job.id, 'server-job-1');
    assert.equal(reconnected.job.id, first.job.id);
    assert.equal(reconnected.job.status, 'running');
    assert.equal(executionCount, 1);

    resolveExecution({ url: '/library/images/yellow-kitten.png', mimeType: 'image/png' });
    const completed = await runtime.waitForJob(first.job.id);
    assert.equal(completed.job.status, 'succeeded');
    assert.equal(completed.artifact?.id, 'server-artifact-1');
    assert.equal(completed.artifact?.url, '/library/images/yellow-kitten.png');
    assert.equal(executionCount, 1);
});

test('proposalId cannot be reused with different paid parameters', () => {
    const runtime = new ServerGenerationJobRuntime({
        manager: manager(),
        executeImage: async () => new Promise(() => {}),
    });
    runtime.createImageJob(input());

    assert.throws(() => runtime.createImageJob(input({
        request: {
            prompt: 'A different image', modelId: 'gemini-pro', aspectRatio: '1:1', quality: '1K',
        },
    })), (error: any) => error.code === 'generation_proposal_conflict');
});

test('provider failure becomes a queryable failed server job', async () => {
    const runtime = new ServerGenerationJobRuntime({
        manager: manager(),
        executeImage: async () => { throw new Error('gateway unavailable'); },
    });
    const started = runtime.createImageJob(input());
    const completed = await runtime.waitForJob(started.job.id);

    assert.equal(completed.job.status, 'failed');
    assert.equal(completed.job.error?.message, 'gateway unavailable');
    assert.equal(completed.artifact, undefined);
});
