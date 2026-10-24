import { isProviderId } from "@/lib/providers/registry"
import type { Node } from "reactflow"

export interface UsageBreakdown {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cachedTokens?: number
  audioTokens?: number
  videoTokens?: number
  imageTokens?: number
}

export interface TokenStatistics {
  [operator: string]: { total: number; models: Record<string, { total: number; categories: UsageBreakdown & { otherTools?: number }; usageSources?: Record<string, number> }> }
}

export function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export function usageTotal(total: unknown, breakdown?: UsageBreakdown | null, provider?: string): number {
  return tokenCount(total) ?? ((tokenCount(breakdown?.inputTokens) ?? 0) + (tokenCount(breakdown?.outputTokens) ?? 0) + (provider === "gemini" ? tokenCount(breakdown?.reasoningTokens) ?? 0 : 0))
}

export function nodeOperator(node: Pick<Node, "type" | "data">): string | null {
  const operator = node.type === "summarizer" ? node.data?.provider : node.type
  return isProviderId(operator) ? operator : null
}

export function aggregateNodeUsage(nodes: Node[]): TokenStatistics {
  const stats: TokenStatistics = Object.create(null)
  for (const node of nodes) {
    if (node.data?.status !== "done") continue
    const operator = nodeOperator(node)
    if (!operator) continue
    const breakdown: UsageBreakdown = node.data.tokenBreakdown ?? {}
    const total = usageTotal(node.data.tokens, breakdown, operator)
    const model = typeof node.data.modelName === "string" && node.data.modelName ? node.data.modelName : "Unknown"
    stats[operator] ??= { total: 0, models: Object.create(null) }
    stats[operator].models[model] ??= { total: 0, categories: {} }
    stats[operator].total += total
    const current = stats[operator].models[model]
    current.total += total
    const source = ["provider", "estimated", "unreported"].includes(node.data.usageSource) ? node.data.usageSource : "legacy"
    current.usageSources ??= Object.create(null)
    current.usageSources![source] = (current.usageSources![source] ?? 0) + 1
    for (const field of ["inputTokens", "outputTokens", "reasoningTokens", "cachedTokens", "audioTokens", "videoTokens", "imageTokens"] as const) {
      const value = tokenCount(breakdown[field]) ?? 0
      if (value) current.categories[field] = (current.categories[field] ?? 0) + value
    }
    const other = Math.max(0, total - usageTotal(undefined, breakdown, operator))
    if (other) current.categories.otherTools = (current.categories.otherTools ?? 0) + other
  }
  return stats
}
