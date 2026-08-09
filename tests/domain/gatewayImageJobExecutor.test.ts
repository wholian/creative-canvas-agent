import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGatewayImageJobExecutor } from '../../server/gatewayImageJobExecutor.js';
import type { GenerationJob } from '../../src/generation-domain/index.ts';

test('server image executor maps the frozen job to Gateway and saves its Artifact', async () => {
    const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-canvas-job-'));
    const requests: Record<string, unknown>[] = [];
    try {
        const executor = createGatewayImageJobExecutor({
            imagesDir,
            imageGateway: {
                async generateImage(request: Record<string, unknown>) {
                    requests.push(request);
                    return {
                        traceId: 'trace-server-image-1',
                        artifacts: [{ mimeType: 'image/png', base64: Buffer.from('fake-png').toString('base64') }],
                    };
                },
            },
        });
        const job: GenerationJob = {
            id: 'server-job-image-1', proposalId: 'proposal-image-1', targetNodeId: 'image-node-1',
            status: 'running', attempt: 1,
            request: {
                type: 'image', prompt: 'A yellow kitten', modelId: 'gemini-pro', aspectRatio: '16:9', quality: '2K',
            },
            createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z',
        };

        const result = await executor(job);

        assert.deepEqual(requests, [{ prompt: 'A yellow kitten', aspectRatio: '16:9', resolution: '2K' }]);
        assert.equal(result.mimeType, 'image/png');
        assert.match(result.url, /^\/library\//);
        const files = fs.readdirSync(imagesDir);
        assert.equal(files.filter(file => file.endsWith('.png')).length, 1);
        const metadataFile = files.find(file => file.endsWith('.json'));
        assert.ok(metadataFile);
        const metadata = JSON.parse(fs.readFileSync(path.join(imagesDir, metadataFile), 'utf8'));
        assert.equal(metadata.generationJobId, 'server-job-image-1');
        assert.equal(metadata.targetNodeId, 'image-node-1');
        assert.equal(metadata.traceId, 'trace-server-image-1');
    } finally {
        fs.rmSync(imagesDir, { recursive: true, force: true });
    }
});
