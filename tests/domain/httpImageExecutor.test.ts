import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpImageExecutor } from '../../src/agent-runtime/httpImageExecutor.ts';
import type { GenerationJob } from '../../src/generation-domain/index.ts';

function runningJob(): GenerationJob {
    return {
        id: 'job-real-1',
        proposalId: 'proposal-real-1',
        targetNodeId: 'image-node-1',
        status: 'running',
        request: {
            type: 'image',
            prompt: 'A green paper plane',
            modelId: 'gemini-pro',
            aspectRatio: '16:9',
            quality: '2K',
        },
        attempt: 1,
        createdAt: '2026-08-09T00:00:00.000Z',
        updatedAt: '2026-08-09T00:00:00.000Z',
    };
}

test('approved job maps exactly once to the unified image generation request', async () => {
    const requests: Record<string, unknown>[] = [];
    const executor = createHttpImageExecutor(async params => {
        requests.push(params as unknown as Record<string, unknown>);
        return '/library/images/generated-real.png';
    });

    const result = await executor(runningJob());

    assert.deepEqual(requests, [{
        nodeId: 'image-node-1',
        prompt: 'A green paper plane',
        imageModel: 'gemini-pro',
        aspectRatio: '16:9',
        resolution: '2K',
    }]);
    assert.deepEqual(result, { url: '/library/images/generated-real.png' });
});

test('provider failure is propagated to the GenerationJob boundary', async () => {
    const executor = createHttpImageExecutor(async () => {
        throw new Error('provider unavailable');
    });

    await assert.rejects(executor(runningJob()), /provider unavailable/);
});
