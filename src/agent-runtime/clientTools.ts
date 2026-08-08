import type {
    AgentCanvasAction,
    AgentCanvasExecution,
} from '../canvas-adapters/agentCanvasOperationBridge.ts';
import type { ExecutionProposal } from './executionProposal.ts';

export interface RequestImageGenerationAction {
    type: 'request_generation';
    generationType: 'image';
    toolCallId: string;
    nodeId: string;
    expectedSnapshotVersion: string;
    approvalDecision?: 'approved';
}

export type AgentClientAction = AgentCanvasAction | RequestImageGenerationAction;

export interface ImageGenerationExecution {
    toolCallId: string;
    status: 'awaiting_approval' | 'succeeded' | 'failed';
    operation: 'request_generation';
    nodeId?: string;
    snapshotVersion?: string;
    proposalId?: string;
    proposal?: ExecutionProposal;
    resultUrl?: string;
    errorCode?: string;
    error?: string;
}

export type AgentClientExecution = AgentCanvasExecution | ImageGenerationExecution;
