export type GenerationJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ImageGenerationJobRequest {
    type: 'image';
    prompt: string;
    modelId: string;
    aspectRatio: string;
    quality: string;
}

export interface GenerationJobError {
    code: string;
    message: string;
}

export interface GenerationJob {
    id: string;
    proposalId: string;
    targetNodeId: string;
    status: GenerationJobStatus;
    request: ImageGenerationJobRequest;
    attempt: number;
    artifactId?: string;
    error?: GenerationJobError;
    createdAt: string;
    updatedAt: string;
}

export interface GenerationArtifact {
    id: string;
    type: 'image';
    sourceJobId: string;
    url: string;
    mimeType?: string;
    createdAt: string;
}

export interface CreateImageGenerationJobInput {
    proposalId: string;
    targetNodeId: string;
    request: Omit<ImageGenerationJobRequest, 'type'>;
}

export interface GenerationExecutorResult {
    url: string;
    mimeType?: string;
}

export type GenerationExecutor = (job: GenerationJob) => Promise<GenerationExecutorResult>;
