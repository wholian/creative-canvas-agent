import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createHistoryState,
    pushHistoryState,
    redoHistoryState,
    undoHistoryState,
} from '../../src/history/historyState.ts';

interface CanvasSnapshot {
    nodes: string[];
    groups: string[];
}

const EMPTY: CanvasSnapshot = { nodes: [], groups: [] };

test('a recorded canvas operation can be undone and redone atomically', () => {
    const added: CanvasSnapshot = { nodes: ['node-1'], groups: ['group-1'] };
    const recorded = pushHistoryState(createHistoryState(EMPTY), added);
    assert.equal(recorded.past.length, 1);
    assert.deepEqual(recorded.present, added);

    const undone = undoHistoryState(recorded);
    assert.deepEqual(undone.present, EMPTY);
    assert.deepEqual(undone.future, [added]);

    const redone = redoHistoryState(undone);
    assert.deepEqual(redone.present, added);
    assert.deepEqual(redone.past, [EMPTY]);
});

test('recording a new operation after undo clears the redo branch', () => {
    const first = pushHistoryState(createHistoryState(EMPTY), { nodes: ['node-1'], groups: [] });
    const undone = undoHistoryState(first);
    const branched = pushHistoryState(undone, { nodes: ['node-2'], groups: [] });
    assert.deepEqual(branched.present.nodes, ['node-2']);
    assert.deepEqual(branched.future, []);
});

test('duplicate states do not create history entries', () => {
    const initial = createHistoryState(EMPTY);
    assert.equal(pushHistoryState(initial, structuredClone(EMPTY)), initial);
});

test('history respects its configured size limit', () => {
    let history = createHistoryState<CanvasSnapshot>(EMPTY);
    for (let index = 1; index <= 5; index += 1) {
        history = pushHistoryState(history, { nodes: [`node-${index}`], groups: [] }, 3);
    }
    assert.equal(history.past.length, 3);
    assert.deepEqual(history.past.map(item => item.nodes[0]), ['node-2', 'node-3', 'node-4']);
});
