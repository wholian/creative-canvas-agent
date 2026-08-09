import { GenerationJobManager } from '../src/generation-domain/index.ts';

function requireText(value, field) {
    if (typeof value !== 'string' || !value.trim()) {
        const error = new Error(`${field} must be a non-empty string.`);
        error.code = 'invalid_generation_job';
        throw error;
    }
    return value.trim();
}

function normalizeInput(input) {
    return {
        proposalId: requireText(input?.proposalId, 'proposalId'),
        targetNodeId: requireText(input?.targetNodeId, 'targetNodeId'),
        request: {
            prompt: requireText(input?.request?.prompt, 'request.prompt'),
            modelId: requireText(input?.request?.modelId, 'request.modelId'),
            aspectRatio: requireText(input?.request?.aspectRatio, 'request.aspectRatio'),
            quality: requireText(input?.request?.quality, 'request.quality'),
        },
    };
}

function signature(input) {
    return JSON.stringify(input);
}

/**
 * Server-owned, in-memory GenerationJob source of truth. proposalId is the
 * paid-operation idempotency key: reconnecting clients get the same job and
 * can only observe it, never launch a second provider request.
 */
export class ServerGenerationJobRuntime {
    constructor({ executeImage, manager = new GenerationJobManager() }) {
        if (typeof executeImage !== 'function') throw new Error('executeImage is required.');
        this.executeImage = executeImage;
        this.manager = manager;
        this.proposals = new Map();
        this.executions = new Map();
    }

    createImageJob(input) {
        const normalized = normalizeInput(input);
        const requestSignature = signature(normalized);
        const existing = this.proposals.get(normalized.proposalId);
        if (existing) {
            if (existing.signature !== requestSignature) {
                const error = new Error(`Generation proposal ${normalized.proposalId} was reused with different parameters.`);
                error.code = 'generation_proposal_conflict';
                throw error;
            }
            return { created: false, ...this.getJob(existing.jobId) };
        }

        const queued = this.manager.createQueued(normalized);
        this.proposals.set(normalized.proposalId, { jobId: queued.id, signature: requestSignature });
        const execution = this.manager.execute(queued.id, this.executeImage)
            .finally(() => this.executions.delete(queued.id));
        this.executions.set(queued.id, execution);
        return { created: true, ...this.getJob(queued.id) };
    }

    getJob(jobId) {
        const job = this.manager.getJob(jobId);
        if (!job) {
            const error = new Error(`Generation job not found: ${jobId}.`);
            error.code = 'generation_job_not_found';
            throw error;
        }
        const artifact = job.artifactId ? this.manager.getArtifact(job.artifactId) : undefined;
        return { job, ...(artifact ? { artifact } : {}) };
    }

    async waitForJob(jobId) {
        await this.executions.get(jobId);
        return this.getJob(jobId);
    }
}
