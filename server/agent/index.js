import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CHATS_DIR = path.join(__dirname, '..', '..', 'library', 'chats');

if (!fs.existsSync(CHATS_DIR)) fs.mkdirSync(CHATS_DIR, { recursive: true });

const sessionCache = new Map();

function getSessionPath(sessionId) {
    return path.join(CHATS_DIR, `${sessionId}.json`);
}

function normalizeStoredMessage(message) {
    return {
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
        ...(Array.isArray(message.media) ? { media: message.media } : {}),
        ...(typeof message.agentTurnId === 'string' ? { agentTurnId: message.agentTurnId } : {}),
        timestamp: message.timestamp || new Date().toISOString(),
    };
}

function saveSession(sessionId, session) {
    const data = {
        id: sessionId,
        topic: session.topic,
        createdAt: session.createdAt,
        updatedAt: new Date().toISOString(),
        messages: session.messages.map(normalizeStoredMessage),
    };
    fs.writeFileSync(getSessionPath(sessionId), JSON.stringify(data, null, 2));
}

function loadSession(sessionId) {
    const filePath = getSessionPath(sessionId);
    if (!fs.existsSync(filePath)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
            messages: (data.messages || []).map(normalizeStoredMessage),
            topic: data.topic || null,
            createdAt: data.createdAt || new Date().toISOString(),
        };
    } catch (error) {
        console.error(`Failed to load session ${sessionId}:`, error);
        return null;
    }
}

export function getSession(sessionId) {
    if (sessionCache.has(sessionId)) return sessionCache.get(sessionId);
    const session = loadSession(sessionId) || {
        messages: [],
        topic: null,
        createdAt: new Date().toISOString(),
    };
    sessionCache.set(sessionId, session);
    return session;
}

export function deleteSession(sessionId) {
    sessionCache.delete(sessionId);
    const filePath = getSessionPath(sessionId);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
}

export function listSessions() {
    if (!fs.existsSync(CHATS_DIR)) return [];
    return fs.readdirSync(CHATS_DIR)
        .filter(file => file.endsWith('.json'))
        .flatMap(file => {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(CHATS_DIR, file), 'utf8'));
                return [{
                    id: data.id,
                    topic: data.topic || 'New Chat',
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt,
                    messageCount: data.messages?.length || 0,
                }];
            } catch (error) {
                console.error(`Failed to read session file ${file}:`, error);
                return [];
            }
        })
        .sort((left, right) => new Date(right.updatedAt || right.createdAt) - new Date(left.updatedAt || left.createdAt));
}

export function getSessionData(sessionId) {
    const filePath = getSessionPath(sessionId);
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        console.error(`Failed to load session data ${sessionId}:`, error);
        return null;
    }
}

function createTopic(message) {
    const compact = String(message || '').replace(/\s+/g, ' ').trim();
    return compact ? compact.slice(0, 30) : 'New Chat';
}

function serializeMedia(media) {
    if (!Array.isArray(media)) return undefined;
    return media.map(item => ({
        type: item.type,
        url: item.url || (typeof item.base64 === 'string' && !item.base64.startsWith('data:') ? item.base64 : undefined),
    })).filter(item => item.url);
}

function runtimeInput(content, media) {
    if (!Array.isArray(media) || media.length === 0) return content;
    return `${content || '请分析附件。'}\n\n[本阶段 Agent Runtime 仅传递文本；本条消息附带了 ${media.length} 个媒体素材。]`;
}

function responseFromTurn(turn, session) {
    return {
        turn,
        response: turn.status === 'completed' ? turn.response : null,
        actions: turn.status === 'awaiting_tool' && turn.action ? [turn.action] : [],
        pendingActionId: turn.status === 'awaiting_tool' || turn.status === 'awaiting_approval' ? turn.id : undefined,
        traceIds: turn.traceIds,
        topic: session.topic,
        messageCount: session.messages.length,
    };
}

function finalizeTurn(turn) {
    const session = getSession(turn.sessionId);
    if (turn.status === 'completed' && !session.messages.some(message => message.agentTurnId === turn.id)) {
        session.messages.push(normalizeStoredMessage({
            role: 'assistant', content: turn.response, agentTurnId: turn.id,
        }));
        if (!session.topic) session.topic = createTopic(session.messages.find(message => message.role === 'user')?.content);
        saveSession(turn.sessionId, session);
    }
    return responseFromTurn(turn, session);
}

export async function sendMessage(sessionId, content, media, { agentRuntime }) {
    if (!agentRuntime) throw new Error('Creative Agent Runtime is disabled. Set CREATIVE_MODEL_GATEWAY_ENABLED=true.');
    const session = getSession(sessionId);
    const history = session.messages.map(({ role, content: messageContent }) => ({ role, content: messageContent }));
    const input = runtimeInput(content, media);
    // startTurn reserves the session synchronously. Only persist the user
    // message after the reservation succeeds, otherwise a rejected concurrent
    // send would pollute the durable chat history.
    const turnPromise = agentRuntime.startTurn({
        sessionId,
        message: input,
        history,
    });
    session.messages.push(normalizeStoredMessage({
        role: 'user',
        content: input,
        media: serializeMedia(media),
    }));
    saveSession(sessionId, session);
    return finalizeTurn(await turnPromise);
}

export async function resumeActiveTurn(sessionId, { agentRuntime }) {
    if (!agentRuntime) throw new Error('Creative Agent Runtime is unavailable.');
    const turn = await agentRuntime.resumeActiveTurn(sessionId);
    return turn ? finalizeTurn(turn) : null;
}

export async function completeCanvasAction(turnId, executions, { agentRuntime }) {
    if (!agentRuntime) throw new Error('Creative Agent Runtime is unavailable.');
    return finalizeTurn(await agentRuntime.completeTool(turnId, executions));
}

export async function resolveCanvasApproval(turnId, decision, { agentRuntime }) {
    if (!agentRuntime) throw new Error('Creative Agent Runtime is unavailable.');
    return finalizeTurn(await agentRuntime.resolveApproval(turnId, decision));
}

export default {
    getSession,
    deleteSession,
    listSessions,
    getSessionData,
    sendMessage,
    resumeActiveTurn,
    completeCanvasAction,
    resolveCanvasApproval,
};
