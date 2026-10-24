import type { Node, Edge } from "reactflow"

export interface ExecutionGraph { nodes: Node[]; edges: Edge[] }

const runnable = new Set(["openai", "gemini", "openrouter", "custom", "nanobanana", "summarizer"])

/** Only selected executable nodes run. Hidden branches follow context traversal rules. */
export async function runSelectedGraph(
  ids: string[], graph: ExecutionGraph,
  run: (id: string, graph: ExecutionGraph) => Promise<void>,
): Promise<void> {
  const nodeMap = new Map(graph.nodes.map(node => [node.id, node]))
  const selected = new Set(ids.filter(id => runnable.has(nodeMap.get(id)?.type ?? "")))
  const parents = new Map<string, string[]>()
  for (const edge of graph.edges) parents.set(edge.target, [...(parents.get(edge.target) ?? []), edge.source])
  const dependencies = new Map<string, Set<string>>()
  for (const id of selected) {
    const visited = new Set<string>()
    const ancestors = new Set<string>()
    const visit = (current: string) => {
      if (visited.has(current)) return
      visited.add(current)
      const node = nodeMap.get(current)
      if (!node || node.data?.hidden) return
      if (current !== id && selected.has(current)) ancestors.add(current)
      for (const parent of parents.get(current) ?? []) {
        // An edge back to the starting node is a real cycle, not a dependency on its old reply.
        if (parent === id && !nodeMap.get(id)?.data?.hidden) ancestors.add(id)
        visit(parent)
      }
    }
    visit(id)
    dependencies.set(id, ancestors)
  }
  // Validate the whole plan before making any paid requests.
  const remaining = new Set(selected)
  const layers: string[][] = []
  while (remaining.size) {
    const ready = [...remaining].filter(id => [...dependencies.get(id)!].every(parent => !remaining.has(parent)))
    if (!ready.length) throw new Error("Selected nodes contain a dependency cycle. Run cyclic nodes individually.")
    layers.push(ready)
    for (const id of ready) remaining.delete(id)
  }
  const failed = new Set<string>()
  for (const layer of layers) {
    // Independent branches may run together, with a small bound on simultaneous requests.
    for (let start = 0; start < layer.length; start += 3) {
      await Promise.all(layer.slice(start, start + 3).map(async id => {
        if ([...dependencies.get(id)!].some(parent => failed.has(parent))) { failed.add(id); return }
        await run(id, graph)
        if (graph.nodes.find(node => node.id === id)?.data?.status !== "done") failed.add(id)
      }))
    }
  }
  if (failed.size) throw new Error("Some selected nodes failed or were skipped because an upstream node did not complete.")
}
