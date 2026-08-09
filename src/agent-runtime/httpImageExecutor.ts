import type { GenerateImageParams } from '../services/generationService.ts';
import type { GenerationExecutor } from '../generation-domain/index.ts';

export type GenerateImageRequest = (params: GenerateImageParams) => Promise<string>;

/**
 * Adapts an approved GenerationJob to the application's unified image route.
 * Approval and job state stay outside this adapter; it performs exactly one
 * paid request using the parameters frozen into the approved job.
 */
export function createHttpImageExecutor(generateImage: GenerateImageRequest): GenerationExecutor {
    return async job => {
        const url = await generateImage({
            nodeId: job.targetNodeId,
            prompt: job.request.prompt,
            imageModel: job.request.modelId,
            aspectRatio: job.request.aspectRatio,
            resolution: job.request.quality,
        });
        return { url };
    };
}
