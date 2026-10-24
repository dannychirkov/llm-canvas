import { withApiBoundary } from "@/lib/apiBoundary"
import { resolveCustomEndpoint } from "@/lib/providers/customStore"
import { customChat } from "@/lib/providers/customChat"
import { withExecutionAccounting, executionRequestBody } from "@/lib/executionUsage"
import { customImageMode, customImages } from "@/lib/providers/customImages"
import type { ProviderId } from "@/lib/providers/registry"
import { requireUserId, savedProviderKey, requireCanvasAccess, requireVideoAccess } from "@/lib/providerCredentials"
import { publicError, errorStatus } from "@/lib/apiErrors"
import { withProviderSignal } from "@/lib/providerRequest"
import { NextRequest } from "next/server"
import type { ImageData, CsvFileData, VideoAttachment } from "@/types"
import { convertVideoFramesToImages } from "@/lib/videoAttachmentService"
import { createProviderStream } from "@/lib/providers/stream"
import { handleOpenAIStream } from "@/lib/providers/adapters/openaiStream"
import { handleOpenRouterStream } from "@/lib/providers/adapters/openrouterStream"
import { handleGeminiStream } from "@/lib/providers/adapters/geminiStream"
import { handleNanoBananaStream } from "@/lib/providers/adapters/imageStream"
import { appendCsvContext } from "@/lib/csvContext"

type Provider = ProviderId

async function boundaryPOST(req: NextRequest) {
  return withExecutionAccounting(req, execute)
}

async function execute(req: NextRequest) {
  return withProviderSignal(req.signal, async () => {
  try {
    const userId = await requireUserId()
    const body = await executionRequestBody(req)
    if (!body) {
      return new Response("Invalid JSON", { status: 400 })
    }

    const provider: Provider | undefined = body?.provider
    const custom = provider === "custom" ? await resolveCustomEndpoint(userId, body.endpointId) : null
    const apiKey = custom ? custom.apiKey : await savedProviderKey(userId, provider ?? "")
    const finalPrompt: string | undefined = body?.finalPrompt
    const images: ImageData[] = body?.images || []
    const csvFiles: CsvFileData[] | undefined = body?.csvFiles || []
    const videos: VideoAttachment[] = body?.videos || []
    const modelName: string | undefined = body?.modelName
    const temperature: number | undefined = normalizeNumber(body?.temperature)
    const top_p: number | undefined = normalizeNumber(body?.top_p)
    const max_tokens: number | undefined = normalizeInt(body?.max_tokens)
    const seed: number | undefined = normalizeInt(body?.seed)
    const mode: string | undefined = body?.mode
    const canvasId: string | undefined = body?.canvasId
    const useTools: boolean = body?.useTools !== false // Default to true

    if (!provider || (!custom && !apiKey) || !finalPrompt) {
      return new Response("provider and finalPrompt are required", { status: 400 })
    }

    const imageMode = custom ? customImageMode(body.mode) : undefined
    if (canvasId || provider === "nanobanana" || imageMode) await requireCanvasAccess(userId, canvasId)
    await requireVideoAccess(userId, videos)

    const enhancedPrompt = appendCsvContext(finalPrompt, csvFiles)

    // Create ReadableStream for streaming
    return createProviderStream(req, async (controller) => {
          if (custom) {
            if (imageMode) await customImages(custom, { ...body, finalPrompt: enhancedPrompt, csvFiles: [] }, { userId, canvasId }, controller)
            else await customChat(custom, { ...body, finalPrompt: enhancedPrompt, csvFiles: [] }, controller)
            return
          }
          switch (provider) {
            case "openai": {
              let videoFrames: ImageData[] = []
              if (videos.length > 0) {
                try {
                  videoFrames = await convertVideoFramesToImages(videos)
                } catch (error) {
                  const errorMessage = publicError(error)
                  console.error({ event: "provider_request_failed" })
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: `Failed to process video files: ${errorMessage}` })}\n\n`))
                  return
                }
              }
              await handleOpenAIStream(controller, {
                apiKey,
                modelName: modelName || "gpt-4o",
                finalPrompt: enhancedPrompt,
                images: images.concat(videoFrames),
                temperature,
                top_p,
                max_tokens,
                seed
              })
              break
            }
            case "openrouter": {
              let videoFrames: ImageData[] = []
              if (videos.length > 0) {
                try {
                  videoFrames = await convertVideoFramesToImages(videos)
                } catch (error) {
                  const errorMessage = publicError(error)
                  console.error({ event: "provider_request_failed" })
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: `Failed to process video files: ${errorMessage}` })}\n\n`))
                  return
                }
              }
              await handleOpenRouterStream(controller, {
                apiKey,
                modelName: modelName || "anthropic/claude-3.5-sonnet",
                finalPrompt: enhancedPrompt,
                images: images.concat(videoFrames),
                temperature,
                top_p,
                max_tokens,
                seed
              })
              break
            }
            case "gemini": {
              await handleGeminiStream(controller, {
                apiKey,
                modelName: modelName || "gemini-1.5-pro",
                finalPrompt: enhancedPrompt,
                images: images || [],
                videos: videos || [],
                temperature,
                top_p,
                max_tokens,
                useTools
              })
              break
            }
            case "nanobanana": {
              await handleNanoBananaStream(controller, {
                userId,
                apiKey,
                finalPrompt: enhancedPrompt,
                images,
                mode,
                canvasId,
                temperature,
                top_p,
                max_tokens
              })
              break
            }
            default:
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: `Unsupported provider: ${provider}` })}\n\n`))
          }
        
    })

    
  } catch (err: unknown) {
    const message = publicError(err)
    return new Response(message, { status: errorStatus(err) })
  }
  })
}

function normalizeNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined
  const n = typeof value === "string" ? parseFloat(value) : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function normalizeInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined
  const n = typeof value === "string" ? parseInt(value, 10) : Math.trunc(Number(value))
  return Number.isFinite(n) ? n : undefined
}

export function POST(req: NextRequest) {
  return withApiBoundary(req, () => boundaryPOST(req))
}
