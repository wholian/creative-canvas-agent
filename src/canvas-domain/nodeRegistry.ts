import type {
    ImageNodePayload,
    LegacyNodePayload,
    NodeDefinition,
    TextNodePayload,
    VideoNodePayload,
} from './types.ts';
import {
    assertRecord,
    CanvasValidationError,
    readOptionalBoolean,
    readOptionalEnum,
    readOptionalNumber,
    readOptionalString,
    readRequiredString,
    readStringArray,
} from './validation.ts';

export const IMAGE_ASPECT_RATIOS = [
    'Auto', '1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9',
    '1024x1024', '1536x1024', '1024x1536',
] as const;
export const IMAGE_QUALITIES = ['Auto', '1K', '2K', '4K'] as const;
export const VIDEO_ASPECT_RATIOS = ['16:9', '9:16'] as const;
export const VIDEO_RESOLUTIONS = ['Auto', '512p', '720p', '768p', '1080p'] as const;

export class NodeRegistry {
    private readonly definitions = new Map<string, NodeDefinition>();

    register<TPayload>(definition: NodeDefinition<TPayload>): this {
        if (this.definitions.has(definition.type)) {
            throw new Error(`Node type "${definition.type}" is already registered.`);
        }
        this.definitions.set(definition.type, definition as NodeDefinition);
        return this;
    }

    has(type: string): boolean {
        return this.definitions.has(type);
    }

    get<TPayload = unknown>(type: string): NodeDefinition<TPayload> {
        const definition = this.definitions.get(type);
        if (!definition) {
            throw new CanvasValidationError('unknown_node_type', 'node.type', `Unknown canvas node type: ${type}.`);
        }
        return definition as NodeDefinition<TPayload>;
    }

    list(): NodeDefinition[] {
        return [...this.definitions.values()];
    }

    validatePayload<TPayload = unknown>(type: string, input: unknown): TPayload {
        return this.get<TPayload>(type).validatePayload(input);
    }
}

const textNodeDefinition: NodeDefinition<TextNodePayload> = {
    type: 'text',
    version: 1,
    title: 'Text',
    defaultSize: { width: 320, height: 180 },
    defaultPayload: () => ({ text: '' }),
    validatePayload(input): TextNodePayload {
        assertRecord(input, 'payload');
        const text = input.text;
        if (typeof text !== 'string') {
            throw new CanvasValidationError('missing_field', 'payload.text', 'payload.text must be a string.');
        }
        return { text };
    },
    capabilities: ['editable', 'connectable'],
};

const imageNodeDefinition: NodeDefinition<ImageNodePayload> = {
    type: 'image',
    version: 1,
    title: 'Image Draft',
    defaultSize: { width: 340, height: 340 },
    defaultPayload: () => ({ prompt: '', referenceArtifactIds: [] }),
    validatePayload(input): ImageNodePayload {
        assertRecord(input, 'payload');
        return {
            prompt: readRequiredString(input, 'prompt', 'payload'),
            modelId: readOptionalString(input, 'modelId', 'payload'),
            aspectRatio: readOptionalEnum(input, 'aspectRatio', IMAGE_ASPECT_RATIOS, 'payload'),
            quality: readOptionalEnum(input, 'quality', IMAGE_QUALITIES, 'payload'),
            referenceArtifactIds: readStringArray(input, 'referenceArtifactIds', 'payload'),
            legacyResultUrl: readOptionalString(input, 'legacyResultUrl', 'payload'),
        };
    },
    capabilities: ['editable', 'generatable', 'connectable'],
};

const videoNodeDefinition: NodeDefinition<VideoNodePayload> = {
    type: 'video',
    version: 1,
    title: 'Video Draft',
    defaultSize: { width: 420, height: 260 },
    defaultPayload: () => ({ prompt: '' }),
    validatePayload(input): VideoNodePayload {
        assertRecord(input, 'payload');
        return {
            prompt: readRequiredString(input, 'prompt', 'payload'),
            modelId: readOptionalString(input, 'modelId', 'payload'),
            aspectRatio: readOptionalEnum(input, 'aspectRatio', VIDEO_ASPECT_RATIOS, 'payload'),
            resolution: readOptionalEnum(input, 'resolution', VIDEO_RESOLUTIONS, 'payload'),
            durationSeconds: readOptionalNumber(input, 'durationSeconds', 'payload', { min: 1, max: 60 }),
            startFrameArtifactId: readOptionalString(input, 'startFrameArtifactId', 'payload'),
            endFrameArtifactId: readOptionalString(input, 'endFrameArtifactId', 'payload'),
            generateAudio: readOptionalBoolean(input, 'generateAudio', 'payload'),
            legacyResultUrl: readOptionalString(input, 'legacyResultUrl', 'payload'),
            legacyLastFrameUrl: readOptionalString(input, 'legacyLastFrameUrl', 'payload'),
        };
    },
    capabilities: ['editable', 'generatable', 'connectable'],
};

const legacyNodeDefinition: NodeDefinition<LegacyNodePayload> = {
    type: 'legacy',
    version: 1,
    title: 'Legacy Node',
    defaultSize: { width: 340, height: 240 },
    defaultPayload: () => ({ legacyType: 'Unknown', data: {} }),
    validatePayload(input): LegacyNodePayload {
        assertRecord(input, 'payload');
        const legacyType = readRequiredString(input, 'legacyType', 'payload');
        assertRecord(input.data, 'payload.data');
        return { legacyType, data: structuredClone(input.data) };
    },
    capabilities: ['connectable'],
};

export function createBuiltInNodeRegistry(): NodeRegistry {
    return new NodeRegistry()
        .register(textNodeDefinition)
        .register(imageNodeDefinition)
        .register(videoNodeDefinition)
        .register(legacyNodeDefinition);
}

export const builtInNodeRegistry = createBuiltInNodeRegistry();
