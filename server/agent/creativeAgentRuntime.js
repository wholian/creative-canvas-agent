import crypto from 'node:crypto';
import { Agent } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import { CHAT_AGENT_SYSTEM_PROMPT } from './prompts/system.js';
import { createPiModelGatewayAdapter } from './piModelGatewayAdapter.js';

const IMAGE_MODEL_SETTINGS = {
    'gpt-image-1.5': {
        name: 'GPT Image 1.5',
        aspectRatios: ['Auto', '1024x1024', '1536x1024', '1024x1536'],
        resolutions: ['Auto', '1K', '2K', '4K'],
        defaultResolution: 'Auto',
    },
    'gemini-pro': {
        name: 'Nano Banana Pro',
        aspectRatios: ['Auto', '1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9'],
        resolutions: ['1K', '2K', '4K'],
        defaultResolution: '1K',
    },
    'kling-v1-5': {
        name: 'Kling V1.5',
        aspectRatios: ['Auto', '1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '21:9'],
        resolutions: ['1K', '2K'],
        defaultResolution: '1K',
    },
    'kling-v2-1': {
        name: 'Kling V2.1',
        aspectRatios: ['Auto', '1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '21:9'],
        resolutions: ['1K', '2K'],
        defaultResolution: '1K',
    },
};

const SNAPSHOT_VERSION = Type.String({
    minLength: 1,
    description: 'The exact snapshot_version returned by get_canvas_snapshot.',
});

function textResult(value) {
    return {
        content: [{ type: 'text', text: JSON.stringify(value) }],
        details: value,
    };
}

function executionResult(execution) {
    if (execution?.status === 'succeeded') {
        return textResult({
            status: 'succeeded',
            operation: execution.operation,
            snapshot_version: execution.snapshotVersion,
            snapshot: execution.snapshot,
            node_id: execution.nodeId,
            connection_id: execution.connectionId,
            deleted_connection_ids: execution.deletedConnectionIds,
            result_url: execution.resultUrl,
            proposal_id: execution.proposalId,
        });
    }
    return textResult({
        status: 'failed',
        code: execution?.errorCode,
        error: execution?.error || 'The browser did not confirm this canvas operation.',
    });
}

function assistantText(messages) {
    const last = [...messages].reverse().find(message => message.role === 'assistant');
    if (!last) return '';
    return last.content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n');
}

function publicTurn(session) {
    return structuredClone(session.turn);
}

function historyMessages(history = []) {
    return history.flatMap(message => {
        if (message.role !== 'user' && message.role !== 'assistant') return [];
        if (message.role === 'user') {
            return [{ role: 'user', content: message.content, timestamp: Date.now() }];
        }
        return [{
            role: 'assistant',
            content: [{ type: 'text', text: message.content }],
            api: 'openai-completions',
            provider: 'openai',
            model: 'history',
            usage: {
                input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: 'stop',
            timestamp: Date.now(),
        }];
    });
}

export class CreativeAgentRuntime {
    constructor({ modelGatewayRuntime, modelName, baseUrl, maxToolRounds = 5 }) {
        this.modelGatewayRuntime = modelGatewayRuntime;
        this.modelName = modelName;
        this.baseUrl = baseUrl;
        this.maxToolRounds = maxToolRounds;
        this.sessions = new Map();
        this.turns = new Map();
    }

    createSession(sessionId, history) {
        const session = {
            sessionId,
            traceIds: [],
            turn: undefined,
            pending: undefined,
            waiters: [],
            runPromise: undefined,
            modelTurns: 0,
        };
        const { model, streamFn } = createPiModelGatewayAdapter({
            modelGatewayRuntime: this.modelGatewayRuntime,
            modelName: this.modelName,
            baseUrl: this.baseUrl,
            onTrace: traceId => {
                if (!session.traceIds.includes(traceId)) session.traceIds.push(traceId);
                if (session.turn) session.turn.traceIds = [...session.traceIds];
            },
        });
        session.agent = new Agent({
            initialState: {
                systemPrompt: CHAT_AGENT_SYSTEM_PROMPT,
                model,
                tools: this.createTools(session),
                messages: historyMessages(history),
            },
            streamFn,
            toolExecution: 'sequential',
        });
        session.agent.subscribe(event => {
            if (event.type !== 'turn_start') return;
            session.modelTurns += 1;
            // One initial model turn plus one follow-up for each allowed tool
            // round. A further model turn means the Agent did not converge.
            if (session.modelTurns > this.maxToolRounds + 1) {
                throw new Error(`Canvas Agent exceeded the ${this.maxToolRounds}-round tool-call limit.`);
            }
        });
        this.sessions.set(sessionId, session);
        return session;
    }

    createTools(session) {
        const externalTool = (name, description, parameters, toAction) => ({
            name,
            label: description,
            description,
            parameters,
            executionMode: 'sequential',
            execute: async (toolCallId, args, signal) => {
                if (!session.turn) throw new Error('Agent turn is unavailable.');
                if (session.turn.toolRound >= this.maxToolRounds) {
                    throw new Error(`Canvas Agent exceeded the ${this.maxToolRounds}-round tool-call limit.`);
                }
                session.turn.toolRound += 1;
                const action = toAction(toolCallId, args);
                return new Promise((resolve, reject) => {
                    const abort = () => reject(new Error('Agent tool execution was aborted.'));
                    signal?.addEventListener('abort', abort, { once: true });
                    session.pending = {
                        toolCallId,
                        action,
                        resolve: result => {
                            signal?.removeEventListener('abort', abort);
                            resolve(result);
                        },
                        reject,
                    };
                    session.turn.status = 'awaiting_tool';
                    session.turn.action = action;
                    delete session.turn.approval;
                    this.notify(session);
                });
            },
        });

        return [
            externalTool(
                'get_canvas_snapshot',
                'Read the current canvas snapshot before referring to existing nodes.',
                Type.Object({}, { additionalProperties: false }),
                toolCallId => ({ type: 'get_snapshot', toolCallId }),
            ),
            externalTool(
                'add_canvas_node',
                'Add one editable image or video draft node. This never generates media.',
                Type.Object({
                    node_type: Type.String({ enum: ['image', 'video'] }),
                    prompt: Type.String({ minLength: 1, maxLength: 4000 }),
                    image_model: Type.Optional(Type.String({ enum: Object.keys(IMAGE_MODEL_SETTINGS) })),
                    aspect_ratio: Type.Optional(Type.String()),
                    quality: Type.Optional(Type.String({ enum: ['Auto', '1K', '2K', '4K'] })),
                    expected_snapshot_version: Type.Optional(SNAPSHOT_VERSION),
                }, { additionalProperties: false }),
                (toolCallId, args) => {
                    const action = {
                        type: 'add_node', nodeType: args.node_type, prompt: args.prompt, toolCallId,
                        ...(args.expected_snapshot_version ? { expectedSnapshotVersion: args.expected_snapshot_version } : {}),
                    };
                    if (args.node_type === 'image') {
                        const imageModel = args.image_model || 'gemini-pro';
                        const settings = IMAGE_MODEL_SETTINGS[imageModel];
                        const aspectRatio = args.aspect_ratio || 'Auto';
                        const resolution = args.quality || settings.defaultResolution;
                        if (!settings.aspectRatios.includes(aspectRatio) || !settings.resolutions.includes(resolution)) {
                            throw new Error(`${imageModel} does not support ${aspectRatio} at ${resolution}.`);
                        }
                        Object.assign(action, { imageModel, modelName: settings.name, aspectRatio, resolution });
                    }
                    return action;
                },
            ),
            externalTool(
                'update_canvas_node',
                'Update supported editable fields on one existing node.',
                Type.Object({
                    node_id: Type.String({ minLength: 1 }),
                    expected_snapshot_version: SNAPSHOT_VERSION,
                    patch: Type.Object({
                        title: Type.Optional(Type.String()), prompt: Type.Optional(Type.String()),
                        x: Type.Optional(Type.Number()), y: Type.Optional(Type.Number()),
                        model: Type.Optional(Type.String()), aspect_ratio: Type.Optional(Type.String()),
                        resolution: Type.Optional(Type.String()),
                    }, { additionalProperties: false, minProperties: 1 }),
                }, { additionalProperties: false }),
                (toolCallId, args) => ({
                    type: 'update_node', toolCallId, nodeId: args.node_id,
                    expectedSnapshotVersion: args.expected_snapshot_version,
                    updates: Object.fromEntries(Object.entries(args.patch).map(([key, value]) => [key === 'aspect_ratio' ? 'aspectRatio' : key, value])),
                }),
            ),
            externalTool(
                'delete_canvas_node',
                'Delete one explicitly identified existing node.',
                Type.Object({ node_id: Type.String({ minLength: 1 }), expected_snapshot_version: SNAPSHOT_VERSION }, { additionalProperties: false }),
                (toolCallId, args) => ({ type: 'delete_node', toolCallId, nodeId: args.node_id, expectedSnapshotVersion: args.expected_snapshot_version }),
            ),
            externalTool(
                'connect_canvas_nodes',
                'Connect one existing parent node to one existing child node.',
                Type.Object({ from_node_id: Type.String({ minLength: 1 }), to_node_id: Type.String({ minLength: 1 }), expected_snapshot_version: SNAPSHOT_VERSION }, { additionalProperties: false }),
                (toolCallId, args) => ({ type: 'connect_nodes', toolCallId, fromNodeId: args.from_node_id, toNodeId: args.to_node_id, expectedSnapshotVersion: args.expected_snapshot_version }),
            ),
            externalTool(
                'disconnect_canvas_nodes',
                'Disconnect one existing parent node from one existing child node.',
                Type.Object({ from_node_id: Type.String({ minLength: 1 }), to_node_id: Type.String({ minLength: 1 }), expected_snapshot_version: SNAPSHOT_VERSION }, { additionalProperties: false }),
                (toolCallId, args) => ({ type: 'disconnect_nodes', toolCallId, fromNodeId: args.from_node_id, toNodeId: args.to_node_id, expectedSnapshotVersion: args.expected_snapshot_version }),
            ),
            externalTool(
                'request_image_generation',
                'Request human approval before generating media for one existing image node.',
                Type.Object({ node_id: Type.String({ minLength: 1 }), expected_snapshot_version: SNAPSHOT_VERSION }, { additionalProperties: false }),
                (toolCallId, args) => ({ type: 'request_generation', generationType: 'image', toolCallId, nodeId: args.node_id, expectedSnapshotVersion: args.expected_snapshot_version }),
            ),
        ];
    }

    notify(session) {
        const waiters = session.waiters.splice(0);
        for (const resolve of waiters) resolve(publicTurn(session));
    }

    waitForBoundary(session) {
        if (session.turn.status !== 'running') return Promise.resolve(publicTurn(session));
        return new Promise(resolve => session.waiters.push(resolve));
    }

    async startTurn({ sessionId, message, history = [] }) {
        let session = this.sessions.get(sessionId);
        if (!session) session = this.createSession(sessionId, history);
        if (session.runPromise) throw new Error('This chat session already has an active Agent turn.');

        session.traceIds = [];
        session.modelTurns = 0;
        session.turn = {
            id: crypto.randomUUID(),
            sessionId,
            status: 'running',
            toolRound: 0,
            traceIds: [],
        };
        this.turns.set(session.turn.id, session);
        session.runPromise = session.agent.prompt(message)
            .then(() => {
                if (session.turn.status === 'running') {
                    const response = assistantText(session.agent.state.messages);
                    if (session.agent.state.errorMessage) {
                        session.turn.status = 'failed';
                        session.turn.error = session.agent.state.errorMessage;
                    } else {
                        session.turn.status = 'completed';
                        session.turn.response = response || '已完成画布操作。';
                    }
                    session.turn.traceIds = [...session.traceIds];
                    this.notify(session);
                }
            })
            .catch(error => {
                session.turn.status = 'failed';
                session.turn.error = error instanceof Error ? error.message : String(error);
                this.notify(session);
            })
            .finally(() => {
                session.runPromise = undefined;
                session.pending = undefined;
            });
        return this.waitForBoundary(session);
    }

    getSessionForTurn(turnId) {
        const session = this.turns.get(turnId);
        if (!session?.turn || session.turn.id !== turnId) {
            throw new Error('Agent turn is missing or has already been discarded.');
        }
        return session;
    }

    getTurn(turnId) {
        const session = this.turns.get(turnId);
        return session?.turn ? publicTurn(session) : undefined;
    }

    async completeTool(turnId, executions) {
        const session = this.getSessionForTurn(turnId);
        if (session.turn.status !== 'awaiting_tool' || !session.pending) {
            throw new Error('Agent turn is not waiting for a browser tool result.');
        }
        const execution = (Array.isArray(executions) ? executions : [])
            .find(candidate => candidate?.toolCallId === session.pending.toolCallId);
        if (!execution) throw new Error('The browser returned no result for the pending tool call.');

        if (execution.status === 'awaiting_approval') {
            if (session.pending.action.type !== 'request_generation' || !execution.proposal) {
                throw new Error('Only image generation may pause for approval.');
            }
            session.turn.status = 'awaiting_approval';
            session.turn.approval = execution.proposal;
            delete session.turn.action;
            return publicTurn(session);
        }

        const pending = session.pending;
        session.pending = undefined;
        session.turn.status = 'running';
        delete session.turn.action;
        delete session.turn.approval;
        const boundary = this.waitForBoundary(session);
        pending.resolve(executionResult(execution));
        return boundary;
    }

    async resolveApproval(turnId, decision) {
        const session = this.getSessionForTurn(turnId);
        if (session.turn.status !== 'awaiting_approval' || !session.pending || !session.turn.approval) {
            throw new Error('Agent turn is not waiting for approval.');
        }
        if (decision === 'approved') {
            session.turn.status = 'awaiting_tool';
            session.turn.action = { ...session.pending.action, approvalDecision: 'approved' };
            delete session.turn.approval;
            return publicTurn(session);
        }
        if (decision !== 'rejected') throw new Error('Approval decision must be approved or rejected.');

        const pending = session.pending;
        session.pending = undefined;
        session.turn.status = 'running';
        delete session.turn.action;
        delete session.turn.approval;
        const boundary = this.waitForBoundary(session);
        pending.resolve(executionResult({
            toolCallId: pending.toolCallId,
            status: 'failed',
            operation: 'request_generation',
            errorCode: 'user_rejected',
            error: 'User rejected the proposed image generation.',
        }));
        return boundary;
    }

    deleteSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        session.agent.abort();
        if (session.turn) this.turns.delete(session.turn.id);
        this.sessions.delete(sessionId);
    }
}
