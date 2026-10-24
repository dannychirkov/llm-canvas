import { randomInt, randomUUID } from "node:crypto"
import { ApiError, providerError } from "@/lib/apiErrors"
import { providerFetch } from "@/lib/providerRequest"
import { decodeGeneratedRaster, MAX_GENERATED_IMAGE_BYTES, MAX_GENERATED_IMAGES, saveGeneratedImages, type GeneratedRaster } from "@/lib/generatedMedia"
import { observeProviderUsage } from "@/lib/usageObservation"
import { comfyImageIndices, renderComfyWorkflow, validateComfyWorkflow } from "@/lib/providers/comfyWorkflow"

export const COMFY_EXECUTION_TIMEOUT_MS = 120_000
const MAX_BATCH_BYTES = 40 * 1024 * 1024
const MAX_METADATA_BYTES = 4 * 1024 * 1024

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function safePath(value: unknown, allowEmpty = false, nested = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value) || value.length > 1024 || /[\\\u0000-\u001f\u007f%?#:]/.test(value) || value.startsWith("/") || value.split("/").some(part => part === "." || part === "..") || (!nested && value.includes("/"))) throw new ApiError("ComfyUI returned an invalid image path", 502)
  return value
}

async function readBytes(response: Response, limit: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel()
    throw new ApiError("ComfyUI response exceeds the size limit", 502)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new ApiError("ComfyUI returned an empty response", 502)
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) {
        await reader.cancel()
        throw new ApiError("ComfyUI response exceeds the size limit", 502)
      }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks)
}

async function metadata(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse((await readBytes(response, MAX_METADATA_BYTES)).toString("utf8"))
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid metadata")
    return value as Record<string, unknown>
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) throw error
    throw new ApiError("ComfyUI returned invalid metadata", 502)
  }
}

function delay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const done = () => { signal.removeEventListener("abort", aborted); resolve() }
    const timer = setTimeout(done, 1000)
    const aborted = () => { clearTimeout(timer); reject(signal.reason) }
    signal.addEventListener("abort", aborted, { once: true })
  })
}

export async function customComfyImages(endpoint: { baseUrl: string; headers: Record<string, string>; workflow?: unknown }, body: Record<string, unknown>, owner: { userId: string; canvasId?: string }, controller?: ReadableStreamDefaultController<Uint8Array>) {
  if (!owner.userId || !owner.canvasId) throw new ApiError("An owned canvas is required to generate images")
  if (typeof body.modelName !== "string" || !body.modelName.trim() || body.modelName.length > 256) throw new ApiError("Select an image model")
  if (typeof body.finalPrompt !== "string" || !body.finalPrompt.trim() || body.finalPrompt.length > 100_000) throw new ApiError("Image prompt must contain between 1 and 100000 characters")
  if (body.videos !== undefined && (!Array.isArray(body.videos) || body.videos.length)) throw new ApiError("ComfyUI image output does not support video attachments")
  if (body.images !== undefined && !Array.isArray(body.images)) throw new ApiError("Invalid image attachments")
  const attachments = Array.isArray(body.images) ? body.images : []
  if (attachments.length > MAX_GENERATED_IMAGES) throw new ApiError("Too many image attachments")
  const template = validateComfyWorkflow(endpoint.workflow)
  const indices = comfyImageIndices(template)
  if (indices.length !== attachments.length || indices.some((index, position) => index !== position)) throw new ApiError("Each ComfyUI image attachment must have a matching workflow placeholder")
  const rasters = attachments.map(attachment => {
    const url = record(attachment).dataUrl
    const match = typeof url === "string" ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url) : null
    if (!match) throw new ApiError("ComfyUI image attachments must be base64 PNG, JPEG or WebP rasters")
    try { return decodeGeneratedRaster({ mimeType: match[1], data: match[2] }) } catch { throw new ApiError("Invalid ComfyUI image attachment") }
  })
  if (rasters.reduce((sum, raster) => sum + raster.buffer.length, 0) > MAX_BATCH_BYTES) throw new ApiError("ComfyUI image attachments exceed the size limit")
  const seed = body.seed === undefined ? randomInt(0, 2 ** 32) : body.seed
  if (typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 0) throw new ApiError("ComfyUI seed must be a non-negative safe integer")
  let base: URL
  try { base = new URL(endpoint.baseUrl) } catch { throw new ApiError("Invalid ComfyUI base URL") }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new ApiError("Invalid ComfyUI base URL")
  const baseUrl = base.toString().replace(/\/+$/, "")
  const signal = AbortSignal.timeout(COMFY_EXECUTION_TIMEOUT_MS)
  async function request(path: string, options: RequestInit = {}) {
    const headers = new Headers(endpoint.headers)
    new Headers(options.headers).forEach((value, key) => headers.set(key, value))
    if (options.body instanceof FormData) headers.delete("Content-Type")
    const response = await providerFetch(baseUrl + path, { ...options, headers, redirect: "error", signal })
    if (!response.ok) {
      await response.body?.cancel()
      throw new ApiError(providerError(response.status), 502)
    }
    return response
  }
  const clientId = randomUUID()
  const uploaded: string[] = []
  for (const [index, raster] of rasters.entries()) {
    const form = new FormData()
    form.append("image", new Blob([new Uint8Array(raster.buffer)], { type: raster.mimeType }), `llm_canvas_${clientId}_${index}.${raster.extension}`)
    form.append("type", "input")
    form.append("overwrite", "false")
    const upload = await metadata(await request("/upload/image", { method: "POST", body: form }))
    if (upload.type !== "input") throw new ApiError("ComfyUI returned an invalid uploaded image", 502)
    const name = safePath(upload.name)
    const subfolder = safePath(upload.subfolder ?? "", true, true)
    uploaded.push(subfolder ? subfolder + "/" + name : name)
  }
  const graph = renderComfyWorkflow(template, { prompt: body.finalPrompt, model: body.modelName, seed, images: uploaded })
  const submission = await metadata(await request("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: graph, client_id: clientId }) }))
  if (submission.error || Object.keys(record(submission.node_errors)).length) throw new ApiError("ComfyUI rejected the workflow", 502)
  if (typeof submission.prompt_id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(submission.prompt_id)) throw new ApiError("ComfyUI returned an invalid task identifier", 502)
  const promptId = submission.prompt_id
  let entry: Record<string, unknown>
  while (true) {
    const history = await metadata(await request("/history/" + encodeURIComponent(promptId)))
    entry = record(Object.hasOwn(history, promptId) ? history[promptId] : undefined)
    const status = record(entry.status)
    if (status.status_str === "error" || (Array.isArray(status.messages) && status.messages.some(message => Array.isArray(message) && ["execution_error", "execution_interrupted"].includes(message[0])))) throw new ApiError("ComfyUI workflow execution failed", 502)
    if (status.completed === true && status.status_str === "success") break
    if (status.completed === true) throw new ApiError("ComfyUI workflow did not complete successfully", 502)
    await delay(signal)
  }
  const outputNodes = record(entry.outputs)
  const images: GeneratedRaster[] = []
  const descriptors: Record<string, unknown>[] = []
  for (const [id, output] of Object.entries(outputNodes)) {
    if (!Object.hasOwn(graph, id)) continue
    const list = record(output).images
    if (Array.isArray(list)) for (const image of list) descriptors.push(record(image))
  }
  if (!descriptors.length || descriptors.length > MAX_GENERATED_IMAGES) throw new ApiError("ComfyUI must return between 1 and 4 images from this workflow", 502)
  let totalBytes = 0
  for (const image of descriptors) {
    const filename = safePath(image.filename)
    const subfolder = safePath(image.subfolder ?? "", true, true)
    if (image.type !== "output" && image.type !== "temp") throw new ApiError("ComfyUI returned an unsupported image output", 502)
    const query = new URLSearchParams({ filename, subfolder, type: image.type })
    const response = await request("/view?" + query.toString())
    const buffer = await readBytes(response, Math.min(MAX_GENERATED_IMAGE_BYTES, MAX_BATCH_BYTES - totalBytes))
    totalBytes += buffer.length
    const raster = { data: buffer.toString("base64") }
    decodeGeneratedRaster(raster)
    images.push(raster)
  }
  const usage = { tokens: undefined, tokenBreakdown: undefined, usageSource: "unreported" as const }
  await observeProviderUsage(usage, body.finalPrompt)
  const generatedImages = (await saveGeneratedImages(images, owner)).map(image => ({ ...image, usageSource: usage.usageSource }))
  const result = {
    responseText: "Image generated successfully", generatedImage: generatedImages[0], generatedImages, ...usage,
    rawResponse: JSON.stringify({ ...usage, generatedImages }),
    providerRequestPayload: { model: body.modelName, mode: "comfyui", imageInputCount: attachments.length, workflowNodeCount: Object.keys(graph).length }
  }
  if (controller) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ ...result, fullResponse: result.responseText, done: true })}\n\n`))
  return result
}
