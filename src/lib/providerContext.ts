import { listProviderModels } from "@/lib/providerModels"
import { getContextWindow } from "@/lib/smartSummarizer"

export async function getDynamicContextWindow(provider: string, modelName: string, apiKey?: string): Promise<number> {
  try {
    if (!apiKey) return getContextWindow(provider, modelName)
    const data = await listProviderModels(provider, apiKey)
    return data.modelsWithCapabilities.find(model => model.id === modelName)?.contextWindow || getContextWindow(provider, modelName)
  } catch {
    return getContextWindow(provider, modelName)
  }
}
