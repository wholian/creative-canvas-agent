/**
 * useChatAgent.ts
 * 
 * Custom hook for chat agent interactions.
 * Manages messages, sessions, topics, and API communication.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

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
export type CanvasAction = AddCanvasAction | SnapshotCanvasAction | UpdateCanvasAction | DeleteCanvasAction | ConnectionCanvasAction;

export interface CanvasActionExecution {
    toolCallId: string;
    status: 'succeeded' | 'failed';
    nodeId?: string;
    operation?: 'snapshot' | 'add' | 'update' | 'delete' | 'connect' | 'disconnect';
    snapshotVersion?: string;
    snapshot?: unknown;
    connectionId?: string;
    deletedConnectionIds?: string[];
    errorCode?: string;
    error?: string;
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
    sendMessage: (content: string, media?: { type: 'image' | 'video'; url: string; base64?: string }[]) => Promise<void>;
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
    }, []);

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

    /**
     * Send a message to the chat agent
     */
    const sendMessage = useCallback(async (
        content: string,
        media?: { type: 'image' | 'video'; url: string; base64?: string }[]
    ) => {
        const currentSessionId = ensureSession();
        setError(null);
        setIsLoading(true);

        // Add user message immediately
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
                    media: media ? media.map(m => ({
                        type: m.type,
                        base64: m.base64 || m.url, // Use base64 if available, otherwise URL
                    })) : undefined,
                }),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || response.statusText);
            }

            let data = await response.json();

            // The model may need several tool rounds, for example:
            // read snapshot -> delete by exact node ID -> give a final answer.
            let toolRounds = 0;
            while (data.pendingActionId && Array.isArray(data.actions)) {
                toolRounds += 1;
                if (toolRounds > 5) throw new Error('Canvas Agent exceeded the 5-round tool-call limit.');
                let executions: CanvasActionExecution[] = [];
                try {
                    executions = await onCanvasActions?.(data.actions as CanvasAction[]) || [];
                } catch (executionError: unknown) {
                    executions = (data.actions as CanvasAction[]).map(action => ({
                        toolCallId: action.toolCallId,
                        status: 'failed' as const,
                        error: executionError instanceof Error ? executionError.message : 'The browser could not apply this canvas action.',
                    }));
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

            // Add AI response
            const aiMessage: ChatMessage = {
                id: generateMessageId(),
                role: 'assistant',
                content: data.response || '已完成画布操作。',
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, aiMessage]);

            // Update topic if returned
            if (data.topic) {
                setTopic(data.topic);
            }

            // Refresh sessions list to show the new/updated session
            await refreshSessions();
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
            setError(errorMessage);
            console.error('Chat error:', err);
        } finally {
            setIsLoading(false);
        }
    }, [ensureSession, onCanvasActions, refreshSessions]);

    /**
     * Start a new chat session
     */
    const startNewChat = useCallback(() => {
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
        sendMessage,
        startNewChat,
        loadSession,
        deleteSession,
        refreshSessions,
        hasMessages: messages.length > 0,
    };
}

export default useChatAgent;
