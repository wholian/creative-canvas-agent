import { useEffect, useMemo, useRef } from 'react';
import type { NodeData, Viewport } from '../types.ts';
import type { CanvasProject, LegacyMigrationWarning } from '../canvas-domain/index.ts';
import { adaptLegacyReactCanvas } from '../canvas-adapters/legacyReactCanvasAdapter.ts';

export interface CanvasDomainMirror {
    project: CanvasProject;
    warnings: LegacyMigrationWarning[];
    summary: {
        legacyNodeCount: number;
        domainNodeCount: number;
        domainConnectionCount: number;
        warningCount: number;
    };
}

declare global {
    interface Window {
        __CREATIVE_CANVAS_DOMAIN_MIRROR__?: CanvasDomainMirror;
    }
}

export interface UseCanvasDomainMirrorOptions {
    nodes: NodeData[];
    viewport: Viewport;
    title: string;
    enabled?: boolean;
}

export function useCanvasDomainMirror({
    nodes,
    viewport,
    title,
    enabled = import.meta.env.DEV,
}: UseCanvasDomainMirrorOptions): CanvasDomainMirror | null {
    const projectId = useRef(`live-canvas-${crypto.randomUUID()}`).current;
    const mirrorTimestamp = useRef(new Date().toISOString()).current;
    const mirror = useMemo(() => {
        if (!enabled) return null;
        const result = adaptLegacyReactCanvas({ id: projectId, title, nodes, viewport }, mirrorTimestamp);
        return {
            project: result.project,
            warnings: result.warnings,
            summary: {
                legacyNodeCount: nodes.length,
                domainNodeCount: result.project.nodes.length,
                domainConnectionCount: result.project.connections.length,
                warningCount: result.warnings.length,
            },
        };
    }, [enabled, mirrorTimestamp, nodes, projectId, title, viewport]);

    useEffect(() => {
        if (!enabled || !mirror) return;
        window.__CREATIVE_CANVAS_DOMAIN_MIRROR__ = mirror;
        return () => {
            if (window.__CREATIVE_CANVAS_DOMAIN_MIRROR__ === mirror) {
                delete window.__CREATIVE_CANVAS_DOMAIN_MIRROR__;
            }
        };
    }, [enabled, mirror]);

    return mirror;
}
