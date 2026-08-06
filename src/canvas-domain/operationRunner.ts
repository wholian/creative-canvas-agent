import type {
    CanvasNode,
    CanvasOperation,
    CanvasOperationResult,
    CanvasProject,
    ConnectionAddOperationPayload,
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
    if (!['node.add', 'node.update', 'node.delete', 'connection.add', 'connection.delete'].includes(operation.type)) {
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

            let result: CanvasOperationResult;
            switch (operation.type) {
                case 'node.add':
                    result = this.addNode(project, operation);
                    break;
                case 'node.update':
                    result = this.updateNode(project, operation);
                    break;
                case 'node.delete':
                    result = this.deleteNode(project, operation);
                    break;
                case 'connection.add':
                    result = this.addConnection(project, operation);
                    break;
                case 'connection.delete':
                    result = this.deleteConnection(project, operation);
                    break;
            }
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

    async executeBatch(
        operations: CanvasOperation[],
        { atomic = true }: { atomic?: boolean } = {},
    ): Promise<CanvasOperationResult[]> {
        if (!atomic) {
            const results: CanvasOperationResult[] = [];
            for (const operation of operations) results.push(await this.execute(operation));
            return results;
        }
        if (operations.length === 0) return [];
        const projectId = operations[0].projectId;
        if (operations.some(operation => operation.projectId !== projectId)) {
            throw new Error('Atomic canvas batches must target one project.');
        }
        const original = await this.store.get(projectId);
        if (!original) return [rejected(operations[0], 0, 'project_not_found', `Canvas project not found: ${projectId}.`)];
        const completedBefore = new Set(this.completed.keys());
        const results: CanvasOperationResult[] = [];
        for (const operation of operations) {
            const result = await this.execute(operation);
            results.push(result);
            if (result.status !== 'succeeded') {
                await this.store.save(original);
                for (const key of this.completed.keys()) {
                    if (!completedBefore.has(key)) this.completed.delete(key);
                }
                return results.map(item => item.status === 'succeeded'
                    ? rejected({ operationId: item.operationId }, original.revision, 'transaction_rolled_back', 'The atomic canvas batch was rolled back.')
                    : { ...item, projectRevision: original.revision });
            }
        }
        return results;
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

    private deleteNode(project: CanvasProject, operation: CanvasOperation): CanvasOperationResult {
        const payload = operation.payload;
        assertRecord(payload, 'operation.payload');
        const nodeId = payload.nodeId;
        if (typeof nodeId !== 'string' || !nodeId.trim()) {
            throw new CanvasValidationError('missing_field', 'operation.payload.nodeId', 'operation.payload.nodeId is required.');
        }
        const node = project.nodes.find(candidate => candidate.id === nodeId);
        if (!node) {
            throw new CanvasValidationError('invalid_value', 'operation.payload.nodeId', `Canvas node not found: ${nodeId}.`);
        }
        if (node.locked && operation.actor.type === 'agent') {
            throw new CanvasValidationError('invalid_value', 'operation.payload.nodeId', `Canvas node is locked: ${nodeId}.`);
        }
        const deletedConnectionIds = project.connections
            .filter(connection => connection.from.nodeId === nodeId || connection.to.nodeId === nodeId)
            .map(connection => connection.id);
        project.nodes = project.nodes.filter(candidate => candidate.id !== nodeId);
        project.connections = project.connections.filter(connection => !deletedConnectionIds.includes(connection.id));
        project.revision += 1;
        project.updatedAt = this.now();
        return {
            operationId: operation.operationId,
            status: 'succeeded',
            projectRevision: project.revision,
            affectedIds: [nodeId, ...deletedConnectionIds],
            data: { nodeId, deletedConnectionIds },
        };
    }

    private addConnection(project: CanvasProject, operation: CanvasOperation): CanvasOperationResult {
        const rawPayload = operation.payload;
        assertRecord(rawPayload, 'operation.payload');
        const payload = rawPayload as unknown as ConnectionAddOperationPayload;
        assertRecord(payload.from, 'operation.payload.from');
        assertRecord(payload.to, 'operation.payload.to');
        if (typeof payload.from.nodeId !== 'string' || typeof payload.to.nodeId !== 'string') {
            throw new CanvasValidationError('missing_field', 'operation.payload', 'Connection endpoints require nodeId.');
        }
        const nodeIds = new Set(project.nodes.map(node => node.id));
        if (!nodeIds.has(payload.from.nodeId) || !nodeIds.has(payload.to.nodeId)) {
            throw new CanvasValidationError('invalid_value', 'operation.payload', 'Both connection endpoints must reference existing nodes.');
        }
        if (!['reference', 'sequence', 'input'].includes(payload.kind)) {
            throw new CanvasValidationError('invalid_value', 'operation.payload.kind', 'Connection kind must be reference, sequence, or input.');
        }
        const duplicate = project.connections.find(connection =>
            connection.from.nodeId === payload.from.nodeId
            && connection.from.port === payload.from.port
            && connection.to.nodeId === payload.to.nodeId
            && connection.to.port === payload.to.port
            && connection.kind === payload.kind,
        );
        if (duplicate) {
            throw new CanvasValidationError('invalid_value', 'operation.payload', `Equivalent connection already exists: ${duplicate.id}.`);
        }
        const connectionId = payload.connectionId || this.idFactory();
        if (project.connections.some(connection => connection.id === connectionId)) {
            throw new CanvasValidationError('invalid_value', 'operation.payload.connectionId', `Canvas connection already exists: ${connectionId}.`);
        }
        const timestamp = this.now();
        const connection = {
            id: connectionId,
            from: structuredClone(payload.from),
            to: structuredClone(payload.to),
            kind: payload.kind,
            createdAt: timestamp,
        };
        project.connections.push(connection);
        project.revision += 1;
        project.updatedAt = timestamp;
        return {
            operationId: operation.operationId,
            status: 'succeeded',
            projectRevision: project.revision,
            affectedIds: [connectionId],
            data: { connectionId, connection: structuredClone(connection) },
        };
    }

    private deleteConnection(project: CanvasProject, operation: CanvasOperation): CanvasOperationResult {
        const payload = operation.payload;
        assertRecord(payload, 'operation.payload');
        const connectionId = payload.connectionId;
        if (typeof connectionId !== 'string' || !connectionId.trim()) {
            throw new CanvasValidationError('missing_field', 'operation.payload.connectionId', 'operation.payload.connectionId is required.');
        }
        if (!project.connections.some(connection => connection.id === connectionId)) {
            throw new CanvasValidationError('invalid_value', 'operation.payload.connectionId', `Canvas connection not found: ${connectionId}.`);
        }
        project.connections = project.connections.filter(connection => connection.id !== connectionId);
        project.revision += 1;
        project.updatedAt = this.now();
        return {
            operationId: operation.operationId,
            status: 'succeeded',
            projectRevision: project.revision,
            affectedIds: [connectionId],
            data: { connectionId },
        };
    }
}
