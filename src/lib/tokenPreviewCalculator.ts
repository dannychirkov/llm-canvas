import type { Node, Edge } from "reactflow"
import type { TokenProviderId } from "@/lib/providers/registry"
import { assembleContext, getConnectedMediaNodes } from "./contextService"
import { calculateTokensForBothProviders, calculateTextTokens, formatTokenCount, type TokenCalculationResult } from "./tokenCalculator"
import { nodeOperator, usageTotal } from "./tokenUsage"
import { videoFrameList } from "./videoFrameMetadata"
import type { VideoFrameDescriptor } from "@/types"
import { appendCsvContext, limitCsvRows } from "./csvContext"

export interface TokenPreviewResult {
  contextTokens: { openai: TokenCalculationResult; gemini: TokenCalculationResult }
  promptTokens: { openai: number; gemini: number }
  executedTokens: { openai: number; gemini: number }
  totalTokens: { openai: number; gemini: number }
  breakdown: { openai: string; gemini: string }
}

function chainUsage(targetNodeId: string, nodes: Node[], edges: Edge[]): number {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const parents = new Map<string, string[]>()
  for (const edge of edges) parents.set(edge.target, [...(parents.get(edge.target) ?? []), edge.source])
  const visited = new Set<string>()
  const visit = (id: string): number => {
    if (visited.has(id)) return 0
    visited.add(id)
    const node = byId.get(id)
    if (!node || node.data.hidden) return 0
    const own = id !== targetNodeId && node.data.status === "done" && nodeOperator(node) ? usageTotal(node.data.tokens, node.data.tokenBreakdown, nodeOperator(node) ?? undefined) : 0
    return own + (parents.get(id) ?? []).reduce((total, parent) => total + visit(parent), 0)
  }
  return visit(targetNodeId)
}

export async function calculateTokenPreview(targetNodeId: string, nodes: Node[], edges: Edge[], promptText = ""): Promise<TokenPreviewResult> {
  const inputs = nodes.map(node => node.id === targetNodeId ? { ...node, data: { ...node.data, responseText: "", generatedImage: undefined, status: "idle" } } : node)
  const text = assembleContext(targetNodeId, inputs, edges)
  const media = getConnectedMediaNodes(targetNodeId, inputs, edges)
  const images = media.filter(node => node.data.mimeType?.startsWith("image/") || node.data.generatedImage).map(node => {
    const image = node.data.generatedImage ?? node.data
    return { width: image.width || 1024, height: image.height || 1024, mimeType: image.mimeType || "image/png" }
  })
  const videos = media.filter(node => node.data.mimeType?.startsWith("video/"))
  const videoFrames = videos.flatMap(node => videoFrameList<VideoFrameDescriptor>(node.data.videoFrames).map(frame => ({ width: frame.width || 1024, height: frame.height || 1024, mimeType: frame.mimeType || "image/jpeg" })))
  const csvFiles = media.filter(node => node.data.mimeType === "text/csv").map(node => ({
    id: node.data.mediaId,
    filename: node.data.filename || "CSV attachment",
    csvData: limitCsvRows(node.data.csvData ?? "", node.data.csvLimitEnabled, node.data.csvMaxRows),
    csvRows: node.data.csvRows,
    csvColumns: node.data.csvColumns,
    caption: node.data.caption
  }))
  const contextTokens = calculateTokensForBothProviders({ text: appendCsvContext(text, csvFiles), images, videoFrames, videoDurationMs: videos.reduce((sum, node) => sum + (node.data.durationMs ?? 0), 0) })
  const prompt = calculateTextTokens(promptText)
  const executed = chainUsage(targetNodeId, nodes, edges)
  const totalTokens = { openai: contextTokens.openai.totalTokens + prompt, gemini: contextTokens.gemini.totalTokens + prompt }
  const describe = (provider: TokenProviderId) => `Context: ${formatTokenCount(contextTokens[provider].totalTokens)}, Prompt: ${formatTokenCount(prompt)}, This request (estimated): ${formatTokenCount(totalTokens[provider])}, Chain history: ${formatTokenCount(executed)}`
  return { contextTokens, promptTokens: { openai: prompt, gemini: prompt }, executedTokens: { openai: executed, gemini: executed }, totalTokens, breakdown: { openai: describe("openai"), gemini: describe("gemini") } }
}

export async function calculateContextTokens(targetNodeId: string, nodes: Node[], edges: Edge[]): Promise<{ openai: number; gemini: number }> {
  const preview = await calculateTokenPreview(targetNodeId, nodes, edges)
  return { openai: preview.contextTokens.openai.totalTokens, gemini: preview.contextTokens.gemini.totalTokens }
}

export function calculatePromptTokens(promptText: string): { openai: number; gemini: number } {
  const total = calculateTextTokens(promptText)
  return { openai: total, gemini: total }
}

export const calculateTextOnlyTokenPreview = calculateTokenPreview

export function formatTokenPreview(preview: TokenPreviewResult, provider: TokenProviderId): string {
  return `${formatTokenCount(preview.totalTokens[provider])} (Context: ${formatTokenCount(preview.contextTokens[provider].totalTokens)}, Prompt: ${formatTokenCount(preview.promptTokens[provider])})`
}
