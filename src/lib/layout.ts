import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 96;
export const FRAME_PADDING = 28;
export const FRAME_HEADER = 30;

/**
 * Auto layout (top-down tree) for all nodes without a manual position.
 * Manually placed nodes keep their stored position.
 */
export function layoutGraph(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  // Spacing larger than the card footprint so auto-laid-out cards never touch
  g.setGraph({ rankdir: "TB", nodesep: 64, ranksep: 96 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  return nodes.map((n) => {
    if (n.data && (n.data as any).manualPosition) return n;
    const pos = g.node(n.id);
    return {
      ...n,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    };
  });
}
