import type {
    AgentCanvasAction,
    AgentCanvasExecution,
    AgentCanvasSnapshotNode,
} from '../canvas-adapters/agentCanvasOperationBridge.ts';
import type { ExecutionProposal } from './executionProposal.ts';
import type { GenerationJobStatus } from '../generation-domain/index.ts';

export interface RequestImageGenerationAction {
    type: 'request_generation';
    generationType: 'image';
    toolCallId: string;
    nodeId: string;
    expectedNodeVersion: string;
    approvalDecision?: 'approved';
}

export type AgentClientAction = AgentCanvasAction | RequestImageGenerationAction;

export interface ImageGenerationExecution {
    toolCallId: string;
    status: 'awaiting_approval' | 'succeeded' | 'failed';
    operation: 'request_generation';
    nodeId?: string;
    nodeVersion?: string;
    currentNode?: AgentCanvasSnapshotNode;
    snapshotVersion?: string;
    proposalId?: string;
    proposal?: ExecutionProposal;
    generationJobId?: string;
    generationJobStatus?: GenerationJobStatus;
    artifactId?: string;
    resultUrl?: string;
    errorCode?: string;
    error?: string;
}

export type AgentClientExecution = AgentCanvasExecution | ImageGenerationExecution;
