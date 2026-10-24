import type { Prisma } from "@prisma/client"
import { ApiError } from "@/lib/apiErrors"

export interface CanonicalNode extends Record<string, unknown> {
  id: string
  type?: string
  position?: { x: number; y: number }
  data: Record<string, unknown>
}

export interface CanonicalGraph extends Record<string, unknown> {
  nodes: CanonicalNode[]
  edges: Array<Record<string, unknown> & { id: string; source: string; target: string }>
}

export function parseCanonicalGraph(content: unknown): CanonicalGraph {
  let graph: CanonicalGraph
  try { graph = typeof content === "string" ? JSON.parse(content) : content } catch { throw new ApiError("Invalid canvas JSON") }
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new ApiError("Canvas must contain nodes and edges arrays")
  const nodeIds = new Set<string>()
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== "string" || !node.id || nodeIds.has(node.id) || !node.data || typeof node.data !== "object" || Array.isArray(node.data)) throw new ApiError("Invalid or duplicate canvas node")
    if (node.position && (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))) throw new ApiError("Invalid node position")
    nodeIds.add(node.id)
  }
  const edgeIds = new Set<string>()
  for (const edge of graph.edges) {
    if (!edge || typeof edge.id !== "string" || edgeIds.has(edge.id) || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) throw new ApiError("Invalid canvas edge")
    edgeIds.add(edge.id)
  }
  return graph
}

export async function synchronizeCanvasNodes(tx: Prisma.TransactionClient, canvasId: string, document: unknown): Promise<void> {
  const graph = parseCanonicalGraph(document)
  const ids = graph.nodes.map(node => node.id)
  const conflicts = ids.length ? await tx.node.findMany({ where: { id: { in: ids }, canvasId: { not: canvasId } }, select: { id: true } }) : []
  if (conflicts.length) throw new ApiError("Node identifiers conflict with another canvas", 409)
  await tx.node.deleteMany({ where: { canvasId, id: { notIn: ids } } })
  for (const node of graph.nodes) {
    const data = {
      type: typeof node.type === "string" ? node.type : "unknown",
      position: (node.position ?? { x: 0, y: 0 }) as Prisma.InputJsonValue,
      data: node.data as Prisma.InputJsonValue
    }
    const result = await tx.node.updateMany({ where: { id: node.id, canvasId }, data })
    if (!result.count) await tx.node.create({ data: { id: node.id, canvasId, ...data } })
  }
}

export function remapGraphReferences(value: unknown, replacements: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") {
    const direct = replacements.get(value)
    if (direct !== undefined) return direct
    if (/^[\s]*[\[{]/.test(value)) {
      try { return JSON.stringify(remapGraphReferences(JSON.parse(value), replacements)) } catch { return value }
    }
    return value.replace(/(?:\/api\/media\/serve)?\/(?:uploads\/)?canvases\/[a-zA-Z0-9_-]+\/[^\s"'<>\)\]]+/g, path => replacements.get(path) ?? path)
  }
  if (Array.isArray(value)) return value.map(item => remapGraphReferences(item, replacements))
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapGraphReferences(item, replacements)]))
  return value
}
