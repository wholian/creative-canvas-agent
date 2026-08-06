import type { CanvasConnection, CanvasNode, CanvasProject } from './types.ts';
import { NodeRegistry, builtInNodeRegistry } from './nodeRegistry.ts';
import { assertRecord, CanvasValidationError } from './validation.ts';

const NODE_STATUSES = ['idle', 'queued', 'running', 'succeeded', 'failed'] as const;
const CONNECTION_KINDS = ['reference', 'sequence', 'input'] as const;

function assertFiniteNumber(value: unknown, path: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new CanvasValidationError('invalid_type', path, `${path} must be a finite number.`);
    }
}

function assertPositiveNumber(value: unknown, path: string): asserts value is number {
    assertFiniteNumber(value, path);
    if (value <= 0) {
        throw new CanvasValidationError('invalid_value', path, `${path} must be greater than zero.`);
    }
}

function assertString(value: unknown, path: string): asserts value is string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new CanvasValidationError('missing_field', path, `${path} must be a non-empty string.`);
    }
}

function assertIsoDate(value: unknown, path: string): asserts value is string {
    assertString(value, path);
    if (Number.isNaN(Date.parse(value))) {
        throw new CanvasValidationError('invalid_value', path, `${path} must be an ISO date string.`);
    }
}

export function validateCanvasNode(input: unknown, registry: NodeRegistry = builtInNodeRegistry): CanvasNode {
    assertRecord(input, 'node');
    assertString(input.id, 'node.id');
    assertString(input.type, 'node.type');
    assertPositiveNumber(input.typeVersion, 'node.typeVersion');
    assertString(input.title, 'node.title');
    assertRecord(input.position, 'node.position');
    assertFiniteNumber(input.position.x, 'node.position.x');
    assertFiniteNumber(input.position.y, 'node.position.y');
    assertRecord(input.size, 'node.size');
    assertPositiveNumber(input.size.width, 'node.size.width');
    assertPositiveNumber(input.size.height, 'node.size.height');
    if (typeof input.status !== 'string' || !NODE_STATUSES.includes(input.status as typeof NODE_STATUSES[number])) {
        throw new CanvasValidationError('invalid_value', 'node.status', `node.status must be one of: ${NODE_STATUSES.join(', ')}.`);
    }
    const locked = input.locked;
    let normalizedLocked: boolean | undefined;
    if (locked !== undefined && typeof locked !== 'boolean') {
        throw new CanvasValidationError('invalid_type', 'node.locked', 'node.locked must be a boolean when provided.');
    }
    if (typeof locked === 'boolean') normalizedLocked = locked;
    if (!Array.isArray(input.artifactIds) || input.artifactIds.some(id => typeof id !== 'string' || id.length === 0)) {
        throw new CanvasValidationError('invalid_type', 'node.artifactIds', 'node.artifactIds must be an array of non-empty strings.');
    }
    assertIsoDate(input.createdAt, 'node.createdAt');
    assertIsoDate(input.updatedAt, 'node.updatedAt');

    const payload = registry.validatePayload(input.type, input.payload);
    return {
        id: input.id,
        type: input.type,
        typeVersion: input.typeVersion,
        title: input.title,
        position: { x: input.position.x, y: input.position.y },
        size: { width: input.size.width, height: input.size.height },
        status: input.status as CanvasNode['status'],
        ...(normalizedLocked === undefined ? {} : { locked: normalizedLocked }),
        payload,
        artifactIds: [...input.artifactIds],
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
    };
}

function validateConnection(input: unknown, nodeIds: Set<string>): CanvasConnection {
    assertRecord(input, 'connection');
    assertString(input.id, 'connection.id');
    assertRecord(input.from, 'connection.from');
    assertRecord(input.to, 'connection.to');
    assertString(input.from.nodeId, 'connection.from.nodeId');
    assertString(input.to.nodeId, 'connection.to.nodeId');
    if (!nodeIds.has(input.from.nodeId) || !nodeIds.has(input.to.nodeId)) {
        throw new CanvasValidationError('invalid_value', 'connection', 'Both connection endpoints must reference existing nodes.');
    }
    if (typeof input.kind !== 'string' || !CONNECTION_KINDS.includes(input.kind as typeof CONNECTION_KINDS[number])) {
        throw new CanvasValidationError('invalid_value', 'connection.kind', `connection.kind must be one of: ${CONNECTION_KINDS.join(', ')}.`);
    }
    assertIsoDate(input.createdAt, 'connection.createdAt');
    return input as unknown as CanvasConnection;
}

export function validateCanvasProject(input: unknown, registry: NodeRegistry = builtInNodeRegistry): CanvasProject {
    assertRecord(input, 'project');
    if (input.schemaVersion !== 2) {
        throw new CanvasValidationError('invalid_value', 'project.schemaVersion', 'project.schemaVersion must be 2.');
    }
    assertString(input.id, 'project.id');
    assertString(input.title, 'project.title');
    if (!Number.isInteger(input.revision) || (input.revision as number) < 0) {
        throw new CanvasValidationError('invalid_value', 'project.revision', 'project.revision must be a non-negative integer.');
    }
    assertIsoDate(input.createdAt, 'project.createdAt');
    assertIsoDate(input.updatedAt, 'project.updatedAt');
    if (!Array.isArray(input.nodes)) {
        throw new CanvasValidationError('invalid_type', 'project.nodes', 'project.nodes must be an array.');
    }
    const nodes = input.nodes.map(node => validateCanvasNode(node, registry));
    const nodeIds = new Set(nodes.map(node => node.id));
    if (nodeIds.size !== nodes.length) {
        throw new CanvasValidationError('invalid_value', 'project.nodes', 'project.nodes must use unique IDs.');
    }
    if (!Array.isArray(input.connections)) {
        throw new CanvasValidationError('invalid_type', 'project.connections', 'project.connections must be an array.');
    }
    const connections = input.connections.map(connection => validateConnection(connection, nodeIds));
    assertRecord(input.viewport, 'project.viewport');
    assertFiniteNumber(input.viewport.x, 'project.viewport.x');
    assertFiniteNumber(input.viewport.y, 'project.viewport.y');
    assertPositiveNumber(input.viewport.zoom, 'project.viewport.zoom');

    return {
        schemaVersion: 2,
        id: input.id,
        title: input.title,
        revision: input.revision as number,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        nodes,
        connections,
        viewport: { x: input.viewport.x, y: input.viewport.y, zoom: input.viewport.zoom },
    };
}
