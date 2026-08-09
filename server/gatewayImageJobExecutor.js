import fs from 'node:fs';
import path from 'node:path';
import { saveBufferToFile } from './utils/imageHelpers.js';

function extensionForMimeType(mimeType) {
    if (mimeType === 'image/jpeg') return 'jpg';
    if (mimeType === 'image/webp') return 'webp';
    return 'png';
}

/** Executes the first server-side Agent generation slice through one Gateway. */
export function createGatewayImageJobExecutor({ imageGateway, imagesDir }) {
    return async job => {
        if (job.request.modelId !== 'gemini-pro') {
            throw new Error(`Server GenerationJob v0.1 does not support image model ${job.request.modelId}.`);
        }
        if (!imageGateway) throw new Error('Unified Image Gateway is disabled.');

        const result = await imageGateway.generateImage({
            prompt: job.request.prompt,
            aspectRatio: job.request.aspectRatio,
            resolution: job.request.quality,
        });
        const upstreamArtifact = result.artifacts?.[0];
        if (!upstreamArtifact?.base64) throw new Error('Unified Image Gateway returned no image artifact.');

        const mimeType = upstreamArtifact.mimeType || 'image/png';
        const saved = saveBufferToFile(
            Buffer.from(upstreamArtifact.base64, 'base64'),
            imagesDir,
            'agent_img',
            extensionForMimeType(mimeType),
        );
        const metadata = {
            id: saved.id,
            filename: saved.filename,
            prompt: job.request.prompt,
            model: job.request.modelId,
            targetNodeId: job.targetNodeId,
            generationJobId: job.id,
            proposalId: job.proposalId,
            createdAt: new Date().toISOString(),
            type: 'images',
            ...(result.traceId ? { traceId: result.traceId } : {}),
        };
        fs.writeFileSync(path.join(imagesDir, `${saved.id}.json`), JSON.stringify(metadata, null, 2));
        return { url: saved.url, mimeType };
    };
}
