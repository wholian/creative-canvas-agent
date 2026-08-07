/**
 * useNodeManagement.ts
 * 
 * Custom hook for managing node state and operations.
 * Handles node creation, updates, selection, and deletion.
 */

import React, { useCallback, useRef, useState } from 'react';
import { NodeData, NodeType, NodeStatus, Viewport } from '../types';
import {
    applyManualConnectedNodeAdd,
    applyManualConnectionAdd,
    applyManualConnectionDelete,
    applyManualNodeAdd,
    applyManualNodeDelete,
    applyManualNodeUpdate,
    type ManualCanvasOperationFailure,
    type ManualCanvasNodeType,
} from '../canvas-adapters/manualCanvasOperationBridge';

interface UseNodeManagementOptions {
    title: string;
    viewport: Viewport;
}

const DOMAIN_MANAGED_UPDATE_KEYS = new Set<keyof NodeData>([
    'title',
    'prompt',
    'x',
    'y',
    'imageModel',
    'videoModel',
    'aspectRatio',
    'resolution',
    'videoDuration',
    'generateAudio',
]);

function isDomainNodeType(type: NodeType): type is ManualCanvasNodeType {
    return type === NodeType.TEXT || type === NodeType.IMAGE || type === NodeType.VIDEO;
}

function isDomainManagedUpdate(updates: Partial<NodeData>): boolean {
    const keys = Object.keys(updates) as Array<keyof NodeData>;
    return keys.length > 0 && keys.every(key => DOMAIN_MANAGED_UPDATE_KEYS.has(key));
}

export const useNodeManagement = ({ title, viewport: currentViewport }: UseNodeManagementOptions) => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [nodes, setNodesState] = useState<NodeData[]>([]);
    const nodesRef = useRef<NodeData[]>([]);
    const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
    const [canvasOperationError, setCanvasOperationError] = useState<ManualCanvasOperationFailure | null>(null);
    const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
    const titleRef = useRef(title);
    const viewportRef = useRef(currentViewport);
    titleRef.current = title;
    viewportRef.current = currentViewport;

    const setNodes = useCallback<React.Dispatch<React.SetStateAction<NodeData[]>>>((action) => {
        const previous = nodesRef.current;
        const next = typeof action === 'function'
            ? (action as (value: NodeData[]) => NodeData[])(previous)
            : action;
        nodesRef.current = next;
        setNodesState(next);
    }, []);

    const enqueueOperation = useCallback((operation: () => Promise<void>) => {
        operationQueueRef.current = operationQueueRef.current.then(operation, operation);
    }, []);

    // ============================================================================
    // NODE OPERATIONS
    // ============================================================================

    /**
     * Adds a new node to the canvas
     * @param type - Type of node to create
     * @param x - Screen X coordinate
     * @param y - Screen Y coordinate
     * @param parentId - Optional parent node ID for connections
     * @param viewport - Current viewport for coordinate conversion
     */
    const addNode = (
        type: NodeType,
        x: number,
        y: number,
        parentId: string | undefined,
        viewport: Viewport
    ) => {
        const canvasX = (x - viewport.x) / viewport.zoom;
        const canvasY = (y - viewport.y) / viewport.zoom;

        const nodeId = crypto.randomUUID();
        if (
            import.meta.env.VITE_CANVAS_OPERATION_BRIDGE !== 'false'
            && !parentId
            && isDomainNodeType(type)
        ) {
            enqueueOperation(async () => {
                const result = await applyManualNodeAdd({
                    nodes: nodesRef.current,
                    viewport,
                    title: titleRef.current,
                    nodeType: type,
                    nodeId,
                    position: { x: canvasX - 170, y: canvasY - 100 },
                });
                if (result.status !== 'succeeded' || !result.node) {
                    setCanvasOperationError(result.error || {
                        code: 'operation_failed',
                        message: 'The canvas operation did not create a node.',
                    });
                    return;
                }
                setCanvasOperationError(null);
                setNodes(previous => [...previous, result.node as NodeData]);
                setSelectedNodeIds([result.node.id]);
            });
            return nodeId;
        }

        const newNode: NodeData = {
            id: nodeId,
            type,
            x: parentId ? canvasX : canvasX - 170,
            y: parentId ? canvasY : canvasY - 100,
            prompt: '',
            status: NodeStatus.IDLE,
            model: 'Banana Pro',
            aspectRatio: 'Auto',
            resolution: 'Auto',
            parentIds: parentId ? [parentId] : []
        };

        setNodes(prev => [...prev, newNode]);
        setSelectedNodeIds([newNode.id]);

        return newNode.id;
    };

    /**
     * Creates an editable draft node from an approved chat action. This does
     * not call a generation provider; it only changes the same canvas state a
     * manual Add Node action changes.
     */
    const addAgentDraftNode = (
        type: NodeType.IMAGE | NodeType.VIDEO,
        prompt: string,
        viewport: Viewport,
        imageSettings?: { imageModel?: string; modelName?: string; aspectRatio?: string; resolution?: string }
    ) => {
        const nodeWidth = 340;
        const offset = (nodes.length % 5) * 36;
        const x = (window.innerWidth / 2 - viewport.x) / viewport.zoom - nodeWidth / 2 + offset;
        const y = (window.innerHeight / 2 - viewport.y) / viewport.zoom - 130 + offset;
        const newNode: NodeData = {
            id: crypto.randomUUID(),
            type,
            title: type === NodeType.IMAGE ? 'AI Image Draft' : 'AI Video Draft',
            x,
            y,
            prompt,
            status: NodeStatus.IDLE,
            model: imageSettings?.modelName || (type === NodeType.IMAGE ? 'Nano Banana Pro' : 'Banana Pro'),
            imageModel: type === NodeType.IMAGE ? (imageSettings?.imageModel || 'gemini-pro') : undefined,
            aspectRatio: imageSettings?.aspectRatio || 'Auto',
            resolution: imageSettings?.resolution || (type === NodeType.IMAGE ? '1K' : 'Auto'),
            parentIds: [],
        };

        setNodes(prev => [...prev, newNode]);
        setSelectedNodeIds([newNode.id]);
        return newNode.id;
    };

    /**
     * Updates a node with partial data
     * @param id - Node ID to update
     * @param updates - Partial node data to merge
     */
    const updateNode = (id: string, updates: Partial<NodeData>) => {
        const current = nodesRef.current.find(node => node.id === id);
        if (
            import.meta.env.VITE_CANVAS_OPERATION_BRIDGE !== 'false'
            && current
            && isDomainNodeType(current.type)
            && isDomainManagedUpdate(updates)
        ) {
            enqueueOperation(async () => {
                const result = await applyManualNodeUpdate({
                    nodes: nodesRef.current,
                    viewport: viewportRef.current,
                    title: titleRef.current,
                    nodeId: id,
                    updates,
                });
                if (result.status !== 'succeeded' || !result.node) {
                    setCanvasOperationError(result.error || {
                        code: 'operation_failed',
                        message: 'The canvas operation did not update the node.',
                    });
                    return;
                }
                setCanvasOperationError(null);
                setNodes(previous => previous.map(node => node.id === id ? result.node as NodeData : node));
            });
            return;
        }
        setNodes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
    };

    /**
     * Deletes a node by ID
     * @param id - Node ID to delete
     */
    const deleteNode = (id: string) => {
        deleteNodes([id]);
    };

    /**
     * Deletes multiple nodes by IDs
     * @param ids - Array of node IDs to delete
     */
    function deleteNodes(ids: string[]) {
        if (import.meta.env.VITE_CANVAS_OPERATION_BRIDGE !== 'false') {
            enqueueOperation(async () => {
                const result = await applyManualNodeDelete({
                    nodes: nodesRef.current,
                    viewport: viewportRef.current,
                    title: titleRef.current,
                    nodeIds: ids,
                });
                if (result.status !== 'succeeded' || !result.nodes) {
                    setCanvasOperationError(result.error || {
                        code: 'operation_failed',
                        message: 'The canvas operation did not delete the selected nodes.',
                    });
                    return;
                }
                setCanvasOperationError(null);
                setNodes(result.nodes);
                setSelectedNodeIds([]);
            });
            return;
        }
        setNodes(prev => prev.filter(n => !ids.includes(n.id)));
        setSelectedNodeIds([]);
    }

    const connectNodes = (parentId: string, childId: string) => {
        if (import.meta.env.VITE_CANVAS_OPERATION_BRIDGE !== 'false') {
            enqueueOperation(async () => {
                const result = await applyManualConnectionAdd({
                    nodes: nodesRef.current,
                    viewport: viewportRef.current,
                    title: titleRef.current,
                    parentId,
                    childId,
                });
                if (result.status !== 'succeeded' || !result.nodes) {
                    setCanvasOperationError(result.error || {
                        code: 'operation_failed',
                        message: 'The canvas operation did not create the connection.',
                    });
                    return;
                }
                let committedNodes = result.nodes;
                const parentNode = committedNodes.find(node => node.id === parentId);
                if (parentNode?.type === NodeType.TEXT && parentNode.prompt) {
                    const promptResult = await applyManualNodeUpdate({
                        nodes: committedNodes,
                        viewport: viewportRef.current,
                        title: titleRef.current,
                        nodeId: childId,
                        updates: { prompt: parentNode.prompt },
                    });
                    if (promptResult.status !== 'succeeded' || !promptResult.node) {
                        setCanvasOperationError(promptResult.error || {
                            code: 'operation_failed',
                            message: 'The canvas operation could not synchronize the text prompt.',
                        });
                        return;
                    }
                    committedNodes = committedNodes.map(node => node.id === childId ? promptResult.node as NodeData : node);
                }
                setCanvasOperationError(null);
                setNodes(committedNodes);
            });
            return;
        }
        setNodes(previous => {
            const parentNode = previous.find(node => node.id === parentId);
            return previous.map(node => node.id === childId
                ? {
                    ...node,
                    parentIds: [...new Set([...(node.parentIds || []), parentId])],
                    ...(parentNode?.type === NodeType.TEXT && parentNode.prompt ? { prompt: parentNode.prompt } : {}),
                }
                : node);
        });
    };

    const disconnectNodes = (parentId: string, childId: string) => {
        if (import.meta.env.VITE_CANVAS_OPERATION_BRIDGE !== 'false') {
            enqueueOperation(async () => {
                const result = await applyManualConnectionDelete({
                    nodes: nodesRef.current,
                    viewport: viewportRef.current,
                    title: titleRef.current,
                    parentId,
                    childId,
                });
                if (result.status !== 'succeeded' || !result.nodes) {
                    setCanvasOperationError(result.error || {
                        code: 'operation_failed',
                        message: 'The canvas operation did not delete the connection.',
                    });
                    return;
                }
                setCanvasOperationError(null);
                setNodes(result.nodes);
            });
            return;
        }
        setNodes(previous => previous.map(node => node.id === childId
            ? { ...node, parentIds: (node.parentIds || []).filter(id => id !== parentId) }
            : node));
    };

    /**
     * Clears all node selections
     */
    const clearSelection = () => {
        setSelectedNodeIds([]);
    };

    /**
     * Handles node type selection from context menu
     * Creates new node or deletes existing node
     */
    const handleSelectTypeFromMenu = (
        type: NodeType | 'DELETE',
        contextMenu: any,
        viewport: Viewport,
        onCloseMenu: () => void
    ) => {
        // Handle Delete Action
        if (type === 'DELETE') {
            if (contextMenu.sourceNodeId) {
                deleteNode(contextMenu.sourceNodeId);
            }
            onCloseMenu();
            return;
        }

        if (contextMenu.type === 'node-connector' && contextMenu.sourceNodeId) {
            const sourceNode = nodesRef.current.find(n => n.id === contextMenu.sourceNodeId);
            if (sourceNode) {
                const direction = contextMenu.connectorSide || 'right';
                const newNodeId = crypto.randomUUID();
                const GAP = 100;
                const NODE_WIDTH = 340;

                if (
                    import.meta.env.VITE_CANVAS_OPERATION_BRIDGE !== 'false'
                    && isDomainNodeType(type)
                ) {
                    const position = direction === 'right'
                        ? { x: sourceNode.x + NODE_WIDTH + GAP, y: sourceNode.y }
                        : { x: sourceNode.x - NODE_WIDTH - GAP, y: sourceNode.y };
                    const parentId = direction === 'right' ? sourceNode.id : newNodeId;
                    const childId = direction === 'right' ? newNodeId : sourceNode.id;
                    enqueueOperation(async () => {
                        const result = await applyManualConnectedNodeAdd({
                            nodes: nodesRef.current,
                            viewport: viewportRef.current,
                            title: titleRef.current,
                            nodeType: type,
                            nodeId: newNodeId,
                            position,
                            parentId,
                            childId,
                        });
                        if (result.status !== 'succeeded' || !result.nodes || !result.node) {
                            setCanvasOperationError(result.error || {
                                code: 'operation_failed',
                                message: 'The canvas operation did not create the connected node.',
                            });
                            return;
                        }
                        setCanvasOperationError(null);
                        setNodes(result.nodes);
                        setSelectedNodeIds([result.node.id]);
                    });
                    onCloseMenu();
                    return;
                }

                let newNode: NodeData;

                if (direction === 'right') {
                    // Append: Source -> New
                    newNode = {
                        id: newNodeId,
                        type,
                        x: sourceNode.x + NODE_WIDTH + GAP,
                        y: sourceNode.y,
                        prompt: '',
                        status: NodeStatus.IDLE,
                        model: 'Banana Pro',
                        aspectRatio: 'Auto',
                        resolution: 'Auto',
                        parentIds: contextMenu.sourceNodeId ? [contextMenu.sourceNodeId] : []
                    };
                } else {
                    // Prepend: New -> Source
                    newNode = {
                        id: newNodeId,
                        type,
                        x: sourceNode.x - NODE_WIDTH - GAP,
                        y: sourceNode.y,
                        prompt: '',
                        status: NodeStatus.IDLE,
                        model: 'Banana Pro',
                        aspectRatio: 'Auto',
                        resolution: 'Auto',
                        parentIds: []
                    };
                    // Update source to add new node as parent
                    const existingParentIds = sourceNode.parentIds || [];
                    updateNode(contextMenu.sourceNodeId, { parentIds: [...existingParentIds, newNodeId] });
                }

                setNodes(prev => [...prev, newNode]);
                setSelectedNodeIds([newNodeId]);
            }
        } else {
            // Global menu - add at click position
            addNode(type, contextMenu.x, contextMenu.y, undefined, viewport);
        }

        onCloseMenu();
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        nodes,
        setNodes,
        selectedNodeIds,
        setSelectedNodeIds,
        addNode,
        addAgentDraftNode,
        updateNode,
        deleteNode,
        deleteNodes,
        connectNodes,
        disconnectNodes,
        clearSelection,
        handleSelectTypeFromMenu,
        canvasOperationError,
        clearCanvasOperationError: () => setCanvasOperationError(null),
    };
};
