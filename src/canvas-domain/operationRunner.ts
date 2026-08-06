import type {
    CanvasNode,
    CanvasOperation,
    CanvasOperationResult,
    CanvasProject,
    NodeAddOperationPayload,
} from './types.ts';
import type { CanvasProjectStore } from './store.ts';
import { builtInNodeRegistry, type NodeRegistry } from './nodeRegistry.ts';
import { validateCanvasNode, validateCanvasProject } from './projectValidation.ts';
import { assertRecord, CanvasValidationError } from './validation.ts';

export interface CanvasOperationRunnerOptions {
    store: CanvasProjectStore;
    registry?: NodeRegistry;
    idFactory?: () => string;
    now?: () => string;
}

interface CompletedOperation {
    fingerprint: string;
    result: CanvasOperationResult;
}

function cloneResult(result: CanvasOperationResult): CanvasOperationResult {
    return structuredClone(result);
}

function rejected(
    operation: Pick<CanvasOperation, 'operationId'>,
    revision: number,
    code: string,
    message: string,
    path?: string,
): CanvasOperationResult {
    return {
        operationId: operation.operationId,
        status: 'rejected',
        projectRevision: revision,
        affectedIds: [],
        error: { code, message, ...(path ? { path } : {}) },
    };
}

function validateEnvelope(operation: CanvasOperation): void {
    if (!operation || typeof operation !== 'object') {
        throw new CanvasValidationError('invalid_type', 'operation', 'operation must be an object.');
    }
    if (typeof operation.operationId !== 'string' || !operation.operationId.trim()) {
        throw new CanvasValidationError('missing_field', 'operation.operationId', 'operation.operationId is required.');
    }
    if (typeof operation.projectId !== 'string' || !operation.projectId.trim()) {
        throw new CanvasValidationError('missing_field', 'operation.projectId', 'operation.projectId is required.');
    }
    if (!Number.isInteger(operation.baseRevision) || operation.baseRevision < 0) {
        throw new CanvasValidationError('invalid_value', 'operation.baseRevision', 'operation.baseRevision must be a non-negative integer.');
    }
    if (!['node.add', 'node.update'].includes(operation.type)) {
        throw new CanvasValidationError('invalid_value', 'operation.type', `Unsupported operation type: ${operation.type}.`);
    }
    if (!operation.actor || !['user', 'agent', 'system'].includes(operation.actor.type)) {
        throw new CanvasValidationError('invalid_value', 'operation.actor.type', 'operation.actor.type must be user, agent, or system.');
    }
    if (typeof operation.createdAt !== 'string' || Number.isNaN(Date.parse(operation.createdAt))) {
        throw new CanvasValidationError('invalid_value', 'operation.createdAt', 'operation.createdAt must be an ISO date string.');
    }
}

export class CanvasOperationRunner {
    private readonly store: CanvasProjectStore;
    private readonly registry: NodeRegistry;
    private readonly idFactory: () => string;
    private readonly now: () => string;
    private readonly completed = new Map<string, CompletedOperation>();

    constructor({ store, registry = builtInNodeRegistry, idFactory = () => crypto.randomUUID(), now = () => new Date().toISOString() }: CanvasOperationRunnerOptions) {
        this.store = store;
        this.registry = registry;
        this.idFactory = idFactory;
        this.now = now;
    }

    async getSnapshot(projectId: string): Promise<CanvasProject> {
        const project = await this.store.get(projectId);
        if (!project) throw new Error(`Canvas project not found: ${projectId}.`);
        return validateCanvasProject(project, this.registry);
    }

    async execute(operation: CanvasOperation): Promise<CanvasOperationResult> {
        let projectRevision = 0;
        try {
            validateEnvelope(operation);
            const idempotencyKey = `${operation.projectId}:${operation.operationId}`;
            const fingerprint = JSON.stringify(operation);
            const previous = this.completed.get(idempotencyKey);
            if (previous) {
                if (previous.fingerprint !== fingerprint) {
                    return rejected(operation, previous.result.projectRevision, 'operation_id_conflict', 'The operationId was already used with different content.');
                }
                return cloneResult(previous.result);
            }

            const project = await this.store.get(operation.projectId);
            if (!project) {
                return rejected(operation, 0, 'project_not_found', `Canvas project not found: ${operation.projectId}.`);
            }
            projectRevision = project.revision;
            if (operation.baseRevision !== project.revision) {
                return rejected(
                    operation,
                    project.revision,
                    'revision_conflict',
                    `Expected project revision ${operation.baseRevision}, but current revision is ${project.revision}.`,
                );
            }

            const result = operation.type === 'node.add'
                ? this.addNode(project, operation)
                : this.updateNode(project, operation);
            await this.store.save(project);
            this.completed.set(idempotencyKey, { fingerprint, result: cloneResult(result) });
            return result;
        } catch (error) {
            if (error instanceof CanvasValidationError) {
                return rejected(operation, projectRevision, error.code, error.message, error.path);
            }
            return {
                operationId: operation?.operationId || 'unknown',
                status: 'failed',
                projectRevision,
                affectedIds: [],
                error: {
                    code: 'operation_failed',
                    message: error instanceof Error ? error.message : 'Canvas operation failed.',
                },
            };
        }
    }

    private addNode(project: CanvasProject, operation: CanvasOperation): CanvasOperationResult {
        assertRecord(operation.payload, 'operation.payload');
        const payload = operation.payload as unknown as NodeAddOperationPayload;
        if (typeof payload.type !== 'string' || !payload.type.trim()) {
            throw new CanvasValidationError('missing_field', 'operation.payload.type', 'operation.payload.type is required.');
        }
        assertRecord(payload.position, 'operation.payload.position');
        const definition = this.registry.get(payload.type);
        const timestamp = this.now();
        const nodeId = payload.nodeId || this.idFactory();
        if (project.nodes.some(node => node.id === nodeId)) {
            throw new CanvasValidationError('invalid_value', 'operation.payload.nodeId', `Canvas node already exists: ${nodeId}.`);
        }
        const node = validateCanvasNode({
            id: nodeId,
            type: payload.type,
            typeVersion: definition.version,
            title: payload.title || definition.title,
            position: payload.position,
            size: definition.defaultSize,
            status: 'idle',
            payload: payload.payload ?? definition.defaultPayload(),
            artifactIds: [],
            createdAt: timestamp,
            updatedAt: timestamp,
        }, this.registry);

        project.nodes.push(node);
        project.revision += 1;
        project.updatedAt = timestamp;
        return {
            operationId: operation.operationId,
            status: 'succeeded',
            projectRevision: project.revision,
            affectedIds: [node.id],
            data: { nodeId: node.id, node: structuredClone(node) },
        };
    }

    private updateNode(project: CanvasProject, operation: CanvasOperation): CanvasOperationResult {
        const rawPayload = operation.payload;
        assertRecord(rawPayload, 'operation.payload');
        const nodeId = rawPayload.nodeId;
        if (typeof nodeId !== 'string' || !nodeId.trim()) {
            throw new CanvasValidationError('missing_field', 'operation.payload.nodeId', 'operation.payload.nodeId is required.');
        }
        const patch = rawPayload.patch;
        assertRecord(patch, 'operation.payload.patch');
        const index = project.nodes.findIndex(node => node.id === nodeId);
        if (index === -1) {
            throw new CanvasValidationError('invalid_value', 'operation.payload.nodeId', `Canvas node not found: ${nodeId}.`);
        }
        const current = project.nodes[index];
        if (current.locked && operation.actor.type === 'agent') {
            throw new CanvasValidationError('invalid_value', 'operation.payload.nodeId', `Canvas node is locked: ${nodeId}.`);
        }
        const title = patch.title;
        if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
            throw new CanvasValidationError('invalid_value', 'operation.payload.patch.title', 'Node title must be a non-empty string.');
        }
        const position = patch.position;
        let x = current.position.x;
        let y = current.position.y;
        if (position !== undefined) {
            assertRecord(position, 'operation.payload.patch.position');
            x = position.x === undefined ? x : position.x as number;
            y = position.y === undefined ? y : position.y as number;
        }
        if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
            throw new CanvasValidationError('invalid_type', 'operation.payload.patch.position', 'Node position coordinates must be finite numbers.');
        }
        const payloadPatch = patch.payload;
        let nextPayload = current.payload;
        if (payloadPatch !== undefined) {
            assertRecord(payloadPatch, 'operation.payload.patch.payload');
            assertRecord(current.payload, 'node.payload');
            nextPayload = { ...current.payload, ...payloadPatch };
        }
        const timestamp = this.now();
        const candidate: CanvasNode = {
            ...current,
            ...(typeof title === 'string' ? { title } : {}),
            position: { x, y },
            payload: nextPayload,
            updatedAt: timestamp,
        };
        const updated = validateCanvasNode(candidate, this.registry);
        project.nodes[index] = updated;
        project.revision += 1;
        project.updatedAt = timestamp;
        return {
            operationId: operation.operationId,
            status: 'succeeded',
            projectRevision: project.revision,
            affectedIds: [updated.id],
            data: { nodeId: updated.id, node: structuredClone(updated) },
        };
    }
}
