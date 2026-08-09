import type { ExecutionProposal } from './executionProposal.ts';
import type { GenerationArtifact, GenerationJob } from '../generation-domain/index.ts';

export interface ServerGenerationJobSnapshot {
    job: GenerationJob;
    artifact?: GenerationArtifact;
    created?: boolean;
}

export interface ServerGenerationJobClientOptions {
    fetchImplementation?: typeof fetch;
    pollIntervalMs?: number;
    wait?: (milliseconds: number) => Promise<void>;
}

async function readSnapshot(response: Response): Promise<ServerGenerationJobSnapshot> {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || response.statusText);
    if (!data.job?.id) throw new Error('Generation Job API returned no job.');
    return data;
}

function proposalString(proposal: ExecutionProposal, key: string): string {
    const value = proposal.arguments[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Generation proposal is missing ${key}.`);
    return value;
}

function proposalReferenceImages(proposal: ExecutionProposal) {
    const value = proposal.arguments.referenceImages;
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error('Generation proposal has invalid referenceImages.');
    return value.map((reference, index) => {
        if (!reference || typeof reference !== 'object') {
            throw new Error(`Generation proposal referenceImages[${index}] is invalid.`);
        }
        const sourceNodeId = (reference as Record<string, unknown>).sourceNodeId;
        const url = (reference as Record<string, unknown>).url;
        if (typeof sourceNodeId !== 'string' || !sourceNodeId.trim() || typeof url !== 'string' || !url.trim()) {
            throw new Error(`Generation proposal referenceImages[${index}] is incomplete.`);
        }
        return { sourceNodeId, url };
    });
}

export function createServerGenerationJobClient({
    fetchImplementation = fetch,
    pollIntervalMs = 750,
    wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
}: ServerGenerationJobClientOptions = {}) {
    return {
        async executeApprovedImage(
            proposal: ExecutionProposal,
            onUpdate?: (snapshot: ServerGenerationJobSnapshot) => void,
        ): Promise<ServerGenerationJobSnapshot> {
            const created = await readSnapshot(await fetchImplementation('/api/generation-jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    proposalId: proposal.proposalId,
                    targetNodeId: proposal.target.id,
                    request: {
                        prompt: proposalString(proposal, 'prompt'),
                        modelId: proposalString(proposal, 'modelId'),
                        aspectRatio: proposalString(proposal, 'aspectRatio'),
                        quality: proposalString(proposal, 'quality'),
                        referenceImages: proposalReferenceImages(proposal),
                    },
                }),
            }));
            onUpdate?.(created);
            let current = created;
            while (current.job.status === 'queued' || current.job.status === 'running') {
                await wait(pollIntervalMs);
                current = await readSnapshot(await fetchImplementation(`/api/generation-jobs/${current.job.id}`));
                onUpdate?.(current);
            }
            return current;
        },
    };
}
