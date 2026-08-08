import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExecutionProposal } from '../agent-runtime/executionProposal.ts';
import type { AgentClientAction, AgentClientExecution } from '../agent-runtime/clientTools.ts';
import type { AgentTurn } from '../agent-runtime/types.ts';
import type { GenerationJob } from '../generation-domain/index.ts';

export type { AgentClientAction as CanvasAction, AgentClientExecution as CanvasActionExecution } from '../agent-runtime/clientTools.ts';

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    media?: { type: 'image' | 'video'; url: string }[];
    timestamp: Date;
}

export interface ChatSession {
    id: string;
    topic: string;
    createdAt: string;
    updatedAt?: string;
    messageCount: number;
}

export interface PendingExecutionApproval {
    proposal: ExecutionProposal;
    turnId: string;
}

interface RuntimeResponse {
    turn: AgentTurn;
    response?: string | null;
    topic?: string | null;
}

interface UseChatAgentOptions {
    onCanvasActions?: (
        actions: AgentClientAction[],
        onGenerationJobUpdate?: (job: GenerationJob) => void,
    ) => AgentClientExecution[] | Promise<AgentClientExecution[]>;
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
    activeGenerationJob: GenerationJob | null;
    sendMessage: (content: string, media?: { type: 'image' | 'video'; url: string; base64?: string }[]) => Promise<void>;
    approvePendingApproval: () => Promise<void>;
    rejectPendingApproval: () => Promise<void>;
    startNewChat: () => void;
    loadSession: (sessionId: string) => Promise<void>;
    deleteSession: (sessionId: string) => Promise<void>;
    refreshSessions: () => Promise<ChatSession[]>;
    hasMessages: boolean;
}

function generateSessionId(): string {
    return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function actionOperation(action: AgentClientAction): AgentClientExecution['operation'] {
    if (action.type === 'get_snapshot') return 'snapshot';
    if (action.type === 'add_node') return 'add';
    if (action.type === 'update_node') return 'update';
    if (action.type === 'delete_node') return 'delete';
    if (action.type === 'connect_nodes') return 'connect';
    if (action.type === 'disconnect_nodes') return 'disconnect';
    return 'request_generation';
}

async function readResponse(response: Response): Promise<RuntimeResponse> {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || response.statusText);
    if (!data.turn) throw new Error('Agent Runtime returned no turn state.');
    return data;
}

export function useChatAgent({ onCanvasActions }: UseChatAgentOptions = {}): UseChatAgentReturn {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [topic, setTopic] = useState<string | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [isLoadingSessions, setIsLoadingSessions] = useState(false);
    const [pendingApproval, setPendingApproval] = useState<PendingExecutionApproval | null>(null);
    const [isApprovalExecuting, setIsApprovalExecuting] = useState(false);
    const [activeGenerationJob, setActiveGenerationJob] = useState<GenerationJob | null>(null);
    const didRestoreLatestSessionRef = useRef(false);

    const ensureSession = useCallback(() => {
        if (sessionId) return sessionId;
        const nextSessionId = generateSessionId();
        setSessionId(nextSessionId);
        return nextSessionId;
    }, [sessionId]);

    const refreshSessions = useCallback(async (): Promise<ChatSession[]> => {
        setIsLoadingSessions(true);
        try {
            const response = await fetch('/api/chat/sessions');
            if (!response.ok) return [];
            const nextSessions = await response.json() as ChatSession[];
            setSessions(nextSessions);
            return nextSessions;
        } catch (refreshError) {
            console.error('Failed to fetch sessions:', refreshError);
            return [];
        } finally {
            setIsLoadingSessions(false);
        }
    }, []);

    const finishAgentResponse = useCallback(async (data: RuntimeResponse) => {
        setMessages(previous => [...previous, {
            id: generateMessageId(),
            role: 'assistant',
            content: data.turn.response || data.response || '已完成画布操作。',
            timestamp: new Date(),
        }]);
        if (data.topic) setTopic(data.topic);
        await refreshSessions();
    }, [refreshSessions]);

    /**
     * The browser only executes the capability requested by the current turn.
     * Pi Agent owns tool ordering, transcript/tool-result assembly, and limits.
     */
    const consumeRuntimeResponse = useCallback(async (initial: RuntimeResponse): Promise<void> => {
        const consume = async (data: RuntimeResponse): Promise<void> => {
            const { turn } = data;
            if (turn.status === 'completed') {
                await finishAgentResponse(data);
                return;
            }
            if (turn.status === 'failed') throw new Error(turn.error || 'Agent Runtime failed.');
            if (turn.status === 'awaiting_approval') {
                if (!turn.approval) throw new Error('Agent Runtime returned an empty approval request.');
                setActiveGenerationJob(null);
                setPendingApproval({ proposal: turn.approval, turnId: turn.id });
                return;
            }
            if (turn.status !== 'awaiting_tool' || !turn.action) {
                throw new Error(`Unexpected Agent Runtime state: ${turn.status}`);
            }

            let executions: AgentClientExecution[];
            try {
                executions = await onCanvasActions?.([turn.action], job => setActiveGenerationJob(job)) || [];
            } catch (executionError) {
                executions = [{
                    toolCallId: turn.action.toolCallId,
                    status: 'failed',
                    operation: actionOperation(turn.action),
                    error: executionError instanceof Error ? executionError.message : 'The browser could not apply this canvas action.',
                } as AgentClientExecution];
            }
            if (executions.length === 0) {
                executions = [{
                    toolCallId: turn.action.toolCallId,
                    status: 'failed',
                    operation: actionOperation(turn.action),
                    errorCode: 'missing_execution_result',
                    error: 'The browser returned no tool result.',
                } as AgentClientExecution];
            }
            const response = await fetch(`/api/chat/actions/${turn.id}/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ executions }),
            });
            await consume(await readResponse(response));
        };
        await consume(initial);
    }, [finishAgentResponse, onCanvasActions]);

    const sendMessage = useCallback(async (
        content: string,
        media?: { type: 'image' | 'video'; url: string; base64?: string }[],
    ) => {
        if (pendingApproval) {
            setError('Please approve or reject the pending execution before sending another message.');
            return;
        }
        const currentSessionId = ensureSession();
        setError(null);
        setIsLoading(true);
        setMessages(previous => [...previous, {
            id: generateMessageId(),
            role: 'user',
            content,
            media: media?.map(item => ({ type: item.type, url: item.url })),
            timestamp: new Date(),
        }]);
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: currentSessionId,
                    message: content,
                    media: media?.map(item => ({ type: item.type, url: item.url, base64: item.base64 || item.url })),
                }),
            });
            await consumeRuntimeResponse(await readResponse(response));
        } catch (sendError) {
            const message = sendError instanceof Error ? sendError.message : 'Failed to send message';
            setError(message);
            console.error('Chat error:', sendError);
        } finally {
            setIsLoading(false);
        }
    }, [consumeRuntimeResponse, ensureSession, pendingApproval]);

    const resolvePendingApproval = useCallback(async (decision: 'approved' | 'rejected') => {
        if (!pendingApproval || isApprovalExecuting) return;
        setError(null);
        setIsApprovalExecuting(true);
        setIsLoading(true);
        try {
            const response = await fetch(`/api/chat/actions/${pendingApproval.turnId}/approval`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision }),
            });
            setPendingApproval(null);
            await consumeRuntimeResponse(await readResponse(response));
        } catch (approvalError) {
            const message = approvalError instanceof Error ? approvalError.message : 'Failed to resolve execution approval';
            setError(message);
            console.error('Approval error:', approvalError);
        } finally {
            setIsApprovalExecuting(false);
            setIsLoading(false);
        }
    }, [consumeRuntimeResponse, isApprovalExecuting, pendingApproval]);

    const loadSession = useCallback(async (targetSessionId: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/chat/sessions/${targetSessionId}`);
            if (!response.ok) throw new Error('Session not found');
            const data = await response.json();
            setSessionId(targetSessionId);
            setMessages(data.messages.map((message: any, index: number) => ({
                id: `loaded-${targetSessionId}-${index}`,
                role: message.role,
                content: message.content,
                media: message.media,
                timestamp: new Date(message.timestamp || data.createdAt),
            })));
            setTopic(data.topic);
            setActiveGenerationJob(null);
        } catch (loadError) {
            const message = loadError instanceof Error ? loadError.message : 'Failed to load session';
            setError(message);
            console.error('Load session error:', loadError);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const deleteSession = useCallback(async (targetSessionId: string) => {
        try {
            await fetch(`/api/chat/sessions/${targetSessionId}`, { method: 'DELETE' });
            await refreshSessions();
            if (targetSessionId === sessionId) {
                setMessages([]);
                setTopic(null);
                setSessionId(generateSessionId());
                setActiveGenerationJob(null);
            }
        } catch (deleteError) {
            console.error('Failed to delete session:', deleteError);
        }
    }, [refreshSessions, sessionId]);

    const startNewChat = useCallback(() => {
        if (pendingApproval) {
            setError('Approve or reject the pending execution before starting a new chat.');
            return;
        }
        setMessages([]);
        setTopic(null);
        setSessionId(generateSessionId());
        setError(null);
        setActiveGenerationJob(null);
    }, [pendingApproval]);

    useEffect(() => {
        if (didRestoreLatestSessionRef.current) return;
        didRestoreLatestSessionRef.current = true;
        void (async () => {
            const latestSession = (await refreshSessions())[0];
            if (latestSession) {
                await loadSession(latestSession.id);
                return;
            }
            setSessionId(current => current || generateSessionId());
        })();
    }, [loadSession, refreshSessions]);

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
        activeGenerationJob,
        sendMessage,
        approvePendingApproval: () => resolvePendingApproval('approved'),
        rejectPendingApproval: () => resolvePendingApproval('rejected'),
        startNewChat,
        loadSession,
        deleteSession,
        refreshSessions,
        hasMessages: messages.length > 0,
    };
}

export default useChatAgent;
