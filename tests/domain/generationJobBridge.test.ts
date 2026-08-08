import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionProposal } from '../../src/agent-runtime/executionProposal.ts';
import { executeApprovedImageGeneration } from '../../src/agent-runtime/generationJobBridge.ts';
import { GenerationJobManager, type GenerationJobStatus } from '../../src/generation-domain/index.ts';

function proposal(): ExecutionProposal {
    return {
        proposalId: 'proposal-1',
        toolCallId: 'tool-1',
        toolName: 'request_image_generation',
        status: 'awaiting_approval',
        target: { type: 'canvas_node', id: 'image-1', expectedRevision: 'canvas-v1' },
        display: { title: 'Generate image?', summary: 'Image', parameters: {} },
        arguments: {
            nodeId: 'image-1',
            prompt: 'A cyan paper plane',
            modelId: 'gemini-pro',
            aspectRatio: '1:1',
            quality: '1K',
        },
    };
}

function manager() {
    return new GenerationJobManager({
        jobIdFactory: () => 'job-1',
        artifactIdFactory: () => 'artifact-1',
        now: () => '2026-08-08T00:00:00.000Z',
    });
}

test('approved proposal emits queued, running, succeeded and returns its Artifact', async () => {
    const statuses: GenerationJobStatus[] = [];
    const result = await executeApprovedImageGeneration({
        proposal: proposal(),
        manager: manager(),
        executor: async () => ({ url: '/mock.svg', mimeType: 'image/svg+xml' }),
        onJobUpdate: job => statuses.push(job.status),
    });

    assert.deepEqual(statuses, ['queued', 'running', 'succeeded']);
    assert.equal(result.job.proposalId, 'proposal-1');
    assert.equal(result.job.targetNodeId, 'image-1');
    assert.equal(result.artifact?.id, 'artifact-1');
    assert.equal(result.artifact?.url, '/mock.svg');
});

test('mock provider failure becomes a failed job without an Artifact', async () => {
    const statuses: GenerationJobStatus[] = [];
    const result = await executeApprovedImageGeneration({
        proposal: proposal(),
        manager: manager(),
        executor: async () => { throw new Error('mock provider failed'); },
        onJobUpdate: job => statuses.push(job.status),
    });

    assert.deepEqual(statuses, ['queued', 'running', 'failed']);
    assert.equal(result.job.error?.message, 'mock provider failed');
    assert.equal(result.artifact, undefined);
});
