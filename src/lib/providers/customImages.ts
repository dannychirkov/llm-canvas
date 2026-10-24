import { ApiError, providerError } from "@/lib/apiErrors"
import { providerFetch } from "@/lib/providerRequest"
import { decodeGeneratedRaster, MAX_GENERATED_IMAGE_BYTES, MAX_GENERATED_IMAGES, saveGeneratedImages, type GeneratedRaster } from "@/lib/generatedMedia"
import { recordValue } from "@/lib/providers/customTypes"
import type { TokenBreakdown } from "@/types"
import { observeProviderUsage } from "@/lib/usageObservation"
import { customComfyImages } from "./customComfy"

export function customImageMode(mode: unknown): "image-generation" | "image-edit" | "chat-image" | undefined {
  if (mode === "image-generation" || mode === "image-edit" || mode === "chat-image") return mode
  if (mode === undefined || mode === null || mode === "" || mode === "chat") return undefined
  throw new ApiError("Select Chat, Images API or Chat image output mode")
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export function imageUsage(payload: unknown) {
  const root = recordValue(payload)
  const usage = recordValue(root.usage)
  const gemini = recordValue(root.usageMetadata)
  const inputTokens = count(usage.input_tokens ?? usage.prompt_tokens ?? gemini.promptTokenCount)
  const outputBase = count(usage.output_tokens ?? usage.completion_tokens ?? gemini.candidatesTokenCount)
  const outputTokens = outputBase === undefined ? undefined : outputBase + (count(gemini.thoughtsTokenCount) ?? 0)
  const total = count(usage.total_tokens ?? gemini.totalTokenCount)
  if (inputTokens !== undefined && outputTokens !== undefined && !Number.isSafeInteger(inputTokens + outputTokens)) return { tokens: undefined, tokenBreakdown: undefined, usageSource: "unreported" as const }
  if (inputTokens === undefined || outputTokens === undefined) {
    return { tokens: total, tokenBreakdown: undefined, usageSource: total === undefined ? "unreported" as const : "provider" as const }
  }
  const inputDetails = recordValue(usage.input_tokens_details ?? usage.prompt_tokens_details)
  const outputDetails = recordValue(usage.output_tokens_details ?? usage.completion_tokens_details)
  const tokenBreakdown: TokenBreakdown = { inputTokens, outputTokens }
  const reasoningTokens = count(outputDetails.reasoning_tokens ?? usage.reasoning_tokens ?? gemini.thoughtsTokenCount)
  const cachedTokens = count(inputDetails.cached_tokens ?? gemini.cachedContentTokenCount)
  const inputImageTokens = count(inputDetails.image_tokens)
  const outputImageTokens = count(outputDetails.image_tokens)
  if (reasoningTokens !== undefined) tokenBreakdown.reasoningTokens = reasoningTokens
  if (cachedTokens !== undefined) tokenBreakdown.cachedTokens = cachedTokens
  if (inputImageTokens !== undefined || outputImageTokens !== undefined) tokenBreakdown.imageTokens = (inputImageTokens ?? 0) + (outputImageTokens ?? 0)
  return { tokens: total ?? inputTokens + outputTokens, tokenBreakdown, usageSource: "provider" as const }
}

function inlineImage(value: unknown): GeneratedRaster {
  if (typeof value !== "string") throw new ApiError("Provider did not return an inline image", 502)
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match) throw new ApiError("Provider must return base64 PNG, JPEG or WebP images; remote image URLs are not fetched", 502)
  return { data: match[2], mimeType: match[1] }
}

export function extractCustomImages(payload: unknown, mode: "image-generation" | "image-edit" | "chat-image") {
  const json = recordValue(payload)
  if (json.error) throw new ApiError("Provider image generation failed", 502)
  let images: GeneratedRaster[] = []
  let responseText = ""
  if (mode === "image-generation" || mode === "image-edit") {
    if (Array.isArray(json.data) && json.data.length > MAX_GENERATED_IMAGES) throw new ApiError("Provider returned too many images", 502)
    if (Array.isArray(json.data)) images = json.data.map(entry => {
      const image = recordValue(entry)
      return typeof image.b64_json === "string" ? { data: image.b64_json } : inlineImage(image.url)
    })
  } else {
    const first = Array.isArray(json.choices) ? recordValue(json.choices[0]) : {}
    const message = recordValue(first.message)
    if (Array.isArray(message.images) && message.images.length > MAX_GENERATED_IMAGES) throw new ApiError("Provider returned too many images", 502)
    if (Array.isArray(message.images)) images.push(...message.images.map(entry => {
      const image = recordValue(entry)
      return inlineImage(recordValue(image.image_url).url ?? image.image_url ?? image.url)
    }))
    if (typeof message.content === "string") responseText = message.content
    if (Array.isArray(message.content)) {
      const text: string[] = []
      for (const entry of message.content) {
        const part = recordValue(entry)
        if (part.type === "text" && typeof part.text === "string") text.push(part.text)
        if (part.type === "image_url") images.push(inlineImage(recordValue(part.image_url).url))
      }
      responseText = text.join("\n")
    }
  }
  if (!images.length) throw new ApiError("The selected model or endpoint did not return an image; check its image output protocol", 502)
  if (images.length > MAX_GENERATED_IMAGES) throw new ApiError("Provider returned too many images", 502)
  return { images, responseText }
}

export async function readImageResponse(response: Response): Promise<unknown> {
  const limit = Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4 * MAX_GENERATED_IMAGES + 1024 * 1024
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel()
    throw new ApiError("Provider image response exceeds the size limit", 502)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new ApiError("Provider returned an empty image response", 502)
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) {
        await reader.cancel()
        throw new ApiError("Provider image response exceeds the size limit", 502)
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { throw new ApiError("Provider returned an invalid image response", 502) }
}

export async function customImages(endpoint: { baseUrl: string; headers: Record<string, string>; apiType?: string; workflow?: unknown }, body: Record<string, unknown>, owner: { userId: string; canvasId?: string }, controller?: ReadableStreamDefaultController<Uint8Array>) {
  if (endpoint.apiType === "comfyui") return customComfyImages(endpoint, body, owner, controller)
  if (!owner.userId || !owner.canvasId) throw new ApiError("An owned canvas is required to generate images")
  const mode = customImageMode(body.mode)
  if (!mode) throw new ApiError("Select an image output mode")
  if (typeof body.modelName !== "string" || !body.modelName.trim() || body.modelName.length > 256) throw new ApiError("Select an image model")
  if (typeof body.finalPrompt !== "string" || !body.finalPrompt.trim() || body.finalPrompt.length > 100_000) throw new ApiError("Image prompt must contain between 1 and 100000 characters")
  if (Array.isArray(body.videos) && body.videos.length) throw new ApiError("Image output mode does not support video attachments")
  if (body.images !== undefined && !Array.isArray(body.images)) throw new ApiError("Invalid image attachments")
  const attachments = Array.isArray(body.images) ? body.images : []
  if (mode === "image-generation" && attachments.length) throw new ApiError("Images API generation accepts text only; select Chat image output for supported image inputs")
  if (mode === "image-edit" && !attachments.length) throw new ApiError("Connect at least one source image for Images API editing")
  if (attachments.length > MAX_GENERATED_IMAGES) throw new ApiError("Too many image attachments")
  const content: Record<string, unknown>[] = [{ type: "text", text: body.finalPrompt }]
  for (const attachment of attachments) {
    const image = recordValue(attachment)
    decodeGeneratedRaster(inlineImage(image.dataUrl))
    content.push({ type: "image_url", image_url: { url: image.dataUrl } })
  }
  const chatSettings: Record<string, number> = {}
  for (const [name, maximum] of [["temperature", 2], ["top_p", 1], ["max_tokens", 100_000_000]] as const) {
    const value = body[name]
    if (value === undefined || value === null || value === "") continue
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum || (name === "max_tokens" && (!Number.isSafeInteger(value) || value < 1))) throw new ApiError("Invalid image generation setting")
    chatSettings[name] = value
  }
  if (body.imageResponseFormat !== undefined && body.imageResponseFormat !== "auto" && body.imageResponseFormat !== "b64_json") throw new ApiError("Invalid image response format")
  const payload = mode === "image-generation"
    ? { model: body.modelName, prompt: body.finalPrompt, n: 1, ...(body.imageResponseFormat === "b64_json" ? { response_format: "b64_json" } : {}) }
    : { model: body.modelName, messages: [{ role: "user", content }], modalities: ["text", "image"], stream: false, ...chatSettings }
  const form = mode === "image-edit" ? new FormData() : undefined
  if (form) {
    form.set("model", body.modelName)
    form.set("prompt", body.finalPrompt)
    form.set("n", "1")
    if (body.imageResponseFormat === "b64_json") form.set("response_format", "b64_json")
    for (let i = 0; i < attachments.length; i++) {
      const raster = decodeGeneratedRaster(inlineImage(recordValue(attachments[i]).dataUrl))
      form.append(attachments.length === 1 ? "image" : "image[]", new Blob([new Uint8Array(raster.buffer)], { type: raster.mimeType }), `input-${i}.${raster.extension}`)
    }
  }
  const response = await providerFetch(endpoint.baseUrl + (mode === "image-generation" ? "/images/generations" : mode === "image-edit" ? "/images/edits" : "/chat/completions"), {
    method: "POST", headers: form ? endpoint.headers : { ...endpoint.headers, "Content-Type": "application/json" }, body: form ?? JSON.stringify(payload), redirect: "error"
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new ApiError([400, 404, 405, 415, 422, 501].includes(response.status) ? "The selected model or endpoint does not support this image output request; check the model and protocol" : providerError(response.status), 502)
  }
  const json = await readImageResponse(response)
  if (recordValue(json).error) throw new ApiError("Provider image generation failed", 502)
  const usage = imageUsage(json)
  await observeProviderUsage(usage, body.finalPrompt)
  const { images, responseText } = extractCustomImages(json, mode)
  const generatedImages = (await saveGeneratedImages(images, owner)).map(image => ({ ...image, usageSource: usage.usageSource }))
  const result = {
    responseText: responseText || "Image generated successfully",
    generatedImage: generatedImages[0], generatedImages, ...usage,
    rawResponse: JSON.stringify({ ...usage, generatedImages }),
    providerRequestPayload: { model: body.modelName, mode, imageInputCount: attachments.length }
  }
  if (controller) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ ...result, fullResponse: result.responseText, done: true })}\n\n`))
  return result
}
