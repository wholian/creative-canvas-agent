import type { ExecutionProposal } from './executionProposal.ts';
import type { AgentClientAction } from './clientTools.ts';

export type AgentTurnStatus =
    | 'running'
    | 'awaiting_tool'
    | 'awaiting_approval'
    | 'completed'
    | 'failed';

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
}
