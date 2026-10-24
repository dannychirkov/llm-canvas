import { withApiBoundary } from "@/lib/apiBoundary"
import { readGeminiText } from "@/lib/providers/geminiText"
import { readProviderJson } from "@/lib/providers/responseBody"
import { parseTokenUsageFromRawResponse } from "@/lib/tokenParser"
import { resolveCustomEndpoint } from "@/lib/providers/customStore"
import { customChat } from "@/lib/providers/customChat"
import { withExecutionAccounting, executionRequestBody } from "@/lib/executionUsage"
import { customImageMode, customImages, imageUsage, readImageResponse } from "@/lib/providers/customImages"
import { recordValue } from "@/lib/providers/customTypes"
import { observeProviderUsage } from "@/lib/usageObservation"
import { extractGeminiGeneratedImages, saveGeneratedImages } from "@/lib/generatedMedia"
import { providerUrl, providerRegistry } from "@/lib/providers/registry"
import type { ProviderId } from "@/lib/providers/registry"
import { requireUserId, savedProviderKey, requireCanvasAccess, requireVideoAccess } from "@/lib/providerCredentials"
import { publicError, errorStatus, providerError } from "@/lib/apiErrors"
import { providerFetch, withProviderSignal } from "@/lib/providerRequest"
import { NextRequest, NextResponse } from "next/server"
import { 
  ImageData, 
  CsvFileData, 
  RequestOptions, 
  GeminiPayload, 
  OpenAIPayload, 
  OpenRouterPayload, 
  NanoBananaPayload,
  VideoAttachment
} from "@/types"
import { convertVideoFramesToImages, prepareGeminiVideoParts } from "@/lib/videoAttachmentService"
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
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
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
    const mode: string | undefined = body?.mode // For Nano Banana
    const canvasId: string | undefined = body?.canvasId // For saving generated images

    if (!provider || (!custom && !apiKey) || !finalPrompt) {
      return NextResponse.json({ error: "provider and finalPrompt are required" }, { status: 400 })
    }

    const imageMode = custom ? customImageMode(body.mode) : undefined
    if (canvasId || provider === "nanobanana" || imageMode) await requireCanvasAccess(userId, canvasId)
    await requireVideoAccess(userId, videos)

    const enhancedPrompt = appendCsvContext(finalPrompt, csvFiles)

    if (custom) return NextResponse.json(imageMode
      ? await customImages(custom, { ...body, finalPrompt: enhancedPrompt, csvFiles: [] }, { userId, canvasId })
      : await customChat(custom, { ...body, finalPrompt: enhancedPrompt, csvFiles: [] }))

    switch (provider) {
      case "gemini": {
        if (!modelName) return NextResponse.json({ error: "modelName is required" }, { status: 400 })
        const modelPath = modelName.startsWith("models/") ? modelName : `models/${modelName}`
        const base = providerRegistry.gemini.defaultBaseUrl
        
        let videoParts: Array<
          | { inlineData: { mimeType: string; data: string } }
          | { fileData: { fileUri: string; mimeType: string } }
        > = []
        
        if (videos.length > 0) {
          try {
            videoParts = await prepareGeminiVideoParts(videos, apiKey)
            // Check that processing completed successfully
            if (videoParts.length === 0) {
              return NextResponse.json({ 
                error: "Failed to process video files: no video parts were generated" 
              }, { status: 500 })
            }
          } catch (error) {
            const errorMessage = publicError(error)
            console.error({ event: "provider_request_failed" })
            return NextResponse.json({ 
              error: `Failed to process video files: ${errorMessage}` 
            }, { status: 500 })
          }
        }
        
        const makePayload = (): GeminiPayload => {
          const payload: GeminiPayload = {
            contents: [
              {
                role: "user",
                parts: [
                  { text: enhancedPrompt },
                  ...(images || []).map((img: ImageData) => ({
                    inlineData: {
                      mimeType: img.mimeType,
                      data: img.dataUrl.split(',')[1] // Remove data: prefix
                    }
                  })),
                  ...videoParts
                ],
              },
            ]
          }
          // Remove tools when using video files (check actual presence of processed videos)
          const hasVideoContent = videos.length > 0 && videoParts.length > 0
          if (!hasVideoContent && body.useTools !== false) {
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
        // Try v1beta first, then fallback to v1
        const tries = [
          `${base}/v1beta/${modelPath}:generateContent`,
          `${base}/v1/${modelPath}:generateContent`,
        ]
        let lastText = ""
        let lastStatus = 0
        for (const url of tries) {
          const payload = makePayload()
          payload.generationConfig = generationConfig
          const res = await providerFetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(payload),
          })
          if (res.ok) {
            const json = await readProviderJson(res) as { candidates?: Array<{ groundingMetadata?: { groundingChunks?: unknown[]; searchEntryPoint?: unknown } }> }
            const rawResponse = JSON.stringify(json)
            const responseText = readGeminiText(json)
            const tokenBreakdown = parseTokenUsageFromRawResponse(rawResponse, "gemini")
            const tokens = tokenBreakdown?.totalTokens
            
            // Extract grounding metadata
            const groundingMetadata = json?.candidates?.[0]?.groundingMetadata
            const groundingChunks = groundingMetadata?.groundingChunks || []
            const searchEntryPoint = groundingMetadata?.searchEntryPoint
            
            return NextResponse.json({ 
              responseText, 
              tokens, 
              tokenBreakdown, 
              rawResponse,
              groundingMetadata: {
                chunks: groundingChunks,
                searchEntryPoint: searchEntryPoint
              }
            })
          }
          // If not ok, capture text and continue to next try
          lastText = providerError(res.status)
          lastStatus = res.status
        }
        return NextResponse.json({ error: lastText || providerError(lastStatus) }, { status: 502 })
      }

      case "openai":
      case "openrouter": {
        const endpoint = { id: provider, label: providerRegistry[provider].label, baseUrl: providerRegistry[provider].defaultBaseUrl, authStyle: "bearer" as const, models: [], contextWindow: 32000, apiKey, headers: { Authorization: `Bearer ${apiKey}` } }
        return NextResponse.json(await customChat(endpoint, { ...body, finalPrompt: enhancedPrompt, csvFiles: [] }))
      }

      case "nanobanana": {
        // Nano Banana uses Gemini 2.5 Flash Image Preview for image generation
        const modelPath = "models/gemini-2.5-flash-image"
        const base = providerRegistry.gemini.defaultBaseUrl
        const url = `${base}/v1beta/${modelPath}:generateContent`
        
        const makePayload = (): NanoBananaPayload => {
          const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: enhancedPrompt }]
          
          // Add input images based on mode
          if (mode === "image-edit" || mode === "composition" || mode === "iterative") {
            parts.push(...(images || []).map((img: ImageData) => ({
              inlineData: {
                mimeType: img.mimeType,
                data: img.dataUrl.split(',')[1] // Remove data: prefix
              }
            })))
          }
          
          return {
            contents: [
              {
                parts: parts
              }
            ]
          }
        }
        
        const generationConfig: { temperature?: number; topP?: number; maxOutputTokens?: number; responseModalities: string[] } = { responseModalities: ["TEXT", "IMAGE"] }
        if (typeof temperature === "number") generationConfig.temperature = temperature
        if (typeof top_p === "number") generationConfig.topP = top_p
        if (typeof max_tokens === "number") generationConfig.maxOutputTokens = max_tokens
        
        const payload = makePayload()
        if (Object.keys(generationConfig).length) payload.generationConfig = generationConfig
        
        const res = await providerFetch(url, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json", 
            "x-goog-api-key": apiKey 
          },
          body: JSON.stringify(payload),
        })
        
        if (!res.ok) {
          const errorText = await res.text().catch(() => "")
          return NextResponse.json({ 
            error: providerError(res.status)
          }, { status: 502 })
        }
        
        const json = recordValue(await readImageResponse(res))
        if (json.error) return NextResponse.json({ error: "Provider image generation failed" }, { status: 502 })
        const usage = imageUsage(json)
        await observeProviderUsage(usage, enhancedPrompt)

        // Extract generated image from response
        const generatedImages = extractGeminiGeneratedImages(json)
        if (!generatedImages.length) {
          return NextResponse.json({ 
            error: "No image generated in response"
          }, { status: 502 })
        }
        
        // Save the generated image to media storage
        const savedImages = (await saveGeneratedImages(generatedImages, { userId, canvasId })).map(image => ({ ...image, usageSource: usage.usageSource }))
        
        // Extract any text from the response
        const responseText = readGeminiText(json)
        
        return NextResponse.json({ 
          responseText: responseText || "Image generated successfully",
          generatedImage: savedImages[0],
          generatedImages: savedImages,
          ...usage,
          rawResponse: JSON.stringify({ ...usage, generatedImages: savedImages })
        })
      }

      default:
        return NextResponse.json({ error: `Unsupported provider: ${provider}` }, { status: 400 })
    }
  } catch (err: unknown) {
    const message = publicError(err)
    return NextResponse.json({ error: message }, { status: errorStatus(err) })
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
