/**
 * useHistory.ts
 * 
 * Custom hook for managing undo/redo history.
 * Implements a past/present/future pattern for state management.
 */

import { useState, useCallback } from 'react';
import {
    createHistoryState,
    pushHistoryState,
    redoHistoryState,
    undoHistoryState,
} from '../history/historyState';

export const useHistory = <T>(initialState: T, maxHistorySize: number = 50) => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [history, setHistory] = useState(() => createHistoryState(initialState));

    // ============================================================================
    // COMPUTED VALUES
    // ============================================================================

    const canUndo = history.past.length > 0;
    const canRedo = history.future.length > 0;

    // ============================================================================
    // OPERATIONS
    // ============================================================================

    /**
     * Undo the last action
     * Moves present to future, pops from past to present
     */
    const undo = useCallback(() => {
        setHistory(previous => undoHistoryState(previous));
    }, []);

    /**
     * Redo the last undone action
     * Moves present to past, pops from future to present
     */
    const redo = useCallback(() => {
        setHistory(previous => redoHistoryState(previous));
    }, []);

    /**
     * Push a new state to history
     * Clears redo stack and adds current state to past
     * @param newState - New state to push
     */
    const pushHistory = useCallback((newState: T) => {
        setHistory(previous => pushHistoryState(previous, newState, maxHistorySize));
    }, [maxHistorySize]);

    /**
     * Reset history to a new initial state
     * Clears all history
     * @param newState - New initial state
     */
    const reset = useCallback((newState: T) => {
        setHistory(createHistoryState(newState));
    }, []);

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        present: history.present,
        undo,
        redo,
        pushHistory,
        reset,
        canUndo,
        canRedo
    };
};
