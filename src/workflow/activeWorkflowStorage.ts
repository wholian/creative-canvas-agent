const ACTIVE_WORKFLOW_STORAGE_KEY = 'creative-canvas-agent.active-workflow-id';

export interface WorkflowIdStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

function browserStorage(): WorkflowIdStorage | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
}

export function readActiveWorkflowId(storage: WorkflowIdStorage | null = browserStorage()): string | null {
    if (!storage) return null;
    try {
        const value = storage.getItem(ACTIVE_WORKFLOW_STORAGE_KEY)?.trim();
        return value || null;
    } catch {
        return null;
    }
}

export function writeActiveWorkflowId(
    workflowId: string,
    storage: WorkflowIdStorage | null = browserStorage(),
): void {
    if (!storage || !workflowId.trim()) return;
    try {
        storage.setItem(ACTIVE_WORKFLOW_STORAGE_KEY, workflowId.trim());
    } catch {
        // Persistence is a recovery aid. Saving the workflow itself must not
        // fail merely because browser storage is unavailable.
    }
}

export function clearActiveWorkflowId(storage: WorkflowIdStorage | null = browserStorage()): void {
    if (!storage) return;
    try {
        storage.removeItem(ACTIVE_WORKFLOW_STORAGE_KEY);
    } catch {
        // See writeActiveWorkflowId: browser storage is best-effort only.
    }
}

export { ACTIVE_WORKFLOW_STORAGE_KEY };
