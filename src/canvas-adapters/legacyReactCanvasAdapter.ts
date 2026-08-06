import type { NodeData, Viewport } from '../types.ts';
import { migrateLegacyWorkflow, type LegacyMigrationResult } from '../canvas-domain/index.ts';

export interface LegacyReactCanvasSnapshot {
    id: string;
    title: string;
    nodes: NodeData[];
    viewport: Viewport;
}

export function adaptLegacyReactCanvas(
    snapshot: LegacyReactCanvasSnapshot,
    now: string,
): LegacyMigrationResult {
    return migrateLegacyWorkflow({
        id: snapshot.id,
        title: snapshot.title,
        nodes: snapshot.nodes,
        groups: [],
        viewport: snapshot.viewport,
        createdAt: now,
        updatedAt: now,
    }, { now });
}
