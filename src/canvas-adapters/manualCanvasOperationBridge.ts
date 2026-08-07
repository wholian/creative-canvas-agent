import type { NodeData, NodeType, Viewport } from '../types.ts';
import {
    CanvasOperationRunner,
    InMemoryCanvasProjectStore,
    type CanvasNode,
    type CanvasOperation,
    type CanvasOperationResult,
    type NodeUpdatePatch,
} from '../canvas-domain/index.ts';
import { adaptLegacyReactCanvas } from './legacyReactCanvasAdapter.ts';

export type ManualCanvasNodeType = NodeType.TEXT | NodeType.IMAGE | NodeType.VIDEO;

export interface ManualCanvasOperationFailure {
    code: string;
    message: string;
    path?: string;
}

export interface ManualNodeAddInput {
    nodes: NodeData[];
    viewport: Viewport;
    title: string;
    nodeType: ManualCanvasNodeType;
    position: { x: number; y: number };
    nodeId?: string;
    operationId?: string;
    now?: string;
}

export interface ManualNodeAddResult {
    status: 'succeeded' | 'failed';
    node?: NodeData;
    projectRevision: number;
    error?: ManualCanvasOperationFailure;
}

export interface ManualNodeUpdateInput {
    nodes: NodeData[];
    viewport: Viewport;
    title: string;
    nodeId: string;
    updates: Partial<NodeData>;
    operationId?: string;
    now?: string;
}

export interface ManualNodeUpdateResult {
    status: 'succeeded' | 'failed';
    node?: NodeData;
    projectRevision: number;
    error?: ManualCanvasOperationFailure;
}

function domainType(nodeType: ManualCanvasNodeType): 'text' | 'image' | 'video' {
    if (nodeType === 'Text') return 'text';
    if (nodeType === 'Image') return 'image';
    return 'video';
}

function defaultDomainPayload(nodeType: ManualCanvasNodeType): Record<string, unknown> {
    if (nodeType === 'Text') return { text: '' };
    if (nodeType === 'Image') {
        return {
            prompt: '',
            modelId: 'gemini-pro',
            aspectRatio: 'Auto',
            quality: 'Auto',
            referenceArtifactIds: [],
        };
    }
    return {
        prompt: '',
        modelId: 'veo-3.1',
        aspectRatio: '16:9',
        resolution: 'Auto',
    };
}

function legacyType(type: string): NodeData['type'] {
    if (type === 'text') return 'Text' as NodeData['type'];
    if (type === 'image') return 'Image' as NodeData['type'];
    return 'Video' as NodeData['type'];
}

export function mergeDomainNodeIntoLegacy(node: CanvasNode, previous?: NodeData): NodeData {
    const payload = node.payload as Record<string, unknown>;
    const type = legacyType(node.type);
    const base: NodeData = previous ? { ...previous } : {
        id: node.id,
        type,
        x: node.position.x,
        y: node.position.y,
        prompt: '',
        status: 'idle' as NodeData['status'],
        model: 'Banana Pro',
        aspectRatio: 'Auto',
        resolution: 'Auto',
        parentIds: [],
    };

    base.id = node.id;
    base.type = type;
    base.title = node.title;
    base.x = node.position.x;
    base.y = node.position.y;

    if (node.type === 'text') {
        base.prompt = String(payload.text ?? '');
    } else if (node.type === 'image') {
        base.prompt = String(payload.prompt ?? '');
        base.imageModel = typeof payload.modelId === 'string' ? payload.modelId : base.imageModel;
        base.aspectRatio = typeof payload.aspectRatio === 'string' ? payload.aspectRatio : 'Auto';
        base.resolution = typeof payload.quality === 'string' ? payload.quality : 'Auto';
    } else {
        base.prompt = String(payload.prompt ?? '');
        base.videoModel = typeof payload.modelId === 'string' ? payload.modelId : base.videoModel;
        base.aspectRatio = typeof payload.aspectRatio === 'string' ? payload.aspectRatio : '16:9';
        base.resolution = typeof payload.resolution === 'string' ? payload.resolution : 'Auto';
        if (typeof payload.durationSeconds === 'number') base.videoDuration = payload.durationSeconds;
        if (typeof payload.generateAudio === 'boolean') base.generateAudio = payload.generateAudio;
    }
    return base;
}

function operationFailure(result: CanvasOperationResult): ManualCanvasOperationFailure {
    return {
        code: result.error?.code || 'operation_failed',
        message: result.error?.message || 'Canvas operation failed.',
        ...(result.error?.path ? { path: result.error.path } : {}),
    };
}

function createRunner(nodes: NodeData[], viewport: Viewport, title: string, now: string) {
    const projectId = `manual-ui-${crypto.randomUUID()}`;
    const migrated = adaptLegacyReactCanvas({ id: projectId, title, nodes, viewport }, now);
    const store = new InMemoryCanvasProjectStore([migrated.project]);
    return {
        projectId,
        runner: new CanvasOperationRunner({ store, now: () => now }),
    };
}

function buildDomainUpdatePatch(node: NodeData, updates: Partial<NodeData>): NodeUpdatePatch {
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
        if (updates.imageModel !== undefined) payload.modelId = updates.imageModel;
        if (updates.aspectRatio !== undefined) payload.aspectRatio = updates.aspectRatio;
        if (updates.resolution !== undefined) payload.quality = updates.resolution;
    } else if (node.type === 'Video') {
        if (updates.prompt !== undefined) payload.prompt = updates.prompt;
        if (updates.videoModel !== undefined) payload.modelId = updates.videoModel;
        if (updates.aspectRatio !== undefined) payload.aspectRatio = updates.aspectRatio;
        if (updates.resolution !== undefined) payload.resolution = updates.resolution;
        if (updates.videoDuration !== undefined) payload.durationSeconds = updates.videoDuration;
        if (updates.generateAudio !== undefined) payload.generateAudio = updates.generateAudio;
    }
    if (Object.keys(payload).length > 0) patch.payload = payload;
    return patch;
}

export async function applyManualNodeAdd({
    nodes,
    viewport,
    title,
    nodeType,
    position,
    nodeId = crypto.randomUUID(),
    operationId = crypto.randomUUID(),
    now = new Date().toISOString(),
}: ManualNodeAddInput): Promise<ManualNodeAddResult> {
    const { projectId, runner } = createRunner(nodes, viewport, title, now);
    const operation: CanvasOperation = {
        operationId,
        projectId,
        actor: { type: 'user', id: 'canvas-ui' },
        baseRevision: 0,
        type: 'node.add',
        payload: {
            nodeId,
            type: domainType(nodeType),
            position,
            payload: defaultDomainPayload(nodeType),
        },
        createdAt: now,
    };
    const result = await runner.execute(operation);
    if (result.status !== 'succeeded') {
        return { status: 'failed', projectRevision: result.projectRevision, error: operationFailure(result) };
    }
    const domainNode = result.data?.node as CanvasNode | undefined;
    if (!domainNode) {
        return {
            status: 'failed',
            projectRevision: result.projectRevision,
            error: { code: 'missing_operation_result', message: 'Canvas operation returned no node.' },
        };
    }
    return {
        status: 'succeeded',
        projectRevision: result.projectRevision,
        node: mergeDomainNodeIntoLegacy(domainNode),
    };
}

export async function applyManualNodeUpdate({
    nodes,
    viewport,
    title,
    nodeId,
    updates,
    operationId = crypto.randomUUID(),
    now = new Date().toISOString(),
}: ManualNodeUpdateInput): Promise<ManualNodeUpdateResult> {
    const previous = nodes.find(node => node.id === nodeId);
    if (!previous) {
        return {
            status: 'failed',
            projectRevision: 0,
            error: { code: 'unknown_node', message: `Canvas node not found: ${nodeId}.` },
        };
    }
    const { projectId, runner } = createRunner(nodes, viewport, title, now);
    const operation: CanvasOperation = {
        operationId,
        projectId,
        actor: { type: 'user', id: 'canvas-ui' },
        baseRevision: 0,
        type: 'node.update',
        payload: { nodeId, patch: buildDomainUpdatePatch(previous, updates) },
        createdAt: now,
    };
    const result = await runner.execute(operation);
    if (result.status !== 'succeeded') {
        return { status: 'failed', projectRevision: result.projectRevision, error: operationFailure(result) };
    }
    const domainNode = result.data?.node as CanvasNode | undefined;
    if (!domainNode) {
        return {
            status: 'failed',
            projectRevision: result.projectRevision,
            error: { code: 'missing_operation_result', message: 'Canvas operation returned no node.' },
        };
    }
    return {
        status: 'succeeded',
        projectRevision: result.projectRevision,
        node: mergeDomainNodeIntoLegacy(domainNode, previous),
    };
}
