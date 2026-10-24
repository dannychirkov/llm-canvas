import { readGeminiText } from "@/lib/providers/geminiText"
import type { ImageData, NanoBananaPayload } from "@/types"
import { ApiError, providerError } from "@/lib/apiErrors"
import { providerFetch } from "@/lib/providerRequest"
import { providerRegistry } from "@/lib/providers/registry"
import { extractGeminiGeneratedImages, saveGeneratedImages } from "@/lib/generatedMedia"
import { imageUsage, readImageResponse } from "@/lib/providers/customImages"
import { recordValue } from "@/lib/providers/customTypes"
import { observeProviderUsage } from "@/lib/usageObservation"

export async function handleNanoBananaStream(controller: ReadableStreamDefaultController, params: {
  userId: string
  apiKey: string
  finalPrompt: string
  images: ImageData[]
  mode?: string
  canvasId?: string
  temperature?: number
  top_p?: number
  max_tokens?: number
}) {
  const { userId, apiKey, finalPrompt, images, mode, canvasId, temperature, top_p, max_tokens } = params
  const modelPath = "models/gemini-2.5-flash-image"
  const url = `${providerRegistry.gemini.defaultBaseUrl}/v1beta/${modelPath}:generateContent`
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: finalPrompt }]
  if (mode === "image-edit" || mode === "composition" || mode === "iterative") {
    parts.push(...images.map(image => ({ inlineData: { mimeType: image.mimeType, data: image.dataUrl.split(",")[1] } })))
  }
  const generationConfig: { temperature?: number; topP?: number; maxOutputTokens?: number; responseModalities: string[] } = { responseModalities: ["TEXT", "IMAGE"] }
  if (typeof temperature === "number") generationConfig.temperature = temperature
  if (typeof top_p === "number") generationConfig.topP = top_p
  if (typeof max_tokens === "number") generationConfig.maxOutputTokens = max_tokens
  const payload: NanoBananaPayload = { contents: [{ parts }], generationConfig }
  const response = await providerFetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(payload)
  })
  if (!response.ok) throw new ApiError(providerError(response.status), 502)
  const json = recordValue(await readImageResponse(response))
  if (json.error) throw new ApiError("Provider request failed", 502)
  const usage = imageUsage(json)
  await observeProviderUsage(usage, finalPrompt)
  const generatedImages = (await saveGeneratedImages(extractGeminiGeneratedImages(json), { userId, canvasId })).map(image => ({ ...image, usageSource: usage.usageSource }))
  const text = readGeminiText(json) || "Image generated successfully"
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
    done: true, ...usage,
    fullResponse: text, generatedImage: generatedImages[0], generatedImages,
    rawResponse: JSON.stringify({ ...usage, generatedImages }),
    providerRequestPayload: { model: modelPath, generationConfig, imageInputCount: parts.length - 1 }
  })}\n\n`))
}
