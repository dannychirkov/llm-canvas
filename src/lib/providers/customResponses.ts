import { ApiError, providerError, publicError } from "@/lib/apiErrors"
import { providerFetch } from "@/lib/providerRequest"
import { parseTokenUsageFromRawResponse } from "@/lib/tokenParser"
import { calculateImageTokens } from "@/lib/tokenCalculator"
import { observeProviderUsage } from "@/lib/usageObservation"
import { convertVideoFramesToImages } from "@/lib/videoAttachmentService"
import { MAX_PROVIDER_RESPONSE_BYTES, readProviderJson } from "@/lib/providers/responseBody"
import type { CsvFileData, ImageData, VideoAttachment } from "@/types"

interface ResponsesInput {
  finalPrompt?: string
  modelName?: string
  images?: ImageData[]
  videos?: VideoAttachment[]
  csvFiles?: CsvFileData[]
  temperature?: number
  top_p?: number
  max_tokens?: number
  seed?: number
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

// Responses output is an array of typed items, not a Chat Completions choice.
function completedText(response: Record<string, unknown>): string {
  if (response.error || response.status === "failed") throw new ApiError("Provider request failed", 502)
  if (response.status === "incomplete") throw new ApiError("Provider response was incomplete", 502)
  if (response.status !== "completed") throw new ApiError("Provider response did not complete", 502)
  const parts = (Array.isArray(response.output) ? response.output : []).flatMap(item => {
    const message = record(item)
    return message.type === "message" && Array.isArray(message.content) ? message.content.map(record) : []
  })
  if (parts.some(part => part.type === "refusal")) throw new ApiError("Provider refused the request", 502)
  const text = parts.filter(part => part.type === "output_text")
  if (!text.length || text.some(part => typeof part.text !== "string")) throw new ApiError("Provider returned no text response", 502)
  return text.map(part => part.text as string).join("")
}

export async function customResponses(
  endpoint: { baseUrl: string; headers: Record<string, string> },
  input: ResponsesInput,
  controller?: ReadableStreamDefaultController<Uint8Array>
) {
  if (typeof input.modelName !== "string" || !input.modelName.trim()) throw new ApiError("Select or enter a model")
  if (typeof input.finalPrompt !== "string" || !input.finalPrompt.trim()) throw new ApiError("Prompt is required")
  if (input.seed !== undefined) throw new ApiError("Seed is not supported by the Responses API")
  const images = [...(input.images ?? []), ...(input.videos?.length ? await convertVideoFramesToImages(input.videos) : [])]
  const csv = (input.csvFiles ?? []).map(file => `\n\nCSV Data from file "${file.filename}":\n${file.csvData}`).join("")
  const prompt = input.finalPrompt + csv
  const payload = {
    model: input.modelName,
    store: false,
    input: [{ role: "user", content: [
      { type: "input_text", text: prompt },
      ...images.map(image => ({ type: "input_image", image_url: image.dataUrl, detail: "auto" }))
    ] }],
    ...(controller ? { stream: true } : {}),
    ...(input.temperature !== undefined ? { temperature: Number(input.temperature) } : {}),
    ...(input.top_p !== undefined ? { top_p: Number(input.top_p) } : {}),
    ...(input.max_tokens !== undefined ? { max_output_tokens: Number(input.max_tokens) } : {})
  }
  let fullResponse = ""
  let rawResponse = ""
  let usage: ReturnType<typeof parseTokenUsageFromRawResponse> = null
  let observed = false
  const encoder = new TextEncoder()
  const emit = (value: unknown) => controller?.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
  const captureUsage = (response: Record<string, unknown>) => {
    usage = parseTokenUsageFromRawResponse(JSON.stringify(response), "openai") ?? usage
  }

  try {
    const response = await providerFetch(endpoint.baseUrl.replace(/\/+$/, "") + "/responses", {
      method: "POST", headers: { ...endpoint.headers, "Content-Type": "application/json" }, body: JSON.stringify(payload)
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw new ApiError(providerError(response.status), 502)
    }
    if (!controller) {
      const json = record(await readProviderJson(response))
      rawResponse = JSON.stringify(json)
      captureUsage(json)
      fullResponse = completedText(json)
    } else {
      if (Number(response.headers.get("content-length")) > MAX_PROVIDER_RESPONSE_BYTES) {
        await response.body?.cancel().catch(() => {})
        throw new ApiError("Provider response exceeds the 32 MiB limit", 502)
      }
      if (!response.body) throw new ApiError("Provider returned no stream", 502)
      const reader = response.body.getReader()
      const decoder = new TextDecoder("utf-8", { fatal: true })
      let buffer = ""
      let data: string[] = []
      let bytes = 0
      let completed = false
      let refused = false

      const dispatch = () => {
        if (!data.length) return
        const text = data.join("\n")
        data = []
        let event: Record<string, unknown>
        try {
          const parsed: unknown = JSON.parse(text)
          event = record(parsed)
          if (typeof event.type !== "string") throw new Error("Missing event type")
        } catch { throw new ApiError("Provider returned malformed stream data", 502) }
        rawResponse += text + "\n"
        captureUsage(record(event.response))
        if (event.error || event.type === "error" || event.type === "response.failed") throw new ApiError("Provider request failed", 502)
        if (event.type === "response.incomplete") throw new ApiError("Provider response was incomplete", 502)
        if (event.type === "response.refusal.delta" || event.type === "response.refusal.done") refused = true
        if (event.type === "response.output_text.delta") {
          if (typeof event.delta !== "string") throw new ApiError("Provider returned malformed stream data", 502)
          fullResponse += event.delta
          emit({ content: event.delta })
        }
        if (event.type === "response.completed") {
          if (refused) throw new ApiError("Provider refused the request", 502)
          const finalText = completedText(record(event.response))
          // A final snapshot may supply text omitted by a compatible server's deltas.
          if (!finalText.startsWith(fullResponse)) throw new ApiError("Provider returned inconsistent response text", 502)
          const remainder = finalText.slice(fullResponse.length)
          fullResponse = finalText
          if (remainder) emit({ content: remainder })
          completed = true
        }
      }
      const line = (value: string) => {
        if (!value) { dispatch(); return }
        if (value.startsWith("data:")) data.push(value.slice(5).replace(/^ /, ""))
      }
      const consume = (text: string, eof: boolean) => {
        buffer += text
        let start = 0
        for (let index = 0; index < buffer.length && !completed; index++) {
          const char = buffer[index]
          if (char !== "\r" && char !== "\n") continue
          if (char === "\r" && index === buffer.length - 1 && !eof) break
          line(buffer.slice(start, index))
          if (char === "\r" && buffer[index + 1] === "\n") index++
          start = index + 1
        }
        buffer = buffer.slice(start)
      }
      try {
        while (!completed) {
          const chunk = await reader.read()
          bytes += chunk.value?.byteLength ?? 0
          if (bytes > MAX_PROVIDER_RESPONSE_BYTES) throw new ApiError("Provider response exceeds the 32 MiB limit", 502)
          let text: string
          try { text = decoder.decode(chunk.value, { stream: !chunk.done }) } catch { throw new ApiError("Provider returned invalid UTF-8", 502) }
          consume(text, chunk.done)
          if (chunk.done) break
        }
        if (!completed) throw new ApiError("Provider stream ended before completion", 502)
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    }
    // Callback assignments above are deliberately synchronous; keep the parsed usage type here.
    const finalUsage = usage as ReturnType<typeof parseTokenUsageFromRawResponse>
    const result = {
      responseText: fullResponse, fullResponse,
      tokens: finalUsage?.totalTokens ?? Math.ceil((prompt.length + fullResponse.length) / 4) + calculateImageTokens(images.map(image => ({ width: image.width || 1024, height: image.height || 1024, mimeType: image.mimeType })), "openai"),
      tokenBreakdown: finalUsage ? { inputTokens: finalUsage.inputTokens, outputTokens: finalUsage.outputTokens, reasoningTokens: finalUsage.reasoningTokens, cachedTokens: finalUsage.cachedTokens, audioTokens: finalUsage.audioTokens, videoTokens: finalUsage.videoTokens, imageTokens: finalUsage.imageTokens } : null,
      usageSource: finalUsage ? "provider" as const : "estimated" as const,
      rawResponse, providerRequestPayload: payload
    }
    observed = true
    await observeProviderUsage(result, prompt)
    if (controller) emit({ done: true, ...result })
    return result
  } catch (failure) {
    const partialUsage = usage as ReturnType<typeof parseTokenUsageFromRawResponse>
    if (partialUsage && !observed) {
      await observeProviderUsage({ tokens: partialUsage.totalTokens, tokenBreakdown: partialUsage, usageSource: "provider" }, prompt)
    }
    throw failure instanceof ApiError ? failure : new ApiError(publicError(failure), 502)
  }
}
