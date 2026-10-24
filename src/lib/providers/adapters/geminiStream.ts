import { observeProviderUsage } from "@/lib/usageObservation"
import { MAX_PROVIDER_RESPONSE_BYTES } from "@/lib/providers/responseBody"
import { readGeminiText } from "@/lib/providers/geminiText"
import type { ImageData, CsvFileData, RequestOptions, GeminiPayload, OpenAIPayload, OpenRouterPayload, NanoBananaPayload, GeneratedImage, VideoAttachment } from "@/types"
import { ApiError, publicError, providerError } from "@/lib/apiErrors"
import { providerFetch } from "@/lib/providerRequest"
import { parseTokenUsageFromRawResponse } from "@/lib/tokenParser"
import { convertVideoFramesToImages, prepareGeminiVideoParts } from "@/lib/videoAttachmentService"
import { providerUrl, providerRegistry } from "@/lib/providers/registry"

export async function handleGeminiStream(controller: ReadableStreamDefaultController, params: {
  apiKey: string
  modelName: string
  finalPrompt: string
  images: ImageData[]
  videos: VideoAttachment[]
  temperature?: number
  top_p?: number
  max_tokens?: number
  useTools?: boolean
}) {
  const { apiKey, modelName, finalPrompt, images, videos, temperature, top_p, max_tokens, useTools = true } = params

  if (!modelName) {
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: "modelName is required" })}\n\n`))
    return
  }

  const modelPath = modelName.startsWith("models/") ? modelName : `models/${modelName}`
  const base = providerRegistry.gemini.defaultBaseUrl

  let videoParts: Array<
    | { inlineData: { mimeType: string; data: string } }
    | { fileData: { fileUri: string; mimeType: string } }
  > = []

  if (videos.length > 0) {
    try {
      videoParts = await prepareGeminiVideoParts(videos, apiKey)
      // Check that processing was successful
      if (videoParts.length === 0) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: "Failed to process video files: no video parts were generated" })}\n\n`))
        return
      }
    } catch (error) {
      const errorMessage = publicError(error)
      console.error({ event: "provider_request_failed" })
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: `Failed to process video files: ${errorMessage}` })}\n\n`))
      return
    }
  }

  const makePayload = (): GeminiPayload => {
    const payload: GeminiPayload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: finalPrompt },
            ...images.map((img: ImageData) => ({
              inlineData: {
                mimeType: img.mimeType,
                data: img.dataUrl.split(',')[1]
              }
            })),
            ...videoParts
          ],
        },
      ]
    }
    // Add tools only if useTools is enabled and no video content (tools don't work with video)
    const hasVideoContent = videos.length > 0 && videoParts.length > 0
    if (useTools && !hasVideoContent) {
      payload.tools = [{
        googleSearch: {}
      }]
    }
    return payload
  }

  const generationConfig: { temperature?: number; topP?: number; maxOutputTokens?: number } = {}
  if (typeof temperature === "number") generationConfig.temperature = temperature
  if (typeof top_p === "number") generationConfig.topP = top_p
  if (typeof max_tokens === "number") generationConfig.maxOutputTokens = max_tokens

  const tries = [
    `${base}/v1beta/${modelPath}:streamGenerateContent`,
    `${base}/v1/${modelPath}:streamGenerateContent`,
  ]

  let lastError = ""
  let providerRequestPayload: Record<string, unknown> | null = null
  for (const url of tries) {
    const payload = makePayload()
    if (Object.keys(generationConfig).length) payload.generationConfig = generationConfig
    providerRequestPayload = JSON.parse(JSON.stringify(payload))

    try {
      const res = await providerFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const reader = res.body?.getReader()
        if (!reader) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: "No response body" })}\n\n`))
          return
        }

        let buffer = ""
        let bytes = 0
        let fullResponse = ""
        let tokens = 0
        let rawResponse = ""
        let completed = false
        let lastUsageMetadata: {
          totalTokenCount?: number
          promptTokenCount?: number
          candidatesTokenCount?: number
          thoughtsTokenCount?: number
          total_tokens?: number
          prompt_tokens?: number
          completion_tokens?: number
          reasoning_tokens?: number
        } | null = null
        let accumulatedGroundingMetadata: { groundingChunks?: unknown[]; searchEntryPoint?: { renderedContent?: string } } | null = null

        // Create TextDecoder once for the entire stream
        const decoder = new TextDecoder('utf-8')

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            bytes += value.byteLength
            if (bytes > MAX_PROVIDER_RESPONSE_BYTES) throw new ApiError("Provider response exceeds the 32 MiB limit", 502)

            // Use the same decoder for the entire stream
            buffer += decoder.decode(value, { stream: true })

            // Parse JSON objects separated by commas
            let processedLength = 0

            while (buffer.length > 0) {
              let jsonStart = -1
              let braceCount = 0
              let inString = false
              let escapeNext = false
              let foundComplete = false

              for (let i = 0; i < buffer.length; i++) {
                const char = buffer[i]

                if (escapeNext) {
                  escapeNext = false
                  continue
                }

                if (char === '\\' && inString) {
                  escapeNext = true
                  continue
                }

                if (char === '"' && !escapeNext) {
                  inString = !inString
                  continue
                }

                if (!inString) {
                  if (char === '{') {
                    if (braceCount === 0) jsonStart = i
                    braceCount++
                  } else if (char === '}') {
                    braceCount--
                    if (braceCount === 0 && jsonStart >= 0) {
                      // Found complete JSON object
                      const jsonStr = buffer.substring(jsonStart, i + 1)
                      try {
                        const parsed = JSON.parse(jsonStr)
                        if (parsed.candidates?.some((candidate: { finishReason?: string }) => candidate.finishReason)) completed = true
                        rawResponse += jsonStr + "\n"

                        // Track usage metadata
                        if (parsed.usageMetadata) {
                          lastUsageMetadata = parsed.usageMetadata
                        }

                        // Track grounding metadata
                        if (parsed.candidates?.[0]?.groundingMetadata) {
                          accumulatedGroundingMetadata = parsed.candidates[0].groundingMetadata
                        }

                        const content = readGeminiText(parsed)
                        if (content) {
                          fullResponse += content
                          tokens++
                          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ content })}\n\n`))
                        }
                        processedLength = i + 1
                        foundComplete = true
                        break
                      } catch (e) {
                        // Ignore invalid JSON
                      }
                    }
                  }
                }
              }

              if (!foundComplete) break

              // Remove processed part
              buffer = buffer.substring(processedLength)
              processedLength = 0
            }
          }

          // Final decode for remaining data
          const finalText = decoder.decode()
          if (finalText) {
            buffer += finalText
          }
        } catch (failure) {
          const observed = parseTokenUsageFromRawResponse(rawResponse, "gemini")
          if (observed) await observeProviderUsage({ tokens: observed.totalTokens, tokenBreakdown: observed, usageSource: "provider" }, finalPrompt)
          throw failure
        } finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
        if (!completed) {
          const observed = parseTokenUsageFromRawResponse(rawResponse, "gemini")
          if (observed) await observeProviderUsage({ tokens: observed.totalTokens, tokenBreakdown: observed, usageSource: "provider" }, finalPrompt)
          throw new ApiError("Provider stream ended before completion", 502)
        }

        const parsedTokens = parseTokenUsageFromRawResponse(rawResponse, "gemini")
        const finalTokens = parsedTokens?.totalTokens ?? Math.ceil((finalPrompt.length + fullResponse.length) / 4)
        const tokenBreakdown = parsedTokens ? { inputTokens: parsedTokens.inputTokens, outputTokens: parsedTokens.outputTokens, reasoningTokens: parsedTokens.reasoningTokens, cachedTokens: parsedTokens.cachedTokens } : null
        const usageSource = parsedTokens ? "provider" : "estimated"
        await observeProviderUsage({ tokens: finalTokens, tokenBreakdown, usageSource }, finalPrompt)

        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
          done: true,
          tokens: finalTokens,
          tokenBreakdown,
          usageSource,
          fullResponse,
          rawResponse,
          providerRequestPayload,
          groundingMetadata: accumulatedGroundingMetadata ? {
            chunks: accumulatedGroundingMetadata.groundingChunks || [],
            searchEntryPoint: accumulatedGroundingMetadata.searchEntryPoint
          } : null
        })}\n\n`))
        return
      } else {
        lastError = providerError(res.status)
      }
    } catch (error) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: publicError(error) })}\n\n`))
      return
    }
  }

  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: lastError || "Gemini request failed" })}\n\n`))
}
