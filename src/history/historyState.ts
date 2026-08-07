export interface HistoryState<T> {
    past: T[];
    present: T;
    future: T[];
}

export function createHistoryState<T>(initialState: T): HistoryState<T> {
    return { past: [], present: initialState, future: [] };
}

function statesEqual<T>(left: T, right: T): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function pushHistoryState<T>(
    history: HistoryState<T>,
    next: T,
    maxHistorySize = 50,
): HistoryState<T> {
    if (statesEqual(history.present, next)) return history;
    return {
        past: [...history.past.slice(-Math.max(maxHistorySize - 1, 0)), history.present],
        present: next,
        future: [],
    };
}

export function undoHistoryState<T>(history: HistoryState<T>): HistoryState<T> {
    if (history.past.length === 0) return history;
    const previous = history.past[history.past.length - 1];
    return {
        past: history.past.slice(0, -1),
        present: previous,
        future: [history.present, ...history.future],
    };
}

export function redoHistoryState<T>(history: HistoryState<T>): HistoryState<T> {
    if (history.future.length === 0) return history;
    const next = history.future[0];
    return {
        past: [...history.past, history.present],
        present: next,
        future: history.future.slice(1),
    };
}
