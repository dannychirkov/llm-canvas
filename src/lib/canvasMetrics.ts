import type { Node, Edge } from "reactflow"
import { calculateTokenPreview } from "@/lib/tokenPreviewCalculator"
import { isProviderId } from "@/lib/providers/registry"
import { ApiError } from "@/lib/apiErrors"
import { tokenCount } from "@/lib/tokenUsage"

export interface CanvasDocument extends Record<string, unknown> {
  nodes: Node[]
  edges: Edge[]
}

export function parseCanvasDocument(content: unknown): CanvasDocument {
  if (typeof content !== "string") throw new ApiError("Canvas content must be a JSON string")
  let document: CanvasDocument
  try { document = JSON.parse(content) } catch { throw new ApiError("Invalid canvas JSON") }
  if (!document || typeof document !== "object" || !Array.isArray(document.nodes) || !Array.isArray(document.edges)) throw new ApiError("Canvas must contain nodes and edges arrays")
  const ids = new Set<string>()
  for (const node of document.nodes) {
    if (!node || typeof node.id !== "string" || !node.id || ids.has(node.id) || !node.data || typeof node.data !== "object" || Array.isArray(node.data)) throw new ApiError("Invalid or duplicate canvas node")
    ids.add(node.id)
  }
  for (const edge of document.edges) {
    if (!edge || typeof edge.id !== "string" || typeof edge.source !== "string" || typeof edge.target !== "string") throw new ApiError("Invalid canvas edge")
  }
  return document
}

export async function calculateCanvasMetrics(document: CanvasDocument) {
  let largestContextTokens = 0
  for (const node of document.nodes) {
    if ((!isProviderId(node.type) && node.type !== "summarizer") || node.data.hidden) continue
    const preview = await calculateTokenPreview(node.id, document.nodes, document.edges, node.data.promptText ?? "")
    const provider = node.type === "summarizer" ? node.data.provider : node.type
    const estimate = provider === "gemini" || provider === "nanobanana" ? preview.totalTokens.gemini : preview.totalTokens.openai
    largestContextTokens = Math.max(largestContextTokens, estimate, tokenCount(node.data.tokenBreakdown?.inputTokens) ?? 0)
  }
  return { nodeCount: document.nodes.length, largestContextTokens, contextCacheUpdated: new Date() }
}
