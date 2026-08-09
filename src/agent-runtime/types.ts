import type { ExecutionProposal } from './executionProposal.ts';
import type { AgentClientAction } from './clientTools.ts';

export type AgentTurnStatus =
    | 'running'
    | 'awaiting_tool'
    | 'awaiting_approval'
    | 'cancelled'
    | 'completed'
    | 'failed';

export type AgentTurnEventType =
    | 'turn.started'
    | 'model.started'
    | 'model.completed'
    | 'tool.requested'
    | 'tool.completed'
    | 'approval.requested'
    | 'approval.resolved'
    | 'turn.completed'
    | 'turn.failed'
    | 'turn.cancelled';

export interface AgentTurnEvent {
    id: string;
    type: AgentTurnEventType;
    timestamp: string;
    modelRound?: number;
    toolName?: string;
    toolCallId?: string;
    outcome?: 'succeeded' | 'failed' | 'approved' | 'rejected' | 'cancelled';
}

export interface AgentTurn {
    id: string;
    sessionId: string;
    status: AgentTurnStatus;
    toolRound: number;
    action?: AgentClientAction;
    approval?: ExecutionProposal;
    response?: string;
    error?: string;
    traceIds: string[];
    events: AgentTurnEvent[];
}
