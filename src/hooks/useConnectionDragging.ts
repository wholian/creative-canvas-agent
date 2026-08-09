/**
 * useConnectionDragging.ts
 * 
 * Custom hook for managing connection dragging between nodes.
 * Handles drag-to-connect functionality with visual feedback.
 */

import React, { useState, useRef } from 'react';
import { NodeData, NodeType, Viewport } from '../types';
import { resolveConnectionHoverTarget } from '../canvas-ui/connectionHitTest';
import type { ConnectionHoverTarget } from '../canvas-ui/connectionHitTest';

interface ConnectionStart {
    nodeId: string;
    handle: 'left' | 'right';
}

export const useConnectionDragging = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [isDraggingConnection, setIsDraggingConnection] = useState(false);
    const [connectionStart, setConnectionStart] = useState<ConnectionStart | null>(null);
    const [tempConnectionEnd, setTempConnectionEnd] = useState<{ x: number; y: number } | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [selectedConnection, setSelectedConnection] = useState<{ parentId: string; childId: string } | null>(null);
    const dragStartTime = useRef<number>(0);
    const draggingRef = useRef(false);
    const connectionStartRef = useRef<ConnectionStart | null>(null);
    const hoveredTargetRef = useRef<ConnectionHoverTarget | null>(null);

    // ============================================================================
    // HELPERS
    // ============================================================================

    /**
     * Checks if mouse is hovering over a node (for connection target)
     * Also determines which side (left or right connector) is being hovered
     * @param mouseX - Screen X coordinate
     * @param mouseY - Screen Y coordinate
     * @param nodes - Array of all nodes
     * @param viewport - Current viewport
     */
    const checkHoveredNode = (e: React.PointerEvent, sourceNodeId: string) => {
        const eventTarget = e.target instanceof Element ? e.target : null;
        const connectorElement = eventTarget?.closest<HTMLElement>('[data-canvas-connector="true"]');
        const connectorNodeId = connectorElement?.dataset.canvasNodeId;
        const connectorSide = connectorElement?.dataset.canvasConnectorSide;
        const nodeElement = eventTarget?.closest<HTMLElement>('[data-canvas-node-id]');
        const nodeId = nodeElement?.dataset.canvasNodeId;
        const nodeRect = nodeElement?.getBoundingClientRect();
        const target = resolveConnectionHoverTarget({
            sourceNodeId,
            pointerX: e.clientX,
            ...(connectorNodeId && (connectorSide === 'left' || connectorSide === 'right') ? {
                connector: { nodeId: connectorNodeId, side: connectorSide },
            } : {}),
            ...(nodeId && nodeRect ? { node: { nodeId, left: nodeRect.left, width: nodeRect.width } } : {}),
        });
        hoveredTargetRef.current = target;
        setHoveredNodeId(target?.nodeId || null);
    };

    const resetConnectionDrag = () => {
        draggingRef.current = false;
        connectionStartRef.current = null;
        hoveredTargetRef.current = null;
        setIsDraggingConnection(false);
        setConnectionStart(null);
        setTempConnectionEnd(null);
        setHoveredNodeId(null);
    };

    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================

    /**
     * Starts connection dragging from a connector button
     */
    const handleConnectorPointerDown = (
        e: React.PointerEvent,
        nodeId: string,
        side: 'left' | 'right'
    ) => {
        e.stopPropagation();
        e.preventDefault();
        dragStartTime.current = Date.now();
        draggingRef.current = true;
        connectionStartRef.current = { nodeId, handle: side };
        hoveredTargetRef.current = null;
        setIsDraggingConnection(true);
        setConnectionStart({ nodeId, handle: side });
        setTempConnectionEnd({ x: e.clientX, y: e.clientY });
    };

    /**
     * Updates temporary connection end point during drag
     */
    const updateConnectionDrag = (
        e: React.PointerEvent,
        nodes: NodeData[],
        viewport: Viewport
    ) => {
        if (!draggingRef.current) return false;

        setTempConnectionEnd({ x: e.clientX, y: e.clientY });
        const start = connectionStartRef.current;
        if (start) checkHoveredNode(e, start.nodeId);
        return true;
    };

    /**
     * Completes connection drag and creates connection if valid
     * Returns true if connection was handled, false otherwise
     * @param nodes - All nodes for validation
     * @param onConnectionMade - Optional callback called with (parentId, childId) when connection is created
     */
    const completeConnectionDrag = (
        onAddNext: (nodeId: string, direction: 'left' | 'right') => void,
        onConnectNodes: (parentId: string, childId: string) => void,
        nodes: NodeData[],
        onConnectionMade?: (parentId: string, childId: string) => void
    ): boolean => {
        const activeStart = connectionStartRef.current;
        if (!draggingRef.current || !activeStart) return false;

        const dragDuration = Date.now() - dragStartTime.current;
        const hoveredTarget = hoveredTargetRef.current;

        /**
         * Check if a connection is valid based on node types
         * Rules:
         * - IMAGE → IMAGE, VIDEO, IMAGE_EDITOR: ✅ (image as input)
         * - VIDEO → VIDEO: ✅ (video chaining via lastFrame)
         * - VIDEO → IMAGE, IMAGE_EDITOR: ❌ (can't generate image from video)
         * - TEXT → IMAGE, VIDEO: ✅ (text provides prompt)
         * - TEXT → TEXT, IMAGE_EDITOR: ❌ (no text chaining, no text editing)
         * - Any → TEXT: ❌ (text nodes can't receive input)
         * - AUDIO: ❌ (not supported yet)
         */
        const isValidConnection = (parentId: string, childId: string): boolean => {
            const parentNode = nodes.find(n => n.id === parentId);
            const childNode = nodes.find(n => n.id === childId);

            if (!parentNode || !childNode) return false;

            // AUDIO nodes not supported yet
            if (parentNode.type === NodeType.AUDIO || childNode.type === NodeType.AUDIO) {
                return false;
            }

            // STORYBOARD nodes - allow connections to/from for now (future feature)
            // Can be restricted later when storyboard logic is implemented

            // TEXT nodes can't receive input (can only be parents)
            if (childNode.type === NodeType.TEXT) {
                return false;
            }

            // TEXT nodes can only connect to IMAGE or VIDEO (to provide prompts)
            if (parentNode.type === NodeType.TEXT) {
                return childNode.type === NodeType.IMAGE || childNode.type === NodeType.VIDEO;
            }

            // VIDEO nodes can only connect to other VIDEO nodes (via lastFrame)
            // Cannot connect to IMAGE or IMAGE_EDITOR
            if (parentNode.type === NodeType.VIDEO) {
                return childNode.type === NodeType.VIDEO ||
                    childNode.type === NodeType.VIDEO_EDITOR;
            }

            // IMAGE nodes can connect to IMAGE, VIDEO, or IMAGE_EDITOR
            if (parentNode.type === NodeType.IMAGE) {
                return childNode.type === NodeType.IMAGE ||
                    childNode.type === NodeType.VIDEO ||
                    childNode.type === NodeType.IMAGE_EDITOR;
            }

            // IMAGE_EDITOR can connect to IMAGE, VIDEO, or IMAGE_EDITOR
            if (parentNode.type === NodeType.IMAGE_EDITOR) {
                return childNode.type === NodeType.IMAGE ||
                    childNode.type === NodeType.VIDEO ||
                    childNode.type === NodeType.IMAGE_EDITOR;
            }

            // VIDEO_EDITOR can only connect to VIDEO (to feed trimmed video for generation)
            // No chaining VIDEO_EDITOR → VIDEO_EDITOR
            if (parentNode.type === NodeType.VIDEO_EDITOR) {
                return childNode.type === NodeType.VIDEO;
            }

            return true;
        };

        // Short click - open menu
        if (dragDuration < 200 && !hoveredTarget) {
            onAddNext(activeStart.nodeId, activeStart.handle);
        }
        // Drag to node - create connection based on target side
        else if (hoveredTarget) {
            if (hoveredTarget.side === 'left') {
                // Connecting to LEFT connector = target receives input (target is child)
                // source is parent, hoveredNode is child
                if (!isValidConnection(activeStart.nodeId, hoveredTarget.nodeId)) {
                    // Invalid connection - reset and return
                    resetConnectionDrag();
                    return true;
                }

                const targetNode = nodes.find(node => node.id === hoveredTarget.nodeId);
                if (!targetNode?.parentIds?.includes(activeStart.nodeId)) {
                    onConnectNodes(activeStart.nodeId, hoveredTarget.nodeId);
                    // Notify about new connection: source is parent, hoveredNode is child
                    onConnectionMade?.(activeStart.nodeId, hoveredTarget.nodeId);
                }
            } else {
                // Connecting to RIGHT connector = target provides output (target is parent)
                // hoveredNode is parent, source is child
                if (!isValidConnection(hoveredTarget.nodeId, activeStart.nodeId)) {
                    // Invalid connection - reset and return
                    resetConnectionDrag();
                    return true;
                }

                const sourceNode = nodes.find(node => node.id === activeStart.nodeId);
                if (!sourceNode?.parentIds?.includes(hoveredTarget.nodeId)) {
                    onConnectNodes(hoveredTarget.nodeId, activeStart.nodeId);
                    // Notify about new connection: hoveredNode is parent, source is child
                    onConnectionMade?.(hoveredTarget.nodeId, activeStart.nodeId);
                }
            }
        }

        // Reset state
        resetConnectionDrag();
        return true;
    };

    /**
     * Handles clicking on a connection line to select it
     */
    const handleEdgeClick = (e: React.MouseEvent, parentId: string, childId: string) => {
        e.stopPropagation();
        setSelectedConnection({ parentId, childId });
    };

    /**
     * Deletes the currently selected connection
     */
    const deleteSelectedConnection = (onDeleteConnection: (parentId: string, childId: string) => void) => {
        if (!selectedConnection) return false;

        onDeleteConnection(selectedConnection.parentId, selectedConnection.childId);
        setSelectedConnection(null);
        return true;
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        isDraggingConnection,
        connectionStart,
        tempConnectionEnd,
        hoveredNodeId,
        selectedConnection,
        setSelectedConnection,
        handleConnectorPointerDown,
        updateConnectionDrag,
        completeConnectionDrag,
        handleEdgeClick,
        deleteSelectedConnection
    };
};
