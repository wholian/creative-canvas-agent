import type { NodeData, Viewport } from '../types.ts';
import {
    CanvasOperationRunner,
    InMemoryCanvasProjectStore,
    type CanvasNode,
    type CanvasOperation,
    type NodeUpdatePatch,
} from '../canvas-domain/index.ts';
import { adaptLegacyReactCanvas } from './legacyReactCanvasAdapter.ts';
import { projectCanvasIntoLegacy } from './manualCanvasOperationBridge.ts';

export interface AgentSnapshotAction {
    type: 'get_snapshot';
    toolCallId: string;
}

export interface AgentAddNodeAction {
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

export interface AgentNodeUpdates {
    title?: string;
    prompt?: string;
    x?: number;
    y?: number;
    model?: string;
    aspectRatio?: string;
    resolution?: string;
}

export interface AgentUpdateNodeAction {
    type: 'update_node';
    toolCallId: string;
    nodeId: string;
    expectedSnapshotVersion: string;
    updates: AgentNodeUpdates;
}

export interface AgentDeleteNodeAction {
    type: 'delete_node';
    toolCallId: string;
    nodeId: string;
    expectedSnapshotVersion: string;
}

export interface AgentConnectionAction {
    type: 'connect_nodes' | 'disconnect_nodes';
    toolCallId: string;
    fromNodeId: string;
    toNodeId: string;
    expectedSnapshotVersion: string;
}

export type AgentCanvasAction =
    | AgentSnapshotAction
    | AgentAddNodeAction
    | AgentUpdateNodeAction
    | AgentDeleteNodeAction
    | AgentConnectionAction;

export interface AgentCanvasSnapshotNode {
    id: string;
    type: string;
    title: string;
    prompt: string;
    position: { x: number; y: number };
    status: string;
    model: string;
    aspectRatio: string;
    resolution: string;
}

export interface AgentCanvasSnapshot {
    snapshotVersion: string;
    title: string;
    nodes: AgentCanvasSnapshotNode[];
    connections: Array<{
        fromNodeId: string;
        toNodeId: string;
        kind: 'input';
    }>;
}

export interface AgentCanvasExecution {
    toolCallId: string;
    status: 'succeeded' | 'failed';
    operation: 'snapshot' | 'add' | 'update' | 'delete' | 'connect' | 'disconnect';
    snapshotVersion?: string;
    snapshot?: AgentCanvasSnapshot;
    nodeId?: string;
    connectionId?: string;
    deletedConnectionIds?: string[];
    errorCode?: string;
    error?: string;
}

export interface ApplyAgentCanvasActionsInput {
    actions: AgentCanvasAction[];
    nodes: NodeData[];
    viewport: Viewport;
    title: string;
    canvasSize: { width: number; height: number };
    now?: string;
}

export interface ApplyAgentCanvasActionsResult {
    executions: AgentCanvasExecution[];
    nodes: NodeData[];
    changed: boolean;
    snapshotVersion: string;
}

function operationName(action: AgentCanvasAction): AgentCanvasExecution['operation'] {
    if (action.type === 'get_snapshot') return 'snapshot';
    if (action.type === 'add_node') return 'add';
    if (action.type === 'update_node') return 'update';
    if (action.type === 'delete_node') return 'delete';
    if (action.type === 'connect_nodes') return 'connect';
    return 'disconnect';
}

function stableHash(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function snapshotModel(node: NodeData): string {
    if (node.type === 'Image') return node.imageModel || node.model || '';
    if (node.type === 'Video') return node.videoModel || node.model || '';
    return node.model || '';
}

export function createAgentCanvasSnapshot(nodes: NodeData[], title: string): AgentCanvasSnapshot {
    const snapshotNodes = nodes.map(node => ({
        id: node.id,
        type: String(node.type).toLowerCase(),
        title: node.title || String(node.type),
        prompt: node.prompt || '',
        position: { x: node.x, y: node.y },
        status: String(node.status),
        model: snapshotModel(node),
        aspectRatio: node.aspectRatio || '',
        resolution: node.resolution || '',
    })).sort((left, right) => left.id.localeCompare(right.id));
    const connections = nodes.flatMap(node => (node.parentIds || []).map(parentId => ({
        fromNodeId: parentId,
        toNodeId: node.id,
        kind: 'input' as const,
    }))).sort((left, right) => `${left.fromNodeId}:${left.toNodeId}`.localeCompare(`${right.fromNodeId}:${right.toNodeId}`));
    const visibleState = { title, nodes: snapshotNodes, connections };
    return {
        snapshotVersion: `canvas-v1-${stableHash(JSON.stringify(visibleState))}`,
        ...visibleState,
    };
}

function updatePatch(node: NodeData, updates: AgentNodeUpdates): NodeUpdatePatch {
    const patch: NodeUpdatePatch = {};
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.x !== undefined || updates.y !== undefined) {
        patch.position = {
            ...(updates.x !== undefined ? { x: updates.x } : {}),
            ...(updates.y !== undefined ? { y: updates.y } : {}),
        };
    }
    const payload: Record<string, unknown> = {};
    if (node.type === 'Text') {
        if (updates.prompt !== undefined) payload.text = updates.prompt;
    } else if (node.type === 'Image') {
        if (updates.prompt !== undefined) payload.prompt = updates.prompt;
        if (updates.model !== undefined) payload.modelId = updates.model;
        if (updates.aspectRatio !== undefined) payload.aspectRatio = updates.aspectRatio;
        if (updates.resolution !== undefined) payload.quality = updates.resolution;
    } else if (node.type === 'Video') {
        if (updates.prompt !== undefined) payload.prompt = updates.prompt;
        if (updates.model !== undefined) payload.modelId = updates.model;
        if (updates.aspectRatio !== undefined) payload.aspectRatio = updates.aspectRatio;
        if (updates.resolution !== undefined) payload.resolution = updates.resolution;
    } else if (updates.prompt !== undefined || updates.model !== undefined || updates.aspectRatio !== undefined || updates.resolution !== undefined) {
        throw new Error(`Node type ${node.type} does not support Agent payload updates.`);
    }
    if (Object.keys(payload).length > 0) patch.payload = payload;
    if (Object.keys(patch).length === 0) throw new Error('update_canvas_node requires at least one supported patch field.');
    return patch;
}

function failedExecutions(
    actions: AgentCanvasAction[],
    code: string,
    message: string,
    snapshotVersion: string,
    snapshot?: AgentCanvasSnapshot,
): AgentCanvasExecution[] {
    return actions.map(action => ({
        toolCallId: action.toolCallId,
        status: 'failed',
        operation: operationName(action),
        snapshotVersion,
        ...(snapshot ? { snapshot } : {}),
        errorCode: code,
        error: message,
    }));
}

export async function applyAgentCanvasActions({
    actions,
    nodes,
    viewport,
    title,
    canvasSize,
    now = new Date().toISOString(),
}: ApplyAgentCanvasActionsInput): Promise<ApplyAgentCanvasActionsResult> {
    const beforeSnapshot = createAgentCanvasSnapshot(nodes, title);
    if (actions.length === 0) {
        return { executions: [], nodes: structuredClone(nodes), changed: false, snapshotVersion: beforeSnapshot.snapshotVersion };
    }

    const snapshotActions = actions.filter(action => action.type === 'get_snapshot');
    if (snapshotActions.length > 0) {
        if (snapshotActions.length !== actions.length) {
            return {
                executions: failedExecutions(actions, 'mixed_read_write_batch', 'Snapshot reads and canvas writes must use separate tool rounds.', beforeSnapshot.snapshotVersion),
                nodes: structuredClone(nodes),
                changed: false,
                snapshotVersion: beforeSnapshot.snapshotVersion,
            };
        }
        return {
            executions: actions.map(action => ({
                toolCallId: action.toolCallId,
                status: 'succeeded',
                operation: 'snapshot',
                snapshotVersion: beforeSnapshot.snapshotVersion,
                snapshot: beforeSnapshot,
            })),
            nodes: structuredClone(nodes),
            changed: false,
            snapshotVersion: beforeSnapshot.snapshotVersion,
        };
    }

    const writeActions = actions.filter((action): action is Exclude<AgentCanvasAction, AgentSnapshotAction> => action.type !== 'get_snapshot');
    const stale = writeActions.find(action => action.type !== 'add_node'
        && action.expectedSnapshotVersion !== beforeSnapshot.snapshotVersion);
    const staleAdd = writeActions.find(action => action.type === 'add_node'
        && action.expectedSnapshotVersion !== undefined
        && action.expectedSnapshotVersion !== beforeSnapshot.snapshotVersion);
    if (stale || staleAdd) {
        return {
            executions: failedExecutions(
                actions,
                'stale_canvas_snapshot',
                'Canvas changed after the Agent read it. Re-check the current snapshot returned with this result and retry once if the target is still unambiguous.',
                beforeSnapshot.snapshotVersion,
                beforeSnapshot,
            ),
            nodes: structuredClone(nodes),
            changed: false,
            snapshotVersion: beforeSnapshot.snapshotVersion,
        };
    }

    const projectId = `agent-bridge-${crypto.randomUUID()}`;
    const migrated = adaptLegacyReactCanvas({ id: projectId, title, nodes, viewport }, now);
    const store = new InMemoryCanvasProjectStore([migrated.project]);
    const runner = new CanvasOperationRunner({ store, now: () => now });

    let operations: CanvasOperation[];
    try {
        operations = writeActions.map((action, index): CanvasOperation => {
            const common = {
                operationId: action.toolCallId,
                projectId,
                actor: { type: 'agent' as const, id: 'chat-agent' },
                baseRevision: index,
                createdAt: now,
            };
            if (action.type === 'add_node') {
                const isImage = action.nodeType === 'image';
                const offset = ((nodes.length + index) % 5) * 36;
                return {
                    ...common,
                    type: 'node.add',
                    payload: {
                        type: action.nodeType,
                        title: isImage ? 'AI Image Draft' : 'AI Video Draft',
                        position: {
                            x: (canvasSize.width / 2 - viewport.x) / viewport.zoom - 170 + offset,
                            y: (canvasSize.height / 2 - viewport.y) / viewport.zoom - 130 + offset,
                        },
                        payload: isImage
                            ? {
                                prompt: action.prompt,
                                modelId: action.imageModel || 'gemini-pro',
                                aspectRatio: action.aspectRatio || 'Auto',
                                quality: action.resolution || '1K',
                                referenceArtifactIds: [],
                            }
                            : {
                                prompt: action.prompt,
                                modelId: action.modelName || 'veo-3.1',
                                aspectRatio: action.aspectRatio || '16:9',
                                resolution: action.resolution || 'Auto',
                            },
                    },
                };
            }
            if (action.type === 'update_node') {
                const node = nodes.find(candidate => candidate.id === action.nodeId);
                if (!node) throw new Error(`Canvas node not found: ${action.nodeId}.`);
                return { ...common, type: 'node.update', payload: { nodeId: action.nodeId, patch: updatePatch(node, action.updates) } };
            }
            if (action.type === 'delete_node') {
                return { ...common, type: 'node.delete', payload: { nodeId: action.nodeId } };
            }
            if (action.type === 'connect_nodes') {
                return {
                    ...common,
                    type: 'connection.add',
                    payload: {
                        connectionId: `connection-${crypto.randomUUID()}`,
                        from: { nodeId: action.fromNodeId },
                        to: { nodeId: action.toNodeId },
                        kind: 'input',
                    },
                };
            }
            if (action.type !== 'disconnect_nodes') {
                throw new Error(`Unsupported canvas action: ${action.type}.`);
            }
            const connection = migrated.project.connections.find(candidate =>
                candidate.kind === 'input'
                && candidate.from.nodeId === action.fromNodeId
                && candidate.to.nodeId === action.toNodeId,
            );
            if (!connection) throw new Error(`Canvas connection not found: ${action.fromNodeId} -> ${action.toNodeId}.`);
            return { ...common, type: 'connection.delete', payload: { connectionId: connection.id } };
        });
    } catch (error) {
        return {
            executions: failedExecutions(actions, 'invalid_canvas_action', error instanceof Error ? error.message : 'Invalid canvas action.', beforeSnapshot.snapshotVersion),
            nodes: structuredClone(nodes),
            changed: false,
            snapshotVersion: beforeSnapshot.snapshotVersion,
        };
    }

    const results = await runner.executeBatch(operations, { atomic: true });
    const failure = results.find(result => result.status !== 'succeeded');
    if (failure) {
        return {
            executions: actions.map((action, index) => ({
                toolCallId: action.toolCallId,
                status: 'failed',
                operation: operationName(action),
                snapshotVersion: beforeSnapshot.snapshotVersion,
                errorCode: results[index]?.error?.code || failure.error?.code || 'canvas_operation_failed',
                error: results[index]?.error?.message || failure.error?.message || 'Canvas operation failed.',
            })),
            nodes: structuredClone(nodes),
            changed: false,
            snapshotVersion: beforeSnapshot.snapshotVersion,
        };
    }

    const project = await runner.getSnapshot(projectId);
    const nextNodes = projectCanvasIntoLegacy(project, nodes);
    const afterSnapshot = createAgentCanvasSnapshot(nextNodes, title);
    return {
        executions: actions.map((action, index) => {
            const data = results[index]?.data || {};
            return {
                toolCallId: action.toolCallId,
                status: 'succeeded',
                operation: operationName(action),
                snapshotVersion: afterSnapshot.snapshotVersion,
                ...(typeof data.nodeId === 'string' ? { nodeId: data.nodeId } : {}),
                ...(typeof data.connectionId === 'string' ? { connectionId: data.connectionId } : {}),
                ...(Array.isArray(data.deletedConnectionIds) ? { deletedConnectionIds: data.deletedConnectionIds as string[] } : {}),
            };
        }),
        nodes: nextNodes,
        changed: true,
        snapshotVersion: afterSnapshot.snapshotVersion,
    };
}

// Compatibility export for existing callers and tests while the UI switches
// from the add-only bridge to the general Canvas Action bridge.
export type AgentDraftAction = AgentAddNodeAction;
export type AgentDraftExecution = AgentCanvasExecution;
export type ApplyAgentDraftActionsInput = ApplyAgentCanvasActionsInput;

export async function applyAgentDraftActions(input: ApplyAgentDraftActionsInput): Promise<{
    executions: AgentCanvasExecution[];
    addedNodes: NodeData[];
}> {
    const result = await applyAgentCanvasActions(input);
    const previousIds = new Set(input.nodes.map(node => node.id));
    return {
        executions: result.executions,
        addedNodes: result.nodes.filter(node => !previousIds.has(node.id)),
    };
}
