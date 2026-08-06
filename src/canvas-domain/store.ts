import type { CanvasProject } from './types.ts';

export interface CanvasProjectStore {
    get(projectId: string): Promise<CanvasProject | null>;
    save(project: CanvasProject): Promise<void>;
}

function cloneProject(project: CanvasProject): CanvasProject {
    return structuredClone(project);
}

export class InMemoryCanvasProjectStore implements CanvasProjectStore {
    private readonly projects = new Map<string, CanvasProject>();

    constructor(initialProjects: CanvasProject[] = []) {
        for (const project of initialProjects) {
            this.projects.set(project.id, cloneProject(project));
        }
    }

    async get(projectId: string): Promise<CanvasProject | null> {
        const project = this.projects.get(projectId);
        return project ? cloneProject(project) : null;
    }

    async save(project: CanvasProject): Promise<void> {
        this.projects.set(project.id, cloneProject(project));
    }
}
