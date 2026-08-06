import type { NodeData, Viewport } from '../types.ts';
import {
    CanvasOperationRunner,
    InMemoryCanvasProjectStore,
    type CanvasNode,
    type CanvasOperation,
} from '../canvas-domain/index.ts';
import { adaptLegacyReactCanvas } from './legacyReactCanvasAdapter.ts';

export interface AgentDraftAction {
    type: 'add_node';
    nodeType: 'image' | 'video';
    prompt: string;
    toolCallId: string;
    imageModel?: string;
    modelName?: string;
    aspectRatio?: string;
    resolution?: string;
}

export interface AgentDraftExecution {
    toolCallId: string;
    status: 'succeeded' | 'failed';
    nodeId?: string;
    error?: string;
}

export interface ApplyAgentDraftActionsInput {
    actions: AgentDraftAction[];
    nodes: NodeData[];
    viewport: Viewport;
    title: string;
    canvasSize: { width: number; height: number };
    now?: string;
}

export interface ApplyAgentDraftActionsResult {
    executions: AgentDraftExecution[];
    addedNodes: NodeData[];
}

function toLegacyNode(node: CanvasNode): NodeData {
    const payload = node.payload as Record<string, unknown>;
    const isImage = node.type === 'image';
    return {
        id: node.id,
        type: (isImage ? 'Image' : 'Video') as NodeData['type'],
        title: node.title,
        x: node.position.x,
        y: node.position.y,
        prompt: String(payload.prompt || ''),
        status: 'idle' as NodeData['status'],
        model: String(payload.modelId || (isImage ? 'Nano Banana Pro' : 'Veo 3.1')),
        ...(isImage ? { imageModel: String(payload.modelId || 'gemini-pro') } : { videoModel: String(payload.modelId || 'veo-3.1') }),
        aspectRatio: String(payload.aspectRatio || (isImage ? 'Auto' : '16:9')),
        resolution: String((isImage ? payload.quality : payload.resolution) || (isImage ? '1K' : 'Auto')),
        parentIds: [],
    };
}

export async function applyAgentDraftActions({
    actions,
    nodes,
    viewport,
    title,
    canvasSize,
    now = new Date().toISOString(),
}: ApplyAgentDraftActionsInput): Promise<ApplyAgentDraftActionsResult> {
    const projectId = `agent-bridge-${crypto.randomUUID()}`;
    const migrated = adaptLegacyReactCanvas({ id: projectId, title, nodes, viewport }, now);
    const store = new InMemoryCanvasProjectStore([migrated.project]);
    const runner = new CanvasOperationRunner({ store, now: () => now });
    const operations: CanvasOperation[] = actions.map((action, index) => {
        const isImage = action.nodeType === 'image';
        const offset = ((nodes.length + index) % 5) * 36;
        return {
            operationId: action.toolCallId,
            projectId,
            actor: { type: 'agent', id: 'chat-agent' },
            baseRevision: index,
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
                        modelId: action.imageModel,
                        aspectRatio: action.aspectRatio || 'Auto',
                        quality: action.resolution || '1K',
                        referenceArtifactIds: [],
                    }
                    : {
                        prompt: action.prompt,
                        modelId: action.modelName,
                        aspectRatio: '16:9',
                        resolution: 'Auto',
                    },
            },
            createdAt: now,
        };
    });
    const results = await runner.executeBatch(operations, { atomic: false });
    const addedNodes: NodeData[] = [];
    const executions = results.map((result, index): AgentDraftExecution => {
        if (result.status !== 'succeeded') {
            return {
                toolCallId: actions[index].toolCallId,
                status: 'failed',
                error: result.error?.message || 'Canvas operation failed.',
            };
        }
        const node = result.data?.node as CanvasNode | undefined;
        if (!node) {
            return { toolCallId: actions[index].toolCallId, status: 'failed', error: 'Canvas operation returned no node.' };
        }
        addedNodes.push(toLegacyNode(node));
        return { toolCallId: actions[index].toolCallId, status: 'succeeded', nodeId: node.id };
    });
    return { executions, addedNodes };
}
