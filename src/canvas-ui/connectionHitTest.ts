export interface ConnectionHoverTarget {
    nodeId: string;
    side: 'left' | 'right';
}

export interface ConnectionHoverCandidate {
    sourceNodeId: string;
    pointerX: number;
    connector?: { nodeId: string; side: 'left' | 'right' };
    node?: { nodeId: string; left: number; width: number };
}

/** Resolve a drop target from the real rendered connector/card under the pointer. */
export function resolveConnectionHoverTarget(candidate: ConnectionHoverCandidate): ConnectionHoverTarget | null {
    if (candidate.connector && candidate.connector.nodeId !== candidate.sourceNodeId) {
        return { nodeId: candidate.connector.nodeId, side: candidate.connector.side };
    }
    if (!candidate.node || candidate.node.nodeId === candidate.sourceNodeId) return null;
    return {
        nodeId: candidate.node.nodeId,
        side: candidate.pointerX < candidate.node.left + candidate.node.width / 2 ? 'left' : 'right',
    };
}
