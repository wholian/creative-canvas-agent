import type {
    CreateImageGenerationJobInput,
    GenerationArtifact,
    GenerationExecutor,
    GenerationExecutorResult,
    GenerationJob,
    GenerationJobError,
    GenerationJobStatus,
} from './types.ts';

export interface GenerationJobManagerOptions {
    jobIdFactory?: () => string;
    artifactIdFactory?: () => string;
    now?: () => string;
}

function cloneJob(job: GenerationJob): GenerationJob {
    return structuredClone(job);
}

function cloneArtifact(artifact: GenerationArtifact): GenerationArtifact {
    return structuredClone(artifact);
}

function requireText(value: string, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${field} must be a non-empty string.`);
    }
    return value.trim();
}

function requireTransition(job: GenerationJob, expected: GenerationJobStatus, next: GenerationJobStatus): void {
    if (job.status !== expected) {
        throw new Error(`Generation job ${job.id} cannot transition from ${job.status} to ${next}.`);
    }
}

/**
 * Owns the minimal post-approval generation lifecycle. Human approval remains
 * an ExecutionProposal concern; a GenerationJob starts only after approval.
 */
export class GenerationJobManager {
    private readonly jobs = new Map<string, GenerationJob>();
    private readonly artifacts = new Map<string, GenerationArtifact>();
    private readonly jobIdFactory: () => string;
    private readonly artifactIdFactory: () => string;
    private readonly now: () => string;

    constructor({
        jobIdFactory = () => crypto.randomUUID(),
        artifactIdFactory = () => crypto.randomUUID(),
        now = () => new Date().toISOString(),
    }: GenerationJobManagerOptions = {}) {
        this.jobIdFactory = jobIdFactory;
        this.artifactIdFactory = artifactIdFactory;
        this.now = now;
    }

    createQueued(input: CreateImageGenerationJobInput): GenerationJob {
        const proposalId = requireText(input.proposalId, 'proposalId');
        const targetNodeId = requireText(input.targetNodeId, 'targetNodeId');
        const prompt = requireText(input.request.prompt, 'request.prompt');
        const modelId = requireText(input.request.modelId, 'request.modelId');
        const aspectRatio = requireText(input.request.aspectRatio, 'request.aspectRatio');
        const quality = requireText(input.request.quality, 'request.quality');
        const active = [...this.jobs.values()].find(job =>
            job.targetNodeId === targetNodeId && (job.status === 'queued' || job.status === 'running'),
        );
        if (active) {
            throw new Error(`Canvas node ${targetNodeId} already has active generation job ${active.id}.`);
        }

        const id = requireText(this.jobIdFactory(), 'jobId');
        if (this.jobs.has(id)) throw new Error(`Generation job already exists: ${id}.`);
        const timestamp = this.now();
        const job: GenerationJob = {
            id,
            proposalId,
            targetNodeId,
            status: 'queued',
            request: { type: 'image', prompt, modelId, aspectRatio, quality },
            attempt: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        this.jobs.set(id, job);
        return cloneJob(job);
    }

    getJob(jobId: string): GenerationJob | undefined {
        const job = this.jobs.get(jobId);
        return job ? cloneJob(job) : undefined;
    }

    getArtifact(artifactId: string): GenerationArtifact | undefined {
        const artifact = this.artifacts.get(artifactId);
        return artifact ? cloneArtifact(artifact) : undefined;
    }

    listArtifacts(): GenerationArtifact[] {
        return [...this.artifacts.values()].map(cloneArtifact);
    }

    markRunning(jobId: string): GenerationJob {
        const job = this.requireJob(jobId);
        requireTransition(job, 'queued', 'running');
        const updated: GenerationJob = {
            ...job,
            status: 'running',
            attempt: job.attempt + 1,
            updatedAt: this.now(),
        };
        this.jobs.set(jobId, updated);
        return cloneJob(updated);
    }

    markSucceeded(jobId: string, result: GenerationExecutorResult): GenerationJob {
        const job = this.requireJob(jobId);
        requireTransition(job, 'running', 'succeeded');
        const url = requireText(result.url, 'result.url');
        const artifactId = requireText(this.artifactIdFactory(), 'artifactId');
        if (this.artifacts.has(artifactId)) throw new Error(`Generation artifact already exists: ${artifactId}.`);
        const timestamp = this.now();
        const artifact: GenerationArtifact = {
            id: artifactId,
            type: 'image',
            sourceJobId: job.id,
            url,
            ...(result.mimeType ? { mimeType: result.mimeType } : {}),
            createdAt: timestamp,
        };
        const updated: GenerationJob = {
            ...job,
            status: 'succeeded',
            artifactId,
            updatedAt: timestamp,
        };
        this.artifacts.set(artifactId, artifact);
        this.jobs.set(jobId, updated);
        return cloneJob(updated);
    }

    markFailed(jobId: string, error: GenerationJobError): GenerationJob {
        const job = this.requireJob(jobId);
        requireTransition(job, 'running', 'failed');
        const updated: GenerationJob = {
            ...job,
            status: 'failed',
            error: {
                code: requireText(error.code, 'error.code'),
                message: requireText(error.message, 'error.message'),
            },
            updatedAt: this.now(),
        };
        this.jobs.set(jobId, updated);
        return cloneJob(updated);
    }

    async execute(jobId: string, executor: GenerationExecutor): Promise<GenerationJob> {
        const running = this.markRunning(jobId);
        try {
            return this.markSucceeded(jobId, await executor(cloneJob(running)));
        } catch (error) {
            return this.markFailed(jobId, {
                code: 'generation_failed',
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private requireJob(jobId: string): GenerationJob {
        const job = this.jobs.get(jobId);
        if (!job) throw new Error(`Generation job not found: ${jobId}.`);
        return job;
    }
}
