import type { ProviderId } from "@/lib/providers/registry"
import { tokenCount } from "@/lib/tokenUsage"

export interface ParsedTokenUsage {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  cachedTokens?: number
  audioTokens?: number
  videoTokens?: number
  imageTokens?: number
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function objects(raw: string): Record<string, unknown>[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return (Array.isArray(parsed) ? parsed : [parsed]).map(record)
  } catch {}
  return raw.split("\n").flatMap(line => {
    try { return [record(JSON.parse(line.replace(/^data:\s*/, "").trim()))] } catch { return [] }
  })
}

export function parseTokenUsageFromRawResponse(rawResponse: string, provider?: ProviderId): ParsedTokenUsage | null {
  if (!rawResponse) return null
  for (const payload of objects(rawResponse).reverse()) {
    if (payload.usageMetadata && (!provider || provider === "gemini" || provider === "nanobanana")) {
      const usage = record(payload.usageMetadata)
      if (tokenCount(usage.totalTokenCount) === undefined && (tokenCount(usage.promptTokenCount) === undefined || tokenCount(usage.candidatesTokenCount) === undefined)) continue
      const inputTokens = tokenCount(usage.promptTokenCount) ?? 0
      const candidatesTokens = tokenCount(usage.candidatesTokenCount) ?? 0
      const reasoningTokens = tokenCount(usage.thoughtsTokenCount)
      const outputTokens = candidatesTokens + (provider === "nanobanana" ? reasoningTokens ?? 0 : 0)
      return { inputTokens, outputTokens, reasoningTokens, totalTokens: tokenCount(usage.totalTokenCount) ?? inputTokens + candidatesTokens + (reasoningTokens ?? 0), cachedTokens: tokenCount(usage.cachedContentTokenCount) }
    }
    if (payload.usage) {
      const usage = record(payload.usage)
      if (tokenCount(usage.total_tokens) === undefined && (tokenCount(usage.prompt_tokens ?? usage.input_tokens) === undefined || tokenCount(usage.completion_tokens ?? usage.output_tokens) === undefined)) continue
      const inputTokens = tokenCount(usage.prompt_tokens ?? usage.input_tokens) ?? 0
      const outputTokens = tokenCount(usage.completion_tokens ?? usage.output_tokens) ?? 0
      const inputDetails = record(usage.prompt_tokens_details ?? usage.input_tokens_details)
      const outputDetails = record(usage.completion_tokens_details ?? usage.output_tokens_details)
      return {
        inputTokens, outputTokens,
        totalTokens: tokenCount(usage.total_tokens) ?? inputTokens + outputTokens,
        reasoningTokens: tokenCount(usage.reasoning_tokens ?? outputDetails.reasoning_tokens),
        cachedTokens: tokenCount(inputDetails.cached_tokens ?? usage.cached_tokens),
        audioTokens: (tokenCount(inputDetails.audio_tokens) ?? 0) + (tokenCount(outputDetails.audio_tokens) ?? 0) || undefined,
        videoTokens: tokenCount(inputDetails.video_tokens),
        imageTokens: (tokenCount(inputDetails.image_tokens) ?? 0) + (tokenCount(outputDetails.image_tokens) ?? 0) || undefined
      }
    }
  }
  return null
}
