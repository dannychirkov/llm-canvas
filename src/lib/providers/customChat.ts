import { ApiError, providerError } from "@/lib/apiErrors"
import { providerFetch } from "@/lib/providerRequest"
import { parseTokenUsageFromRawResponse } from "@/lib/tokenParser"
import { convertVideoFramesToImages } from "@/lib/videoAttachmentService"
import type { CsvFileData, ImageData, VideoAttachment } from "@/types"
import type { CustomEndpoint } from "@/lib/providers/customTypes"
import { calculateImageTokens } from "@/lib/tokenCalculator"
import { observeProviderUsage } from "@/lib/usageObservation"
import { MAX_PROVIDER_RESPONSE_BYTES, readProviderJson } from "@/lib/providers/responseBody"
import { customResponses } from "./customResponses"

interface ChatInput {
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

export async function customChat(endpoint: CustomEndpoint & { apiKey: string; headers: Record<string, string> }, input: ChatInput, controller?: ReadableStreamDefaultController<Uint8Array>) {
  if (endpoint.apiType === "comfyui") throw new ApiError("This endpoint runs ComfyUI workflows. Select an image output mode; text chat and summarization are unavailable.")
  if (endpoint.chatApi === "responses") return customResponses(endpoint, input, controller)
  if (typeof input.modelName !== "string" || !input.modelName.trim()) throw new ApiError("Select or enter a model")
  if (typeof input.finalPrompt !== "string" || !input.finalPrompt.trim()) throw new ApiError("Prompt is required")
  const images = [...(input.images ?? []), ...(input.videos?.length ? await convertVideoFramesToImages(input.videos) : [])]
  const csv = (input.csvFiles ?? []).map(file => `\n\nCSV Data from file "${file.filename}":\n${file.csvData}`).join("")
  const prompt = input.finalPrompt + csv
  const payload = {
    model: input.modelName,
    messages: [{ role: "user", content: images.length ? [{ type: "text", text: prompt }, ...images.map(image => ({ type: "image_url", image_url: { url: image.dataUrl } }))] : prompt }],
    ...(controller ? { stream: true, stream_options: { include_usage: true } } : {}),
    ...(input.temperature !== undefined ? { temperature: Number(input.temperature) } : {}),
    ...(input.top_p !== undefined ? { top_p: Number(input.top_p) } : {}),
    ...(input.max_tokens !== undefined ? { max_tokens: Number(input.max_tokens) } : {}),
    ...(input.seed !== undefined ? { seed: Number(input.seed) } : {})
  }
  const response = await providerFetch(endpoint.baseUrl + "/chat/completions", { method: "POST", headers: { ...endpoint.headers, "Content-Type": "application/json" }, body: JSON.stringify(payload) })
  if (!response.ok) throw new ApiError(providerError(response.status), 502)
  let fullResponse = ""
  let rawResponse = ""
  let usage: ReturnType<typeof parseTokenUsageFromRawResponse> = null
  const emit = (value: unknown) => controller?.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`))
  if (!controller) {
    const json = await readProviderJson(response) as { choices?: Array<{ message?: { content?: string } }>; error?: unknown }
    if (json.error) throw new ApiError("Provider request failed", 502)
    fullResponse = json.choices?.[0]?.message?.content ?? ""
    rawResponse = JSON.stringify(json)
    usage = parseTokenUsageFromRawResponse(rawResponse, "openai")
  } else {
    if (!response.body) throw new ApiError("Provider returned no stream", 502)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let completed = false
    let bytes = 0
    let finishedReason = false
    const processLine = (line: string) => {
      if (!line.startsWith("data:")) return
      const data = line.slice(5).trim()
      if (data === "[DONE]") { completed = true; return }
      if (!data) return
      let parsed: { choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>; usage?: unknown; error?: unknown }
      try { parsed = JSON.parse(data) } catch { throw new ApiError("Provider returned malformed stream data", 502) }
      if (parsed.error) throw new ApiError("Provider request failed", 502)
      rawResponse += data + "\n"
      if (parsed.usage) usage = parseTokenUsageFromRawResponse(data, "openai")
      if (parsed.choices?.some(choice => typeof choice.finish_reason === "string" && choice.finish_reason.length > 0)) finishedReason = true
      const content = parsed.choices?.[0]?.delta?.content
      if (typeof content === "string") { fullResponse += content; emit({ content }) }
    }
    try {
      while (!completed) {
        const chunk = await reader.read()
        bytes += chunk.value?.byteLength ?? 0
        if (bytes > MAX_PROVIDER_RESPONSE_BYTES) throw new ApiError("Provider response exceeds the 32 MiB limit", 502)
        buffer += decoder.decode(chunk.value, { stream: !chunk.done })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) { processLine(line); if (completed) break }
        if (chunk.done) { if (buffer && !completed) processLine(buffer); break }
      }
      if (!completed && !finishedReason) throw new ApiError("Provider stream ended before completion", 502)
    } catch (failure) {
      const observed = usage as ReturnType<typeof parseTokenUsageFromRawResponse>
      if (observed) await observeProviderUsage({ tokens: observed.totalTokens, tokenBreakdown: observed, usageSource: "provider" }, prompt)
      throw failure
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
  const result = {
    responseText: fullResponse, fullResponse,
    tokens: usage?.totalTokens ?? Math.ceil((prompt.length + fullResponse.length) / 4) + calculateImageTokens(images.map(image => ({ width: image.width || 1024, height: image.height || 1024, mimeType: image.mimeType })), "openai"),
    tokenBreakdown: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, cachedTokens: usage.cachedTokens, audioTokens: usage.audioTokens, videoTokens: usage.videoTokens, imageTokens: usage.imageTokens } : null,
    usageSource: usage ? "provider" as const : "estimated" as const,
    rawResponse, providerRequestPayload: payload
  }
  await observeProviderUsage(result, prompt)
  if (controller) emit({ done: true, ...result })
  return result
}
