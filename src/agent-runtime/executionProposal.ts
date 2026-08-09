import { createAgentCanvasSnapshot } from '../canvas-adapters/agentCanvasOperationBridge.ts';
import type { AgentCanvasSnapshotNode } from '../canvas-adapters/agentCanvasOperationBridge.ts';
import type { NodeData } from '../types.ts';

export type ExecutionProposalStatus =
    | 'awaiting_approval'
    | 'executing'
    | 'succeeded'
    | 'failed'
    | 'rejected';

export interface ExecutionProposal {
    proposalId: string;
    toolCallId: string;
    toolName: string;
    status: ExecutionProposalStatus;
    target: {
        type: 'canvas_node';
        id: string;
        expectedRevision: string;
    };
    display: {
        title: string;
        summary: string;
        parameters: Record<string, unknown>;
        estimatedCost?: {
            amount: number;
            currency: 'USD';
            note?: string;
        };
    };
    arguments: Record<string, unknown>;
}

export interface ImageGenerationRequestActionLike {
    toolCallId: string;
    nodeId: string;
    expectedNodeVersion: string;
    approvalDecision?: 'approved';
}

export type PrepareExecutionProposalResult =
    | { status: 'awaiting_approval'; proposal: ExecutionProposal }
    | { status: 'failed'; errorCode: string; error: string; snapshotVersion: string; nodeVersion?: string; currentNode?: AgentCanvasSnapshotNode };

const IMAGE_MODEL_NAMES: Record<string, string> = {
    'gemini-pro': 'Nano Banana Pro',
    'gpt-image-1.5': 'GPT Image 1.5',
    'kling-v1-5': 'Kling V1.5',
    'kling-v2-1': 'Kling V2.1',
};

/**
 * Builds a read-only proposal from current canvas state. The model only names
 * the target node; execution parameters always come from the browser-owned
 * node so a tool call cannot silently replace settings the user can see.
 */
export function prepareImageGenerationProposal(
    action: ImageGenerationRequestActionLike,
    nodes: NodeData[],
    canvasTitle: string,
): PrepareExecutionProposalResult {
    const snapshot = createAgentCanvasSnapshot(nodes, canvasTitle);
    const node = nodes.find(candidate => candidate.id === action.nodeId);
    const snapshotNode = snapshot.nodes.find(candidate => candidate.id === action.nodeId);
    if (!node) {
        return {
            status: 'failed',
            errorCode: 'node_not_found',
            error: `Canvas node not found: ${action.nodeId}.`,
            snapshotVersion: snapshot.snapshotVersion,
        };
    }
    if (!snapshotNode) throw new Error(`Snapshot omitted canvas node: ${action.nodeId}.`);
    if (snapshotNode.nodeVersion !== action.expectedNodeVersion) {
        return {
            status: 'failed',
            errorCode: 'stale_node_snapshot',
            error: 'The target node changed after the Agent requested generation. Re-check the current node and request approval again.',
            snapshotVersion: snapshot.snapshotVersion,
            nodeVersion: snapshotNode.nodeVersion,
            currentNode: snapshotNode,
        };
    }
    if (node.type !== 'Image') {
        return {
            status: 'failed',
            errorCode: 'unsupported_generation_target',
            error: 'request_image_generation only supports an Image node in v0.1.',
            snapshotVersion: snapshot.snapshotVersion,
        };
    }
    const prompt = node.prompt?.trim();
    if (!prompt) {
        return {
            status: 'failed',
            errorCode: 'missing_prompt',
            error: 'The selected image node has no prompt.',
            snapshotVersion: snapshot.snapshotVersion,
        };
    }
    if (node.status === 'loading' && action.approvalDecision !== 'approved') {
        return {
            status: 'failed',
            errorCode: 'generation_already_running',
            error: 'This image node is already generating.',
            snapshotVersion: snapshot.snapshotVersion,
        };
    }

    const modelId = node.imageModel || 'gemini-pro';
    const modelName = IMAGE_MODEL_NAMES[modelId] || node.model || modelId;
    const aspectRatio = node.aspectRatio || 'Auto';
    const quality = node.resolution || '1K';
    const referenceInputCount = (node.parentIds || []).filter(parentId => {
        const parent = nodes.find(candidate => candidate.id === parentId);
        return parent && parent.type !== 'Text' && Boolean(parent.resultUrl);
    }).length + (node.characterReferenceUrls?.length || 0);

    return {
        status: 'awaiting_approval',
        proposal: {
            proposalId: `proposal-${action.toolCallId}`,
            toolCallId: action.toolCallId,
            toolName: 'request_image_generation',
            status: 'awaiting_approval',
            target: {
                type: 'canvas_node',
                id: node.id,
                expectedRevision: snapshotNode.nodeVersion,
            },
            display: {
                title: 'Generate image?',
                summary: node.title || 'Image node',
                parameters: {
                    prompt,
                    modelId,
                    modelName,
                    aspectRatio,
                    quality,
                    referenceInputCount,
                },
                ...(modelId === 'gemini-pro' ? {
                    estimatedCost: {
                        amount: 0.49,
                        currency: 'USD' as const,
                        note: 'Estimate from the currently configured gateway; actual charge may differ.',
                    },
                } : {}),
            },
            arguments: {
                nodeId: node.id,
                prompt,
                modelId,
                aspectRatio,
                quality,
            },
        },
    };
}
