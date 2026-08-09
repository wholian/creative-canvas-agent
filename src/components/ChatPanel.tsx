/**
 * ChatPanel.tsx
 * 
 * Agent chat panel that slides in from the right side.
 * Shows greeting, inspiration suggestions, chat messages, and input.
 * Supports drag-drop of image/video nodes from canvas.
 * Includes chat history panel for viewing past conversations.
 */

import React, { useState, useRef, useEffect } from 'react';
import { X, History, Paperclip, Globe, Settings, Send, Sparkles, Plus, Loader2, ChevronLeft, Trash2, MessageSquare, ShieldCheck, Clock3, CheckCircle2, AlertCircle, Square } from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import {
    useChatAgent,
    ChatMessage as ChatMessageType,
    ChatSession,
} from '../hooks/useChatAgent';
import type { AgentClientAction as CanvasAction, AgentClientExecution as CanvasActionExecution } from '../agent-runtime/clientTools.ts';
import type { GenerationJob } from '../generation-domain/index.ts';
import { shouldSubmitChatMessage } from '../utils/chatInputKeyboard';
import { describeAgentEvent, describeAgentTurn } from '../agent-runtime/runPresentation.ts';

// ============================================================================
// TYPES
// ============================================================================

interface AttachedMedia {
    type: 'image' | 'video';
    url: string;
    nodeId: string;
    base64?: string;
}

interface ChatPanelProps {
    isOpen: boolean;
    onClose: () => void;
    userName?: string;
    isDraggingNode?: boolean;
    onNodeDrop?: (nodeId: string, url: string, type: 'image' | 'video') => void;
    onCanvasActions?: (
        actions: CanvasAction[],
        onGenerationJobUpdate?: (job: GenerationJob) => void,
    ) => CanvasActionExecution[] | Promise<CanvasActionExecution[]>;
    canvasTheme?: 'dark' | 'light';
}

// ============================================================================
// COMPONENT
// ============================================================================

export const ChatPanel: React.FC<ChatPanelProps> = ({
    isOpen,
    onClose,
    userName = 'Creator',
    isDraggingNode = false,
    onCanvasActions,
    canvasTheme = 'dark',
}) => {
    // --- State ---
    const [message, setMessage] = useState('');
    const [showTip, setShowTip] = useState(true);
    const [attachedMedia, setAttachedMedia] = useState<AttachedMedia[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [showHistory, setShowHistory] = useState(false);

    // Theme helper
    const isDark = canvasTheme === 'dark';

    // Chat agent hook
    const {
        messages,
        topic,
        isLoading,
        error,
        sessions,
        isLoadingSessions,
        pendingApproval,
        isApprovalExecuting,
        activeGenerationJob,
        activeTurn,
        isTurnActive,
        isCancellingTurn,
        sendMessage,
        cancelActiveTurn,
        approvePendingApproval,
        rejectPendingApproval,
        startNewChat,
        loadSession,
        deleteSession,
        hasMessages,
    } = useChatAgent({ onCanvasActions });

    // Refs
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const isComposingRef = useRef(false);

    // --- Effects ---

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, pendingApproval]);

    // --- Event Handlers ---

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        // Only set false if leaving the panel entirely
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);

        // Get data from drag event
        const nodeData = e.dataTransfer.getData('application/json');
        if (nodeData) {
            try {
                const { nodeId, url, type } = JSON.parse(nodeData);
                if (url && (type === 'image' || type === 'video')) {
                    // Convert URL to base64 for API consumption
                    let base64Data: string | undefined;

                    if (type === 'image') {
                        try {
                            // Fetch the image and convert to base64
                            const response = await fetch(url);
                            const blob = await response.blob();
                            base64Data = await new Promise<string>((resolve, reject) => {
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                    const result = reader.result as string;
                                    // Extract just the base64 part (remove data:image/...;base64, prefix)
                                    const base64 = result.split(',')[1];
                                    resolve(base64);
                                };
                                reader.onerror = reject;
                                reader.readAsDataURL(blob);
                            });
                        } catch (err) {
                            console.error('Failed to convert image to base64:', err);
                        }
                    }

                    // Add to attachments if not already present
                    setAttachedMedia(prev => {
                        if (prev.some(m => m.nodeId === nodeId)) return prev;
                        return [...prev, { type, url, nodeId, base64: base64Data }];
                    });
                }
            } catch (err) {
                console.error('Failed to parse dropped node data:', err);
            }
        }
    };


    const removeAttachment = (nodeId: string) => {
        setAttachedMedia(prev => prev.filter(m => m.nodeId !== nodeId));
    };

    const handleSend = async () => {
        if ((!message.trim() && attachedMedia.length === 0) || isLoading || pendingApproval || isTurnActive) return;

        const currentMessage = message;
        const currentMedia = attachedMedia;

        // Clear input immediately for better UX
        setMessage('');
        setAttachedMedia([]);

        // Reset textarea height
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }

        // Hide tip after first message
        if (showTip) {
            setShowTip(false);
        }

        await sendMessage(
            currentMessage,
            currentMedia.length > 0 ? currentMedia.map(m => ({
                type: m.type,
                url: m.url,
                base64: m.base64,
            })) : undefined
        );
    };

    const handleNewChat = () => {
        startNewChat();
        setMessage('');
        setAttachedMedia([]);
        setShowTip(true);
        setShowHistory(false);
    };

    const handleLoadSession = async (sessionId: string) => {
        await loadSession(sessionId);
        setShowHistory(false);
        setShowTip(false);
    };

    const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        await deleteSession(sessionId);
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            return 'Yesterday';
        } else if (diffDays < 7) {
            return `${diffDays} days ago`;
        } else {
            return date.toLocaleDateString();
        }
    };

    // --- Render ---

    if (!isOpen) return null;

    const showHighlight = isDraggingNode || isDragOver;
    const generationJobIsRunning = activeGenerationJob?.status === 'queued' || activeGenerationJob?.status === 'running';

    return (
        <div
            className={`fixed top-0 right-0 w-[400px] h-full border-l flex flex-col z-40 shadow-2xl transition-all duration-300 ${showHighlight ? 'border-cyan-500 border-2' : isDark ? 'border-neutral-800' : 'border-neutral-200'} ${isDark ? 'bg-[#1a1a1a]' : 'bg-white'}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {/* Drag Overlay */}
            {showHighlight && (
                <div className="absolute inset-0 bg-cyan-500/10 pointer-events-none z-10 flex items-center justify-center">
                    <div className="bg-cyan-500/20 border-2 border-dashed border-cyan-400 rounded-2xl px-8 py-6 text-center">
                        <Sparkles className="w-10 h-10 mx-auto mb-2 text-cyan-400" />
                        <p className="text-cyan-300 font-medium">Drop image/video here</p>
                    </div>
                </div>
            )}

            {/* History Panel */}
            {showHistory && (
                <div className={`absolute inset-0 z-20 flex flex-col ${isDark ? 'bg-[#1a1a1a]' : 'bg-white'}`}>
                    {/* History Header */}
                    <div className={`flex items-center gap-3 px-4 py-3 border-b ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                        <button
                            onClick={() => setShowHistory(false)}
                            className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-800 text-neutral-400 hover:text-white' : 'hover:bg-neutral-100 text-neutral-500 hover:text-neutral-900'}`}
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <span className={`font-medium text-sm ${isDark ? 'text-white' : 'text-neutral-900'}`}>Chat History</span>
                    </div>

                    {/* History List */}
                    <div className="flex-1 overflow-y-auto p-4">
                        {isLoadingSessions ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
                            </div>
                        ) : sessions.length === 0 ? (
                            <div className="text-center py-8">
                                <MessageSquare className="w-12 h-12 mx-auto mb-3 text-neutral-600" />
                                <p className="text-neutral-500 text-sm">No chat history yet</p>
                                <p className="text-neutral-600 text-xs mt-1">Start a conversation to see it here</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {sessions.map((session: ChatSession) => (
                                    <div
                                        key={session.id}
                                        onClick={() => handleLoadSession(session.id)}
                                        role="button"
                                        tabIndex={0}
                                        className={`w-full text-left p-3 rounded-xl transition-colors group cursor-pointer ${isDark ? 'bg-neutral-800/50 hover:bg-neutral-800' : 'bg-neutral-100 hover:bg-neutral-200'}`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-sm font-medium truncate ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                                                    {session.topic}
                                                </p>
                                                <p className={`text-xs mt-1 ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                                                    {session.messageCount} messages · {formatDate(session.updatedAt || session.createdAt)}
                                                </p>
                                            </div>
                                            <button
                                                onClick={(e) => handleDeleteSession(e, session.id)}
                                                className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded-lg transition-all text-neutral-500 hover:text-red-400"
                                                title="Delete chat"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* New Chat Button */}
                    <div className={`p-4 border-t ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                        <button
                            onClick={handleNewChat}
                            className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 rounded-xl text-white font-medium text-sm transition-colors flex items-center justify-center gap-2"
                        >
                            <Plus size={16} />
                            New Chat
                        </button>
                    </div>
                </div>
            )
            }

            {/* Header */}
            <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                <div className="flex items-center gap-3">
                    {/* Topic or default title */}
                    <span className={`font-medium text-sm truncate max-w-[180px] ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                        {topic || (hasMessages ? 'New Chat' : 'ImageIdeas')}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    {/* New Chat button - only show after messages exist */}
                    {hasMessages && (
                        <button
                            onClick={handleNewChat}
                            className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-800 text-neutral-400 hover:text-white' : 'hover:bg-neutral-100 text-neutral-500 hover:text-neutral-900'}`}
                            title="New Chat"
                        >
                            <Plus size={18} />
                        </button>
                    )}
                    <button
                        onClick={() => setShowHistory(true)}
                        className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-800 text-neutral-400 hover:text-white' : 'hover:bg-neutral-100 text-neutral-500 hover:text-neutral-900'}`}
                        title="Chat History"
                    >
                        <History size={18} />
                    </button>
                    <button
                        onClick={onClose}
                        className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-800 text-neutral-400 hover:text-white' : 'hover:bg-neutral-100 text-neutral-500 hover:text-neutral-900'}`}
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {/* Show greeting and tip if no messages */}
                {!hasMessages ? (
                    <>
                        {/* Greeting */}
                        <h1 className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                            Hi, {userName}
                        </h1>
                        <p className="text-cyan-400 text-lg mb-6">
                            Looking for inspiration?
                        </p>

                        {/* Tip Card */}
                        {showTip && (
                            <div className={`rounded-2xl p-4 mb-4 ${isDark ? 'bg-neutral-800/50' : 'bg-neutral-100'}`}>
                                <div className={`rounded-xl overflow-hidden mb-3 flex items-center justify-center ${isDark ? 'bg-neutral-700/50' : 'bg-neutral-200'}`}>
                                    <img
                                        src="/chat-preview.gif"
                                        alt="Drag and drop preview"
                                        className="w-full h-auto object-cover rounded-xl"
                                    />
                                </div>
                                <p className={`text-sm leading-relaxed mb-3 ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                                    Drag image/video nodes into the chat dialog to unlock advanced features like prompt generation based on node content, providing more inspiration for your creativity~
                                </p>
                                <div className="flex justify-end">
                                    <button
                                        onClick={() => setShowTip(false)}
                                        className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${isDark ? 'bg-neutral-700 hover:bg-neutral-600 text-white' : 'bg-neutral-200 hover:bg-neutral-300 text-neutral-900'}`}
                                    >
                                        Got it
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    /* Chat Messages */
                    <div className="space-y-1">
                        {messages.map((msg: ChatMessageType) => (
                            <ChatMessage
                                key={msg.id}
                                role={msg.role}
                                content={msg.content}
                                media={msg.media}
                                timestamp={msg.timestamp}
                            />
                        ))}

                        {pendingApproval && (() => {
                            const proposal = pendingApproval.proposal;
                            const parameters = proposal.display.parameters;
                            const estimatedCost = proposal.display.estimatedCost;
                            return (
                                <div className={`my-4 rounded-2xl border p-4 ${isDark ? 'border-cyan-500/40 bg-cyan-950/20' : 'border-cyan-300 bg-cyan-50'}`}>
                                    <div className="flex items-start gap-3">
                                        <div className={`mt-0.5 rounded-lg p-2 ${isDark ? 'bg-cyan-500/15 text-cyan-300' : 'bg-cyan-100 text-cyan-700'}`}>
                                            <ShieldCheck size={18} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                                                {proposal.display.title}
                                            </div>
                                            <div className={`mt-0.5 truncate text-xs ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                                                {proposal.display.summary} · {proposal.target.id}
                                            </div>
                                        </div>
                                    </div>

                                    <div className={`mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl p-3 text-xs ${isDark ? 'bg-black/20 text-neutral-300' : 'bg-white/80 text-neutral-700'}`}>
                                        <span className="text-neutral-500">Model</span>
                                        <span className="text-right">{String(parameters.modelName || parameters.modelId || 'Default')}</span>
                                        <span className="text-neutral-500">Aspect ratio</span>
                                        <span className="text-right">{String(parameters.aspectRatio || 'Auto')}</span>
                                        <span className="text-neutral-500">Quality</span>
                                        <span className="text-right">{String(parameters.quality || 'Auto')}</span>
                                        <span className="text-neutral-500">Reference inputs</span>
                                        <span className="text-right">{String(parameters.referenceInputCount || 0)}</span>
                                        <span className="text-neutral-500">Estimated cost</span>
                                        <span className="text-right">
                                            {estimatedCost ? `≈ $${estimatedCost.amount.toFixed(2)} ${estimatedCost.currency}` : 'Unavailable'}
                                        </span>
                                    </div>

                                    <div className={`mt-3 max-h-28 overflow-y-auto rounded-xl border p-3 text-xs leading-relaxed ${isDark ? 'border-neutral-700 bg-neutral-900/70 text-neutral-300' : 'border-neutral-200 bg-white text-neutral-700'}`}>
                                        {String(parameters.prompt || '')}
                                    </div>
                                    {Array.isArray(parameters.referencePreviews) && parameters.referencePreviews.length > 0 && (
                                        <div className="mt-3">
                                            <div className={`mb-1.5 text-[10px] font-semibold uppercase tracking-wider ${isDark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                                                Frozen reference images
                                            </div>
                                            <div className="flex gap-2 overflow-x-auto pb-1">
                                                {parameters.referencePreviews.slice(0, 14).map((url, index) => (
                                                    <img
                                                        key={`${String(url)}-${index}`}
                                                        src={String(url)}
                                                        alt={`Reference ${index + 1}`}
                                                        className={`h-14 w-14 flex-none rounded-lg border object-cover ${isDark ? 'border-neutral-700' : 'border-neutral-200'}`}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {estimatedCost?.note && (
                                        <p className={`mt-2 text-[11px] leading-relaxed ${isDark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                                            {estimatedCost.note}
                                        </p>
                                    )}

                                    <div className="mt-4 flex justify-end gap-2">
                                        <button
                                            onClick={rejectPendingApproval}
                                            disabled={isApprovalExecuting}
                                            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${isDark ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700' : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'} disabled:cursor-not-allowed disabled:opacity-50`}
                                        >
                                            Reject
                                        </button>
                                        <button
                                            onClick={approvePendingApproval}
                                            disabled={isApprovalExecuting}
                                            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {isApprovalExecuting && <Loader2 size={13} className="animate-spin" />}
                                            {isApprovalExecuting ? 'Starting…' : 'Confirm & generate'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}

                        {activeGenerationJob && (() => {
                            const status = activeGenerationJob.status;
                            const isDone = status === 'succeeded';
                            const isFailed = status === 'failed';
                            const label = status === 'queued' ? 'Queued'
                                : status === 'running' ? 'Generating image'
                                    : status === 'succeeded' ? 'Image ready'
                                        : 'Image generation failed';
                            return (
                                <div
                                    data-generation-job-status={status}
                                    className={`my-4 rounded-2xl border p-4 ${isFailed
                                        ? isDark ? 'border-red-500/40 bg-red-950/20' : 'border-red-300 bg-red-50'
                                        : isDone
                                            ? isDark ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-emerald-300 bg-emerald-50'
                                            : isDark ? 'border-cyan-500/40 bg-cyan-950/20' : 'border-cyan-300 bg-cyan-50'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        {status === 'queued' && <Clock3 size={18} className="text-cyan-400" />}
                                        {status === 'running' && <Loader2 size={18} className="animate-spin text-cyan-400" />}
                                        {isDone && <CheckCircle2 size={18} className="text-emerald-400" />}
                                        {isFailed && <AlertCircle size={18} className="text-red-400" />}
                                        <div className="min-w-0 flex-1">
                                            <div className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-neutral-900'}`}>{label}</div>
                                            <div className={`mt-0.5 truncate text-xs ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                                                {activeGenerationJob.targetNodeId} · {activeGenerationJob.id}
                                            </div>
                                        </div>
                                    </div>
                                    <div className={`mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl p-3 text-xs ${isDark ? 'bg-black/20 text-neutral-300' : 'bg-white/80 text-neutral-700'}`}>
                                        <span className="text-neutral-500">Executor</span>
                                        <span className="text-right">Unified Image Gateway</span>
                                        <span className="text-neutral-500">Model</span>
                                        <span className="text-right">{activeGenerationJob.request.modelId}</span>
                                        <span className="text-neutral-500">Format</span>
                                        <span className="text-right">{activeGenerationJob.request.aspectRatio} · {activeGenerationJob.request.quality}</span>
                                        <span className="text-neutral-500">Attempt</span>
                                        <span className="text-right">{activeGenerationJob.attempt}</span>
                                    </div>
                                    {activeGenerationJob.artifactId && (
                                        <p className={`mt-2 text-[11px] ${isDark ? 'text-neutral-500' : 'text-neutral-500'}`}>Artifact: {activeGenerationJob.artifactId}</p>
                                    )}
                                    {activeGenerationJob.error && (
                                        <p className="mt-2 text-xs text-red-400">{activeGenerationJob.error.message}</p>
                                    )}
                                </div>
                            );
                        })()}

                        {/* Loading indicator */}
                        {isLoading && (
                            <div className="flex justify-start mb-4">
                                <div className={`rounded-2xl rounded-bl-md px-4 py-3 ${isDark ? 'bg-neutral-800' : 'bg-neutral-100'}`}>
                                    <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                                </div>
                            </div>
                        )}

                        {/* Error message */}
                        {error && (
                            <div className="flex justify-center mb-4">
                                <div className="bg-red-500/20 border border-red-500/50 rounded-lg px-4 py-2 text-red-400 text-sm">
                                    {error}
                                </div>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className={`p-4 border-t ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                {isTurnActive && (
                    <details
                        data-agent-run-status
                        className={`mb-3 rounded-xl border px-3 py-2 ${isDark ? 'border-cyan-500/25 bg-cyan-950/15' : 'border-cyan-200 bg-cyan-50'}`}
                    >
                        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs">
                            <Loader2 size={13} className="flex-none animate-spin text-cyan-400" />
                            <span className={`flex-1 font-medium ${isDark ? 'text-neutral-200' : 'text-neutral-800'}`}>
                                {describeAgentTurn(activeTurn, true)}
                            </span>
                            {activeTurn && (
                                <span className="text-[10px] text-neutral-500">{activeTurn.toolRound}/{5}</span>
                            )}
                        </summary>
                        {activeTurn?.events.length ? (
                            <div className={`mt-2 space-y-1 border-t pt-2 ${isDark ? 'border-neutral-800' : 'border-cyan-100'}`}>
                                {activeTurn.events.map(event => (
                                    <div key={event.id} className="flex items-center gap-2 text-[11px] text-neutral-500">
                                        <span className="h-1.5 w-1.5 flex-none rounded-full bg-cyan-500/70" />
                                        <span className="flex-1">{describeAgentEvent(event)}</span>
                                        <span className="tabular-nums">
                                            {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </details>
                )}
                <div className={`rounded-2xl p-3 ${isDark ? 'bg-neutral-800' : 'bg-neutral-100'}`}>
                    {/* Attached Media Preview */}
                    {attachedMedia.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-3">
                            {attachedMedia.map((media) => (
                                <div key={media.nodeId} className="relative">
                                    {media.type === 'image' ? (
                                        <img
                                            src={media.url}
                                            alt="Attached"
                                            className="w-14 h-14 object-cover rounded-lg"
                                        />
                                    ) : (
                                        <video
                                            src={media.url}
                                            className="w-14 h-14 object-cover rounded-lg"
                                        />
                                    )}
                                    <button
                                        onClick={() => removeAttachment(media.nodeId)}
                                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center text-white text-[10px]"
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <textarea
                        ref={textareaRef}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Start your journey of inspiration"
                        className={`w-full bg-transparent text-sm outline-none mb-3 resize-none min-h-[24px] max-h-[120px] ${isDark ? 'text-white placeholder:text-neutral-500' : 'text-neutral-900 placeholder:text-neutral-400'}`}
                        rows={1}
                        style={{ scrollbarWidth: 'none' }}
                        disabled={isLoading || isTurnActive || Boolean(pendingApproval)}
                        onCompositionStart={() => {
                            isComposingRef.current = true;
                        }}
                        onCompositionEnd={() => {
                            isComposingRef.current = false;
                        }}
                        onInput={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            target.style.height = 'auto';
                            const newHeight = Math.min(target.scrollHeight, 120);
                            target.style.height = newHeight + 'px';
                            target.style.overflowY = target.scrollHeight > 120 ? 'auto' : 'hidden';
                        }}
                        onKeyDown={(e) => {
                            if (shouldSubmitChatMessage({
                                key: e.key,
                                shiftKey: e.shiftKey,
                                nativeIsComposing: e.nativeEvent.isComposing,
                                compositionActive: isComposingRef.current,
                                keyCode: e.keyCode,
                            })) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                    />
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <button className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-700 text-neutral-400' : 'hover:bg-neutral-200 text-neutral-500'}`}>
                                <Paperclip size={16} />
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            <button className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-700 text-neutral-400' : 'hover:bg-neutral-200 text-neutral-500'}`}>
                                <Globe size={16} />
                            </button>
                            <button className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-700 text-neutral-400' : 'hover:bg-neutral-200 text-neutral-500'}`}>
                                <Settings size={16} />
                            </button>
                            <button
                                onClick={isTurnActive ? cancelActiveTurn : handleSend}
                                disabled={isTurnActive ? isCancellingTurn || generationJobIsRunning : isLoading || Boolean(pendingApproval) || (!message.trim() && attachedMedia.length === 0)}
                                title={generationJobIsRunning ? 'The approved generation job is already running' : isTurnActive ? 'Stop Agent turn' : 'Send'}
                                className={`p-2 rounded-full transition-colors text-white ${isTurnActive
                                    ? generationJobIsRunning ? 'cursor-not-allowed bg-neutral-600' : 'bg-red-500 hover:bg-red-400 disabled:bg-red-900'
                                    : isLoading || pendingApproval || (!message.trim() && attachedMedia.length === 0)
                                        ? 'bg-neutral-600 cursor-not-allowed'
                                        : 'bg-cyan-500 hover:bg-cyan-400'
                                    }`}
                            >
                                {isCancellingTurn ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : isTurnActive ? (
                                    <Square size={13} fill="currentColor" />
                                ) : (
                                    <Send size={14} />
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div >
    );
};

// ============================================================================
// CHAT BUBBLE
// ============================================================================

/**
 * ChatBubble - Floating button to open chat
 */
interface ChatBubbleProps {
    onClick: () => void;
    isOpen: boolean;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({ onClick, isOpen }) => {
    if (isOpen) return null;

    return (
        <button
            onClick={onClick}
            className="fixed bottom-6 right-6 w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 rounded-full flex items-center justify-center shadow-lg shadow-cyan-500/30 transition-all hover:scale-110 z-50 animate-breathing"
            style={{
                animation: 'breathing 3s ease-in-out infinite',
            }}
        >
            <Sparkles size={22} className="text-white" />
            <style>{`
                @keyframes breathing {
                    0%, 100% {
                        transform: scale(1);
                        box-shadow: 0 10px 15px -3px rgba(6, 182, 212, 0.3), 0 4px 6px -4px rgba(6, 182, 212, 0.3);
                    }
                    50% {
                        transform: scale(1.08);
                        box-shadow: 0 20px 25px -5px rgba(6, 182, 212, 0.5), 0 8px 10px -6px rgba(6, 182, 212, 0.5);
                    }
                }
            `}</style>
        </button>
    );
};
