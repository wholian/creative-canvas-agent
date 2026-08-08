import type { ExecutionProposal } from './executionProposal.ts';
import {
    type GenerationArtifact,
    type GenerationExecutor,
    type GenerationJob,
    GenerationJobManager,
} from '../generation-domain/index.ts';

export interface ExecuteApprovedImageGenerationInput {
    proposal: ExecutionProposal;
    manager: GenerationJobManager;
    executor: GenerationExecutor;
    onJobUpdate?: (job: GenerationJob) => void;
    queuedDelayMs?: number;
}

export interface ApprovedImageGenerationResult {
    job: GenerationJob;
    artifact?: GenerationArtifact;
}

function stringArgument(proposal: ExecutionProposal, key: string): string {
    const value = proposal.arguments[key];
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Approved image proposal is missing ${key}.`);
    }
    return value;
}

/**
 * The only E1b bridge between human approval and post-approval execution.
 * Proposal owns the decision; GenerationJob owns queued/running/result state.
 */
export async function executeApprovedImageGeneration({
    proposal,
    manager,
    executor,
    onJobUpdate,
    queuedDelayMs = 0,
}: ExecuteApprovedImageGenerationInput): Promise<ApprovedImageGenerationResult> {
    if (proposal.toolName !== 'request_image_generation' || proposal.target.type !== 'canvas_node') {
        throw new Error('Only an approved image generation proposal can create this GenerationJob.');
    }

    const queued = manager.createQueued({
        proposalId: proposal.proposalId,
        targetNodeId: proposal.target.id,
        request: {
            prompt: stringArgument(proposal, 'prompt'),
            modelId: stringArgument(proposal, 'modelId'),
            aspectRatio: stringArgument(proposal, 'aspectRatio'),
            quality: stringArgument(proposal, 'quality'),
        },
    });
    onJobUpdate?.(queued);
    if (queuedDelayMs > 0) await new Promise(resolve => setTimeout(resolve, queuedDelayMs));

    const completed = await manager.execute(queued.id, async running => {
        onJobUpdate?.(running);
        return executor(running);
    });
    onJobUpdate?.(completed);

    return {
        job: completed,
        ...(completed.artifactId ? { artifact: manager.getArtifact(completed.artifactId) } : {}),
    };
}
