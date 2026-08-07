import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ACTIVE_WORKFLOW_STORAGE_KEY,
    clearActiveWorkflowId,
    readActiveWorkflowId,
    writeActiveWorkflowId,
    type WorkflowIdStorage,
} from '../../src/workflow/activeWorkflowStorage.ts';

function memoryStorage(initial?: string): WorkflowIdStorage & { values: Map<string, string> } {
    const values = new Map<string, string>();
    if (initial !== undefined) values.set(ACTIVE_WORKFLOW_STORAGE_KEY, initial);
    return {
        values,
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value); },
        removeItem: key => { values.delete(key); },
    };
}

test('active workflow storage round-trips a normalized workflow ID', () => {
    const storage = memoryStorage();
    writeActiveWorkflowId('  workflow-123  ', storage);
    assert.equal(readActiveWorkflowId(storage), 'workflow-123');
    assert.equal(storage.values.get(ACTIVE_WORKFLOW_STORAGE_KEY), 'workflow-123');
});

test('empty active workflow values are ignored', () => {
    const storage = memoryStorage('   ');
    assert.equal(readActiveWorkflowId(storage), null);
    writeActiveWorkflowId('   ', storage);
    assert.equal(readActiveWorkflowId(storage), null);
});

test('resetting a canvas clears the active workflow ID', () => {
    const storage = memoryStorage('workflow-123');
    clearActiveWorkflowId(storage);
    assert.equal(readActiveWorkflowId(storage), null);
});
