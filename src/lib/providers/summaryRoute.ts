import type { CredentialProviderId } from "@/lib/providers/registry"
import type { RequestOptions, SummaryLength, SummaryStyle } from "@/types"
import { providerRegistry } from "@/lib/providers/registry"
import { requireUserId, savedProviderKey } from "@/lib/providerCredentials"
import { resolveCustomEndpoint } from "@/lib/providers/customStore"
import { customSummary } from "@/lib/providers/customSummary"
import { customChat } from "@/lib/providers/customChat"
import { boundedSummary } from "@/lib/providers/boundedSummary"
import { createProviderStream } from "@/lib/providers/stream"
import { getDynamicContextWindow } from "@/lib/providerContext"
import { readGeminiText } from "@/lib/providers/geminiText"
import { providerFetch, withProviderSignal } from "@/lib/providerRequest"
import { ApiError, providerError } from "@/lib/apiErrors"
import { normalizeExecutionUsage, withExecutionAccounting, executionRequestBody } from "@/lib/executionUsage"
import { observeProviderUsage } from "@/lib/usageObservation"
import { readProviderJson } from "@/lib/providers/responseBody"

function number(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ApiError("Invalid generation parameter")
  return value
}

export function summaryRoute(request: Request, streamed: boolean): Promise<Response> {
  return withExecutionAccounting(request, req => withProviderSignal(req.signal, async () => {
    const userId = await requireUserId()
    const body = await executionRequestBody(req)
    if (typeof body.modelName !== "string" || !body.modelName.trim() || typeof body.text !== "string") throw new ApiError("Provider, model and text are required")
    const input: RequestOptions & { modelName: string; text: string; summaryLength?: SummaryLength; summaryStyle?: SummaryStyle } = {
      modelName: body.modelName, text: body.text, summaryLength: body.summaryLength, summaryStyle: body.summaryStyle,
      temperature: number(body.temperature), top_p: number(body.top_p), max_tokens: number(body.max_tokens), seed: number(body.seed)
    }
    const custom = body.provider === "custom" ? await resolveCustomEndpoint(userId, body.endpointId) : null
    if (!custom && (!body.provider || !["openai", "gemini", "openrouter"].includes(body.provider))) throw new ApiError("Invalid summary provider")
    const provider = body.provider as CredentialProviderId
    const apiKey = custom ? "" : await savedProviderKey(userId, provider)
    const contextWindow = custom ? 0 : await getDynamicContextWindow(provider, body.modelName, apiKey)
    const produce = async (progress?: (value: unknown) => void) => {
      if (custom) return customSummary(custom, input, progress)
      return boundedSummary(input, contextWindow, async (prompt, outputLimit) => {
        if (provider !== "gemini") {
          const endpoint = { id: provider, label: providerRegistry[provider].label, baseUrl: providerRegistry[provider].defaultBaseUrl, authStyle: "bearer" as const, models: [], contextWindow, apiKey, headers: { Authorization: `Bearer ${apiKey}` } }
          return customChat(endpoint, { ...input, finalPrompt: prompt, max_tokens: outputLimit })
        }
        const model = input.modelName.startsWith("models/") ? input.modelName : "models/" + input.modelName
        const response = await providerFetch(providerRegistry.gemini.defaultBaseUrl + "/v1beta/" + model + ":generateContent", {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: input.temperature, topP: input.top_p, maxOutputTokens: outputLimit } })
        })
        if (!response.ok) throw new ApiError(providerError(response.status), 502)
        const json = await readProviderJson(response)
        const result = normalizeExecutionUsage({ provider: "gemini", finalPrompt: prompt }, { responseText: readGeminiText(json), rawResponse: JSON.stringify(json) }) as { responseText: string; tokens: number; tokenBreakdown: import("@/lib/tokenUsage").UsageBreakdown | null; usageSource: "provider" | "estimated" | "unreported" }
        await observeProviderUsage(result, prompt)
        return result
      }, progress)
    }
    if (!streamed) return Response.json(await produce())
    return createProviderStream(req, async controller => {
      const encoder = new TextEncoder()
      const result = await produce(value => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`)))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", ...result })}\n\n`))
    })
  }))
}
