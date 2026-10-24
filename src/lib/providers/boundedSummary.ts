import { ApiError } from "@/lib/apiErrors"
import { determineStrategy, generatePrompt, getMapReducePrompt, getRefinePrompt, splitTextIntoChunks } from "@/lib/smartSummarizer"
import type { RequestOptions, SummaryLength, SummaryStyle } from "@/types"
import type { UsageBreakdown } from "@/lib/tokenUsage"

export interface SummaryResult {
  responseText: string
  tokens?: number
  tokenBreakdown?: UsageBreakdown | null
  usageSource?: "provider" | "estimated" | "unreported"
}

export async function boundedSummary(input: { text: string; modelName: string; summaryLength?: SummaryLength; summaryStyle?: SummaryStyle } & RequestOptions, contextWindow: number, request: (prompt: string, outputLimit: number) => Promise<SummaryResult>, progress?: (value: unknown) => void) {
  if (typeof input.text !== "string" || !input.text.trim()) throw new ApiError("Text to summarize is required")
  if (input.text.length > 2_000_000) throw new ApiError("Summary input exceeds the 2000000-character limit", 413)
  if (!Number.isSafeInteger(contextWindow) || contextWindow < 128) throw new ApiError("Invalid model context window")
  if (input.max_tokens !== undefined && (!Number.isSafeInteger(input.max_tokens) || input.max_tokens < 1)) throw new ApiError("Maximum output tokens must be a positive integer")
  if (input.temperature !== undefined && (input.temperature < 0 || input.temperature > 2)) throw new ApiError("Temperature must be between zero and two")
  if (input.top_p !== undefined && (input.top_p < 0 || input.top_p > 1)) throw new ApiError("Top P must be between zero and one")
  const length = input.summaryLength ?? "medium"
  const style = input.summaryStyle ?? "key-ideas"
  if (!["brief", "medium", "detailed"].includes(length) || !["key-ideas", "preserve-details", "structured"].includes(style)) throw new ApiError("Invalid summary settings")
  const outputLimit = Math.max(1, Math.min(input.max_tokens ?? Math.min(1024, Math.floor(contextWindow * 0.2)), Math.floor(contextWindow / 2)))
  const promptLimit = Math.max(1, (contextWindow - outputLimit - 32) * 4)
  let calls = 0
  let tokens = 0
  let usageSource: "provider" | "estimated" | "unreported" = "provider"
  const tokenBreakdown: UsageBreakdown = {}
  const run = async (prompt: string) => {
    if (prompt.length > promptLimit) throw new ApiError("Summary request exceeds the model input budget; use a larger-context model", 413)
    if (++calls > 128) throw new ApiError("Summary exceeded the 128-request work budget", 413)
    const result = await request(prompt, outputLimit)
    tokens += result.tokens ?? 0
    if (result.usageSource === "unreported" || result.tokens === undefined) usageSource = tokens > 0 ? "estimated" : "unreported"
    else if (result.usageSource === "estimated" || usageSource === "unreported") usageSource = "estimated"
    for (const field of ["inputTokens", "outputTokens", "reasoningTokens", "cachedTokens", "audioTokens", "videoTokens", "imageTokens"] as const) {
      if (result.tokenBreakdown?.[field] !== undefined) tokenBreakdown[field] = (tokenBreakdown[field] ?? 0) + result.tokenBreakdown[field]!
    }
    return result.responseText
  }
  const textLength = Math.ceil(input.text.length / 4)
  let strategy = determineStrategy(textLength, contextWindow, style)
  const singlePrompt = generatePrompt(input.text, length, style)
  if (strategy === "single" && singlePrompt.length > promptLimit) strategy = style === "preserve-details" ? "map-reduce" : "refine"
  progress?.({ type: "strategy", strategy, contextWindow, textLength })
  let responseText = ""
  if (strategy === "single") responseText = await run(singlePrompt)
  else {
    const mapHeader = getMapReducePrompt(style, false)
    const reduceHeader = getMapReducePrompt(style, true)
    const refineHeader = getRefinePrompt(style, true)
    const headerLimit = Math.max(mapHeader.length, reduceHeader.length, refineHeader.length) + 100
    const chunkLimit = Math.floor((promptLimit - headerLimit - outputLimit * 4) / 2)
    if (chunkLimit < 16) throw new ApiError("Model context is too small for summarization instructions", 413)
    const chunks = splitTextIntoChunks(input.text, chunkLimit)
    if (chunks.length > 64) throw new ApiError("Too many summary chunks; select a larger-context model", 413)
    if (strategy === "map-reduce") {
      let summaries: string[] = []
      for (const [index, chunk] of chunks.entries()) {
        summaries.push(await run(mapHeader + "\n\n" + chunk))
        progress?.({ type: "progress", stage: "map", totalChunks: chunks.length, currentChunk: index + 1 })
      }
      while (reduceHeader.length + 2 + summaries.join("\n\n").length > promptLimit) {
        const groups: string[][] = []
        for (const summary of summaries) {
          const current = groups.at(-1)
          if (!current || reduceHeader.length + 2 + [...current, summary].join("\n\n").length > promptLimit) groups.push([summary])
          else current.push(summary)
        }
        const compressed: string[] = []
        for (const group of groups) compressed.push(await run(reduceHeader + "\n\n" + group.join("\n\n")))
        if (compressed.join("\n\n").length >= summaries.join("\n\n").length) throw new ApiError("Provider did not compress summaries enough to fit the context budget", 502)
        summaries = compressed
        progress?.({ type: "progress", stage: "reduce", totalChunks: groups.length, currentChunk: groups.length })
      }
      responseText = await run(reduceHeader + "\n\n" + summaries.join("\n\n"))
    } else {
      for (const [index, chunk] of chunks.entries()) {
        responseText = await run(getRefinePrompt(style, index > 0) + "\n\n" + (responseText ? `Current summary:\n${responseText}\n\n` : "") + "New text chunk:\n" + chunk)
        progress?.({ type: "progress", stage: "refine", totalChunks: chunks.length, currentChunk: index + 1 })
      }
    }
  }
  progress?.({ type: "content", content: responseText })
  return { responseText, tokens, tokenBreakdown, usageSource, strategy, contextWindow, textLength, requests: calls }
}
