/**
 * useChatAgent.ts
 * 
 * Custom hook for chat agent interactions.
 * Manages messages, sessions, topics, and API communication.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ExecutionProposal } from '../agent-runtime/executionProposal';

// ============================================================================
// TYPES
// ============================================================================

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    media?: {
        type: 'image' | 'video';
        url: string;
    }[]; // Array of media attachments
    timestamp: Date;
}

export interface ChatSession {
    id: string;
    topic: string;
    createdAt: string;
    updatedAt?: string;
    messageCount: number;
}

export interface AddCanvasAction {
    type: 'add_node';
    nodeType: 'image' | 'video';
    prompt: string;
    toolCallId: string;
    imageModel?: string;
    modelName?: string;
    aspectRatio?: string;
    resolution?: string;
    expectedSnapshotVersion?: string;
}

export interface SnapshotCanvasAction { type: 'get_snapshot'; toolCallId: string; }
export interface UpdateCanvasAction {
    type: 'update_node'; toolCallId: string; nodeId: string; expectedSnapshotVersion: string;
    updates: { title?: string; prompt?: string; x?: number; y?: number; model?: string; aspectRatio?: string; resolution?: string };
}
export interface DeleteCanvasAction { type: 'delete_node'; toolCallId: string; nodeId: string; expectedSnapshotVersion: string; }
export interface ConnectionCanvasAction {
    type: 'connect_nodes' | 'disconnect_nodes'; toolCallId: string;
    fromNodeId: string; toNodeId: string; expectedSnapshotVersion: string;
}
export interface RequestImageGenerationAction {
    type: 'request_generation';
    generationType: 'image';
    toolCallId: string;
    nodeId: string;
    expectedSnapshotVersion: string;
    approvalDecision?: 'approved';
}
export type CanvasAction = AddCanvasAction | SnapshotCanvasAction | UpdateCanvasAction | DeleteCanvasAction | ConnectionCanvasAction | RequestImageGenerationAction;

export interface CanvasActionExecution {
    toolCallId: string;
    status: 'awaiting_approval' | 'succeeded' | 'failed';
    nodeId?: string;
    operation?: 'snapshot' | 'add' | 'update' | 'delete' | 'connect' | 'disconnect' | 'request_generation';
    snapshotVersion?: string;
    snapshot?: unknown;
    connectionId?: string;
    deletedConnectionIds?: string[];
    proposalId?: string;
    proposal?: ExecutionProposal;
    resultUrl?: string;
    errorCode?: string;
    error?: string;
}

export interface PendingExecutionApproval {
    proposal: ExecutionProposal;
    pendingActionId: string;
}

interface UseChatAgentOptions {
    onCanvasActions?: (actions: CanvasAction[]) => CanvasActionExecution[] | Promise<CanvasActionExecution[]>;
}

interface UseChatAgentReturn {
    messages: ChatMessage[];
    topic: string | null;
    sessionId: string | null;
    isLoading: boolean;
    error: string | null;
    sessions: ChatSession[];
    isLoadingSessions: boolean;
    pendingApproval: PendingExecutionApproval | null;
    isApprovalExecuting: boolean;
    sendMessage: (content: string, media?: { type: 'image' | 'video'; url: string; base64?: string }[]) => Promise<void>;
    approvePendingApproval: () => Promise<void>;
    rejectPendingApproval: () => Promise<void>;
    startNewChat: () => void;
    loadSession: (sessionId: string) => Promise<void>;
    deleteSession: (sessionId: string) => Promise<void>;
    refreshSessions: () => Promise<void>;
    hasMessages: boolean;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
    return `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// HOOK
// ============================================================================

export function useChatAgent({ onCanvasActions }: UseChatAgentOptions = {}): UseChatAgentReturn {
    // --- State ---
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [topic, setTopic] = useState<string | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [isLoadingSessions, setIsLoadingSessions] = useState(false);
    const [pendingApproval, setPendingApproval] = useState<PendingExecutionApproval | null>(null);
    const [isApprovalExecuting, setIsApprovalExecuting] = useState(false);

    interface PendingApprovalContext {
        pendingActionId: string;
        actions: CanvasAction[];
        executions: CanvasActionExecution[];
        approvalAction: RequestImageGenerationAction;
        proposal: ExecutionProposal;
        toolRounds: number;
    }
    const pendingApprovalRef = useRef<PendingApprovalContext | null>(null);
    const resolvingApprovalRef = useRef(false);

    // Use ref to track if we've initialized a session
    const hasInitializedRef = useRef(false);

    // --- Callbacks ---

    /**
     * Initialize a new session if needed
     */
    const ensureSession = useCallback(() => {
        if (!sessionId) {
            const newSessionId = generateSessionId();
            setSessionId(newSessionId);
            return newSessionId;
        }
        return sessionId;
    }, [sessionId]);

    /**
     * Fetch all chat sessions from the server
     */
    const refreshSessions = useCallback(async () => {
        setIsLoadingSessions(true);
        try {
            const response = await fetch('/api/chat/sessions');
            if (response.ok) {
                const data = await response.json();
                setSessions(data);
            }
        } catch (err) {
            console.error('Failed to fetch sessions:', err);
        } finally {
            setIsLoadingSessions(false);
        }
    }, []);

    /**
     * Load a specific session by ID
     */
    const loadSession = useCallback(async (targetSessionId: string) => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch(`/api/chat/sessions/${targetSessionId}`);
            if (!response.ok) {
                throw new Error('Session not found');
            }

            const data = await response.json();

            if (Array.isArray(data.actions) && data.actions.length > 0) {
                onCanvasActions?.(data.actions as CanvasAction[]);
            }

            // Convert messages to ChatMessage format
            const loadedMessages: ChatMessage[] = data.messages.map((msg: any, index: number) => ({
                id: `loaded-${targetSessionId}-${index}`,
                role: msg.role,
                content: msg.content,
                media: msg.media,
                timestamp: new Date(msg.timestamp || data.createdAt),
            }));

            setSessionId(targetSessionId);
            setMessages(loadedMessages);
            setTopic(data.topic);
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load session';
            setError(errorMessage);
            console.error('Load session error:', err);
        } finally {
            setIsLoading(false);
        }
    }, [onCanvasActions]);

    /**
     * Delete a session
     */
    const deleteSession = useCallback(async (targetSessionId: string) => {
        try {
            await fetch(`/api/chat/sessions/${targetSessionId}`, {
                method: 'DELETE',
            });

            // Refresh sessions list
            await refreshSessions();

            // If we deleted the current session, start a new one
            if (targetSessionId === sessionId) {
                setMessages([]);
                setTopic(null);
                setSessionId(generateSessionId());
            }
        } catch (err) {
            console.error('Failed to delete session:', err);
        }
    }, [sessionId, refreshSessions]);

    const finishAgentResponse = useCallback(async (data: any) => {
        const aiMessage: ChatMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: data.response || '已完成画布操作。',
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, aiMessage]);
        if (data.topic) setTopic(data.topic);
        await refreshSessions();
    }, [refreshSessions]);

    /**
     * Execute ordinary browser-owned tools until the model finishes or one
     * execution returns an approval proposal. In the latter case no tool
     * result is sent yet: the server continuation remains paused.
     */
    const continueToolLoop = useCallback(async (initialData: any, initialToolRounds = 0): Promise<void> => {
        let data = initialData;
        let toolRounds = initialToolRounds;
        while (data.pendingActionId && Array.isArray(data.actions)) {
            toolRounds += 1;
            if (toolRounds > 5) throw new Error('Canvas Agent exceeded the 5-round tool-call limit.');

            const actions = data.actions as CanvasAction[];
            let executions: CanvasActionExecution[];
            try {
                executions = await onCanvasActions?.(actions) || [];
            } catch (executionError: unknown) {
                executions = actions.map(action => ({
                    toolCallId: action.toolCallId,
                    status: 'failed' as const,
                    error: executionError instanceof Error ? executionError.message : 'The browser could not apply this canvas action.',
                }));
            }

            const approvalExecution = executions.find(execution => execution.status === 'awaiting_approval' && execution.proposal);
            if (approvalExecution?.proposal) {
                const approvalAction = actions.find(action => action.toolCallId === approvalExecution.toolCallId);
                if (!approvalAction || approvalAction.type !== 'request_generation') {
                    throw new Error('The browser returned an approval proposal for an unsupported action.');
                }
                const context: PendingApprovalContext = {
                    pendingActionId: data.pendingActionId,
                    actions,
                    executions,
                    approvalAction,
                    proposal: approvalExecution.proposal,
                    toolRounds,
                };
                pendingApprovalRef.current = context;
                setPendingApproval({ proposal: context.proposal, pendingActionId: context.pendingActionId });
                return;
            }

            const completionResponse = await fetch(`/api/chat/actions/${data.pendingActionId}/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ executions }),
            });
            if (!completionResponse.ok) {
                const errData = await completionResponse.json().catch(() => ({}));
                throw new Error(errData.error || completionResponse.statusText);
            }
            data = await completionResponse.json();
        }
        await finishAgentResponse(data);
    }, [finishAgentResponse, onCanvasActions]);

    /** Send a message to the chat agent. */
    const sendMessage = useCallback(async (
        content: string,
        media?: { type: 'image' | 'video'; url: string; base64?: string }[]
    ) => {
        if (pendingApprovalRef.current) {
            setError('Please approve or reject the pending execution before sending another message.');
            return;
        }
        const currentSessionId = ensureSession();
        setError(null);
        setIsLoading(true);

        const userMessage: ChatMessage = {
            id: generateMessageId(),
            role: 'user',
            content,
            media: media ? media.map(m => ({ type: m.type, url: m.url })) : undefined,
            timestamp: new Date(),
        };
        setMessages(prev => [...prev, userMessage]);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: currentSessionId,
                    message: content,
                    media: media ? media.map(m => ({ type: m.type, base64: m.base64 || m.url })) : undefined,
                }),
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || response.statusText);
            }
            await continueToolLoop(await response.json());
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
            setError(errorMessage);
            console.error('Chat error:', err);
        } finally {
            setIsLoading(false);
        }
    }, [continueToolLoop, ensureSession]);

    const resolvePendingApproval = useCallback(async (decision: 'approved' | 'rejected') => {
        const context = pendingApprovalRef.current;
        if (!context || resolvingApprovalRef.current) return;

        resolvingApprovalRef.current = true;
        setError(null);
        setIsApprovalExecuting(true);
        setIsLoading(true);
        try {
            let decisionExecution: CanvasActionExecution;
            if (decision === 'approved') {
                const approvedAction: RequestImageGenerationAction = {
                    ...context.approvalAction,
                    approvalDecision: 'approved',
                };
                const executions = await onCanvasActions?.([approvedAction]) || [];
                decisionExecution = executions[0] || {
                    toolCallId: approvedAction.toolCallId,
                    status: 'failed',
                    operation: 'request_generation',
                    errorCode: 'missing_execution_result',
                    error: 'The browser returned no generation result.',
                };
            } else {
                decisionExecution = {
                    toolCallId: context.approvalAction.toolCallId,
                    status: 'failed',
                    operation: 'request_generation',
                    nodeId: context.approvalAction.nodeId,
                    proposalId: context.proposal.proposalId,
                    errorCode: 'user_rejected',
                    error: 'User rejected the proposed image generation.',
                };
            }

            const executions = context.executions.map(execution =>
                execution.toolCallId === decisionExecution.toolCallId ? decisionExecution : execution);
            pendingApprovalRef.current = null;
            setPendingApproval(null);

            const completionResponse = await fetch(`/api/chat/actions/${context.pendingActionId}/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ executions }),
            });
            if (!completionResponse.ok) {
                const errData = await completionResponse.json().catch(() => ({}));
                throw new Error(errData.error || completionResponse.statusText);
            }
            await continueToolLoop(await completionResponse.json(), context.toolRounds);
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to resolve execution approval';
            setError(errorMessage);
            console.error('Approval error:', err);
        } finally {
            resolvingApprovalRef.current = false;
            setIsApprovalExecuting(false);
            setIsLoading(false);
        }
    }, [continueToolLoop, onCanvasActions]);

    const approvePendingApproval = useCallback(() => resolvePendingApproval('approved'), [resolvePendingApproval]);
    const rejectPendingApproval = useCallback(() => resolvePendingApproval('rejected'), [resolvePendingApproval]);

    /**
     * Start a new chat session
     */
    const startNewChat = useCallback(() => {
        if (pendingApprovalRef.current) {
            setError('Approve or reject the pending execution before starting a new chat.');
            return;
        }
        setMessages([]);
        setTopic(null);
        setSessionId(generateSessionId());
        setError(null);
        hasInitializedRef.current = false;
    }, []);

    // Load sessions on mount
    useEffect(() => {
        refreshSessions();
    }, [refreshSessions]);

    return {
        messages,
        topic,
        sessionId,
        isLoading,
        error,
        sessions,
        isLoadingSessions,
        pendingApproval,
        isApprovalExecuting,
        sendMessage,
        approvePendingApproval,
        rejectPendingApproval,
        startNewChat,
        loadSession,
        deleteSession,
        refreshSessions,
        hasMessages: messages.length > 0,
    };
}

export default useChatAgent;
