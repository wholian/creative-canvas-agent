import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionProposal } from '../../src/agent-runtime/executionProposal.ts';
import { createServerGenerationJobClient } from '../../src/agent-runtime/serverGenerationJobClient.ts';
import type { GenerationJob } from '../../src/generation-domain/index.ts';

function proposal(): ExecutionProposal {
    return {
        proposalId: 'proposal-client-1',
        toolCallId: 'tool-client-1',
        toolName: 'request_image_generation',
        status: 'awaiting_approval',
        target: { type: 'canvas_node', id: 'image-client-1', expectedRevision: 'node-v1-client' },
        display: { title: 'Generate?', summary: 'Image', parameters: {} },
        arguments: {
            nodeId: 'image-client-1', prompt: 'A yellow kitten', modelId: 'gemini-pro',
            aspectRatio: '16:9', quality: '2K',
        },
    };
}

function job(status: GenerationJob['status']): GenerationJob {
    return {
        id: 'server-job-client-1', proposalId: 'proposal-client-1', targetNodeId: 'image-client-1',
        status, request: {
            type: 'image', prompt: 'A yellow kitten', modelId: 'gemini-pro', aspectRatio: '16:9', quality: '2K',
        },
        attempt: status === 'queued' ? 0 : 1,
        ...(status === 'succeeded' ? { artifactId: 'artifact-client-1' } : {}),
        createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z',
    };
}

test('client creates once, polls the server job and returns its Artifact', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
        new Response(JSON.stringify({ created: true, job: job('running') }), { status: 202 }),
        new Response(JSON.stringify({
            job: job('succeeded'),
            artifact: {
                id: 'artifact-client-1', type: 'image', sourceJobId: 'server-job-client-1',
                url: '/library/images/yellow-kitten.png', createdAt: '2026-08-09T00:00:00.000Z',
            },
        }), { status: 200 }),
    ];
    const statuses: string[] = [];
    const client = createServerGenerationJobClient({
        fetchImplementation: async (url, init) => {
            requests.push({ url: String(url), init });
            const response = responses.shift();
            if (!response) throw new Error('Unexpected fetch.');
            return response;
        },
        wait: async () => {},
    });

    const completed = await client.executeApprovedImage(proposal(), snapshot => statuses.push(snapshot.job.status));

    assert.deepEqual(statuses, ['running', 'succeeded']);
    assert.equal(completed.artifact?.url, '/library/images/yellow-kitten.png');
    assert.deepEqual(requests.map(request => request.url), [
        '/api/generation-jobs', '/api/generation-jobs/server-job-client-1',
    ]);
    const createBody = JSON.parse(String(requests[0].init?.body));
    assert.deepEqual(createBody, {
        proposalId: 'proposal-client-1', targetNodeId: 'image-client-1',
        request: { prompt: 'A yellow kitten', modelId: 'gemini-pro', aspectRatio: '16:9', quality: '2K' },
    });
});
