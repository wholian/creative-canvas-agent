/**
 * useKeyboardShortcuts.ts
 * 
 * Handles keyboard shortcuts: undo/redo, copy/paste, delete, escape.
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { NodeData, ContextMenuState } from '../types';

interface UseKeyboardShortcutsOptions {
    nodes: NodeData[];
    selectedNodeIds: string[];
    selectedConnection: { parentId: string; childId: string } | null;
    setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>;
    setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
    setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
    deleteNodes: (ids: string[]) => void;
    deleteSelectedConnection: () => void;
    clearSelection: () => void;
    clearSelectionBox: () => void;
    undo: () => void;
    redo: () => void;
}

export const useKeyboardShortcuts = ({
    nodes,
    selectedNodeIds,
    selectedConnection,
    setNodes,
    setSelectedNodeIds,
    setContextMenu,
    deleteNodes,
    deleteSelectedConnection,
    clearSelection,
    clearSelectionBox,
    undo,
    redo
}: UseKeyboardShortcutsOptions) => {
    const clipboardRef = useRef<NodeData[]>([]);

    // ============================================================================
    // COPY / PASTE / DUPLICATE
    // ============================================================================

    const handleCopy = useCallback(() => {
        if (selectedNodeIds.length > 0) {
            const selectedNodes = nodes.filter(n => selectedNodeIds.includes(n.id));
            clipboardRef.current = JSON.parse(JSON.stringify(selectedNodes));
            console.log(`Copied ${selectedNodes.length} node(s)`);
        }
    }, [nodes, selectedNodeIds]);

    const handlePaste = useCallback(() => {
        if (clipboardRef.current.length > 0) {
            const pasteOffset = 50;
            const newNodes: NodeData[] = clipboardRef.current.map(node => ({
                ...node,
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                x: node.x + pasteOffset,
                y: node.y + pasteOffset,
                parentIds: undefined,
                groupId: undefined
            }));

            setNodes(prev => [...prev, ...newNodes]);
            setSelectedNodeIds(newNodes.map(n => n.id));
            console.log(`Pasted ${newNodes.length} node(s)`);
        }
    }, [setNodes, setSelectedNodeIds]);

    const handleDuplicate = useCallback(() => {
        if (selectedNodeIds.length > 0) {
            const selectedNodes = nodes.filter(n => selectedNodeIds.includes(n.id));
            const nodesToDuplicate = JSON.parse(JSON.stringify(selectedNodes));

            const offset = 20;
            const newNodes: NodeData[] = nodesToDuplicate.map((node: NodeData) => ({
                ...node,
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                x: node.x + offset,
                y: node.y + offset,
                parentIds: undefined,
                groupId: undefined
            }));

            setNodes(prev => [...prev, ...newNodes]);
            setSelectedNodeIds(newNodes.map(n => n.id));
        }
    }, [nodes, selectedNodeIds, setNodes, setSelectedNodeIds]);

    // ============================================================================
    // KEYBOARD EVENT EFFECT
    // ============================================================================

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const activeTag = document.activeElement?.tagName.toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea') return;
            const commandKey = e.ctrlKey || e.metaKey;

            // Undo: Ctrl/Cmd+Z (without Shift)
            if (commandKey && e.key.toLowerCase() === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
                return;
            }

            // Redo: Ctrl+Y or Ctrl/Cmd+Shift+Z
            if ((e.ctrlKey && e.key.toLowerCase() === 'y') || (commandKey && e.shiftKey && e.key.toLowerCase() === 'z')) {
                e.preventDefault();
                redo();
                return;
            }

            // Copy: Ctrl+C
            if (commandKey && e.key.toLowerCase() === 'c') {
                handleCopy();
                return;
            }

            // Paste: Ctrl+V
            if (commandKey && e.key.toLowerCase() === 'v') {
                handlePaste();
                return;
            }

            // Delete selected nodes or connection
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedNodeIds.length > 0) {
                    deleteNodes(selectedNodeIds);
                    setContextMenu(prev => ({ ...prev, isOpen: false }));
                } else if (selectedConnection) {
                    deleteSelectedConnection();
                }
            } else if (e.key === 'Escape') {
                clearSelection();
                clearSelectionBox();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        selectedNodeIds,
        selectedConnection,
        deleteNodes,
        deleteSelectedConnection,
        clearSelection,
        clearSelectionBox,
        undo,
        redo,
        handlePaste,
        handleCopy,
        setNodes,
        setContextMenu
    ]);

    return {
        handleCopy,
        handlePaste,
        handleDuplicate
    };
};
