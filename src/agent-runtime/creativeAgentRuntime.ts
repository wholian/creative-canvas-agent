import type { AgentClientExecution } from './clientTools.ts';
import type { AgentTurn } from './types.ts';

export interface StartAgentTurnInput {
    sessionId: string;
    message: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface CreativeAgentRuntime {
    startTurn(input: StartAgentTurnInput): Promise<AgentTurn>;
    completeTool(turnId: string, executions: AgentClientExecution[]): Promise<AgentTurn>;
    resolveApproval(turnId: string, decision: 'approved' | 'rejected'): Promise<AgentTurn>;
    getTurn(turnId: string): AgentTurn | undefined;
    deleteSession(sessionId: string): void;
}
