export type CanvasNodeStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';

export type BuiltInCanvasNodeType = 'text' | 'image' | 'video';

export interface Point {
    x: number;
    y: number;
}

export interface Size {
    width: number;
    height: number;
}

export interface Viewport extends Point {
    zoom: number;
}

export interface TextNodePayload {
    text: string;
}

export interface ImageNodePayload {
    prompt: string;
    modelId?: string;
    aspectRatio?: string;
    quality?: string;
    referenceArtifactIds: string[];
}

export interface VideoNodePayload {
    prompt: string;
    modelId?: string;
    aspectRatio?: string;
    resolution?: string;
    durationSeconds?: number;
    startFrameArtifactId?: string;
    endFrameArtifactId?: string;
    generateAudio?: boolean;
}

export interface BuiltInNodePayloadMap {
    text: TextNodePayload;
    image: ImageNodePayload;
    video: VideoNodePayload;
}

export interface CanvasNode<TPayload = unknown> {
    id: string;
    type: string;
    typeVersion: number;
    title: string;
    position: Point;
    size: Size;
    status: CanvasNodeStatus;
    locked?: boolean;
    payload: TPayload;
    artifactIds: string[];
    createdAt: string;
    updatedAt: string;
}

export type CanvasConnectionKind = 'reference' | 'sequence' | 'input';

export interface CanvasConnectionEndpoint {
    nodeId: string;
    port?: string;
}

export interface CanvasConnection {
    id: string;
    from: CanvasConnectionEndpoint;
    to: CanvasConnectionEndpoint;
    kind: CanvasConnectionKind;
    createdAt: string;
}

export interface CanvasProject {
    schemaVersion: 2;
    id: string;
    title: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNode[];
    connections: CanvasConnection[];
    viewport: Viewport;
}

export type NodeCapability = 'editable' | 'generatable' | 'connectable';

export interface NodeDefinition<TPayload = unknown> {
    type: string;
    version: number;
    title: string;
    defaultSize: Size;
    defaultPayload: () => TPayload;
    validatePayload: (input: unknown) => TPayload;
    capabilities: NodeCapability[];
}

export interface CanvasActor {
    type: 'user' | 'agent' | 'system';
    id?: string;
}

export type CanvasOperationType = 'node.add' | 'node.update';

export interface CanvasOperation<TPayload = unknown> {
    operationId: string;
    projectId: string;
    actor: CanvasActor;
    baseRevision: number;
    type: CanvasOperationType;
    payload: TPayload;
    createdAt: string;
}

export interface NodeAddOperationPayload {
    nodeId?: string;
    type: string;
    title?: string;
    position: Point;
    payload?: unknown;
}

export interface NodeUpdatePatch {
    title?: string;
    position?: Partial<Point>;
    payload?: Record<string, unknown>;
}

export interface NodeUpdateOperationPayload {
    nodeId: string;
    patch: NodeUpdatePatch;
}

export interface StructuredCanvasError {
    code: string;
    message: string;
    path?: string;
}

export interface CanvasOperationResult {
    operationId: string;
    status: 'succeeded' | 'rejected' | 'failed';
    projectRevision: number;
    affectedIds: string[];
    data?: Record<string, unknown>;
    error?: StructuredCanvasError;
}
