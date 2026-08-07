/**
 * useAutoSave.ts
 * 
 * Debounces canvas persistence after the latest state change.
 */

import { useEffect, useRef, useState } from 'react';
import { NodeData } from '../types';

interface UseAutoSaveOptions {
    isDirty: boolean;
    nodes: NodeData[];
    onSave: () => Promise<void>;
    delay?: number;
}

export const useAutoSave = ({
    isDirty,
    nodes,
    onSave,
    delay = 1000
}: UseAutoSaveOptions) => {
    const [lastSaveTime, setLastSaveTime] = useState<number | null>(null);
    const isSavingRef = useRef<boolean>(false);

    useEffect(() => {
        const checkAndSave = async () => {
            // Saving an empty dirty canvas is intentional: deleting the final
            // node must not make it reappear after a refresh.
            if (!isDirty) return;

            // Don't save if already in the middle of a save operation
            if (isSavingRef.current) return;

            try {
                isSavingRef.current = true;
                console.log('[Auto-Save] Triggering periodic save...');
                await onSave();
                setLastSaveTime(Date.now());
            } catch (error) {
                console.error('[Auto-Save] Failed to auto-save:', error);
            } finally {
                isSavingRef.current = false;
            }
        };

        // Debounce persistence after the latest canvas change. Recreating the
        // timer is intentional: only a settled snapshot should be saved.
        const timer = setTimeout(checkAndSave, delay);

        return () => clearTimeout(timer);
    }, [isDirty, nodes, onSave, delay]);

    return {
        lastSaveTime
    };
};
