import type { CanvasNode, CanvasProject, ImageNodePayload, VideoNodePayload } from './types.ts';
import {
    builtInNodeRegistry,
    IMAGE_ASPECT_RATIOS,
    IMAGE_QUALITIES,
    VIDEO_ASPECT_RATIOS,
    VIDEO_RESOLUTIONS,
} from './nodeRegistry.ts';
import { validateCanvasProject } from './projectValidation.ts';
import { assertRecord, CanvasValidationError } from './validation.ts';

export interface LegacyMigrationWarning {
    code: string;
    path: string;
    message: string;
}

export interface LegacyMigrationResult {
    project: CanvasProject;
    warnings: LegacyMigrationWarning[];
}

export interface LegacyMigrationOptions {
    fallbackProjectId?: string;
    now?: string;
}

function isAllowed<T extends string>(value: unknown, allowed: readonly T[]): value is T {
    return typeof value === 'string' && allowed.includes(value as T);
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function legacyPrompt(
    node: Record<string, unknown>,
    index: number,
    kind: 'image' | 'video',
    warnings: LegacyMigrationWarning[],
): string {
    // An empty string is a valid editable draft. Only synthesize a placeholder
    // when the legacy field is actually absent or not a string.
    if (typeof node.prompt === 'string') return node.prompt;
    warnings.push({
        code: 'missing_legacy_prompt',
        path: `nodes[${index}].prompt`,
        message: `Inserted a placeholder prompt for a legacy ${kind} node with no prompt.`,
    });
    return `Legacy ${kind} without prompt`;
}

function migratePayload(node: Record<string, unknown>, index: number, warnings: LegacyMigrationWarning[]) {
    const legacyType = node.type;
    if (legacyType === 'Text') return { type: 'text', payload: { text: typeof node.prompt === 'string' ? node.prompt : '' } };
    if (legacyType === 'Image') {
        const payload: ImageNodePayload = {
            prompt: legacyPrompt(node, index, 'image', warnings),
            modelId: optionalString(node.imageModel) || optionalString(node.model),
            referenceArtifactIds: [],
            legacyResultUrl: optionalString(node.resultUrl),
        };
        if (isAllowed(node.aspectRatio, IMAGE_ASPECT_RATIOS)) payload.aspectRatio = node.aspectRatio;
        else if (node.aspectRatio !== undefined) warnings.push({ code: 'unsupported_image_aspect_ratio', path: `nodes[${index}].aspectRatio`, message: `Ignored unsupported image aspect ratio: ${String(node.aspectRatio)}.` });
        if (isAllowed(node.resolution, IMAGE_QUALITIES)) payload.quality = node.resolution;
        else if (node.resolution !== undefined) warnings.push({ code: 'unsupported_image_quality', path: `nodes[${index}].resolution`, message: `Ignored unsupported image quality: ${String(node.resolution)}.` });
        return { type: 'image', payload };
    }
    if (legacyType === 'Video') {
        const payload: VideoNodePayload = {
            prompt: legacyPrompt(node, index, 'video', warnings),
            modelId: optionalString(node.videoModel) || optionalString(node.model),
            legacyResultUrl: optionalString(node.resultUrl),
            legacyLastFrameUrl: optionalString(node.lastFrame),
        };
        if (isAllowed(node.aspectRatio, VIDEO_ASPECT_RATIOS)) payload.aspectRatio = node.aspectRatio;
        else if (node.aspectRatio !== undefined) warnings.push({ code: 'unsupported_video_aspect_ratio', path: `nodes[${index}].aspectRatio`, message: `Ignored unsupported video aspect ratio: ${String(node.aspectRatio)}.` });
        if (isAllowed(node.resolution, VIDEO_RESOLUTIONS)) payload.resolution = node.resolution;
        else if (node.resolution !== undefined) warnings.push({ code: 'unsupported_video_resolution', path: `nodes[${index}].resolution`, message: `Ignored unsupported video resolution: ${String(node.resolution)}.` });
        if (typeof node.videoDuration === 'number' && node.videoDuration >= 1 && node.videoDuration <= 60) payload.durationSeconds = node.videoDuration;
        if (typeof node.generateAudio === 'boolean') payload.generateAudio = node.generateAudio;
        return { type: 'video', payload };
    }
    warnings.push({ code: 'legacy_placeholder', path: `nodes[${index}].type`, message: `Preserved unsupported node type as a read-only legacy node: ${String(legacyType)}.` });
    return {
        type: 'legacy',
        payload: {
            legacyType: typeof legacyType === 'string' ? legacyType : 'Unknown',
            data: structuredClone(node),
        },
    };
}

function migrateStatus(status: unknown): CanvasNode['status'] {
    if (status === 'loading') return 'running';
    if (status === 'success') return 'succeeded';
    if (status === 'error') return 'failed';
    return 'idle';
}

export function migrateLegacyWorkflow(input: unknown, options: LegacyMigrationOptions = {}): LegacyMigrationResult {
    assertRecord(input, 'workflow');
    if (!Array.isArray(input.nodes)) {
        throw new CanvasValidationError('invalid_type', 'workflow.nodes', 'workflow.nodes must be an array.');
    }
    const warnings: LegacyMigrationWarning[] = [];
    const now = options.now || new Date().toISOString();
    const nodes = input.nodes.map((rawNode, index): CanvasNode => {
        assertRecord(rawNode, `nodes[${index}]`);
        if (typeof rawNode.id !== 'string' || !rawNode.id) {
            throw new CanvasValidationError('missing_field', `nodes[${index}].id`, `nodes[${index}].id is required.`);
        }
        const migrated = migratePayload(rawNode, index, warnings);
        const definition = builtInNodeRegistry.get(migrated.type);
        return {
            id: rawNode.id,
            type: migrated.type,
            typeVersion: definition.version,
            title: optionalString(rawNode.title) || definition.title,
            position: {
                x: typeof rawNode.x === 'number' && Number.isFinite(rawNode.x) ? rawNode.x : 0,
                y: typeof rawNode.y === 'number' && Number.isFinite(rawNode.y) ? rawNode.y : 0,
            },
            size: definition.defaultSize,
            status: migrateStatus(rawNode.status),
            payload: migrated.payload,
            artifactIds: [],
            createdAt: optionalString(rawNode.createdAt) || now,
            updatedAt: optionalString(rawNode.updatedAt) || now,
        };
    });
    const nodeIds = new Set(nodes.map(node => node.id));
    const connections: CanvasProject['connections'] = [];
    const seen = new Set<string>();
    input.nodes.forEach((rawNode, childIndex) => {
        assertRecord(rawNode, `nodes[${childIndex}]`);
        if (!Array.isArray(rawNode.parentIds)) return;
        for (const [parentIndex, parentId] of rawNode.parentIds.entries()) {
            if (typeof parentId !== 'string' || !nodeIds.has(parentId)) {
                warnings.push({ code: 'missing_parent', path: `nodes[${childIndex}].parentIds[${parentIndex}]`, message: `Skipped missing parent node: ${String(parentId)}.` });
                continue;
            }
            const key = `${parentId}->${String(rawNode.id)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            connections.push({
                id: `legacy-connection-${connections.length + 1}`,
                from: { nodeId: parentId },
                to: { nodeId: String(rawNode.id) },
                kind: 'input',
                createdAt: now,
            });
        }
    });
    const viewport = typeof input.viewport === 'object' && input.viewport !== null && !Array.isArray(input.viewport)
        ? input.viewport as Record<string, unknown>
        : {};
    const project = validateCanvasProject({
        schemaVersion: 2,
        id: optionalString(input.id) || options.fallbackProjectId || 'migrated-project',
        title: optionalString(input.title) || 'Untitled',
        revision: 0,
        createdAt: optionalString(input.createdAt) || now,
        updatedAt: optionalString(input.updatedAt) || now,
        nodes,
        connections,
        viewport: {
            x: typeof viewport.x === 'number' ? viewport.x : 0,
            y: typeof viewport.y === 'number' ? viewport.y : 0,
            zoom: typeof viewport.zoom === 'number' && viewport.zoom > 0 ? viewport.zoom : 1,
        },
    });
    return { project, warnings };
}
