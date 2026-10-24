import type { Node, Edge } from "reactflow"

/** Old clients could persist this drag-only sentinel; do not hide other invalid edges. */
export function persistentCanvasEdges(nodes: Node[], edges: Edge[]): Edge[] {
  const ids = new Set(nodes.map(node => node.id))
  return edges.filter(edge => !(edge.id === "temp-edge" && (
    edge.target === "temp-target" && !ids.has(edge.target) ||
    edge.source === "temp-source" && !ids.has(edge.source)
  )))
}
