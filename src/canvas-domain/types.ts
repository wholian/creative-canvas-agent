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
