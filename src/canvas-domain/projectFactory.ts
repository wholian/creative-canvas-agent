import type { CanvasProject } from './types.ts';

export interface CreateCanvasProjectInput {
    id: string;
    title: string;
    now?: string;
}

export function createCanvasProject({ id, title, now = new Date().toISOString() }: CreateCanvasProjectInput): CanvasProject {
    if (!id.trim()) throw new Error('Project ID is required.');
    if (!title.trim()) throw new Error('Project title is required.');
    return {
        schemaVersion: 2,
        id,
        title,
        revision: 0,
        createdAt: now,
        updatedAt: now,
        nodes: [],
        connections: [],
        viewport: { x: 0, y: 0, zoom: 1 },
    };
}
