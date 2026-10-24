import { customChat } from "@/lib/providers/customChat"
import { providerRegistry } from "@/lib/providers/registry"
import type { ImageData } from "@/types"

export async function handleOpenRouterStream(controller: ReadableStreamDefaultController<Uint8Array>, params: { apiKey: string; modelName: string; finalPrompt: string; images: ImageData[]; temperature?: number; top_p?: number; max_tokens?: number; seed?: number }) {
  const endpoint = { id: "openrouter", label: "OpenRouter", baseUrl: providerRegistry.openrouter.defaultBaseUrl, authStyle: "bearer" as const, models: [], contextWindow: 32000, apiKey: params.apiKey, headers: { Authorization: `Bearer ${params.apiKey}` } }
  return customChat(endpoint, params, controller)
}
