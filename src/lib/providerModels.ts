import { providerUrl, providerRegistry } from "@/lib/providers/registry"
import { ApiError, providerError } from "@/lib/apiErrors"
import { providerFetch } from "@/lib/providerRequest"

export interface ProviderModel { id: string; contextWindow: number; capabilities: { vision: boolean; function_calling: boolean; json_mode: boolean } }
export interface ProviderModels { models: string[]; modelsWithCapabilities: ProviderModel[] }


function getContextWindowForOpenAIModel(modelId: string): number {
  const contextWindows: Record<string, number> = {

    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'gpt-4o-2024-08-06': 128000,
    'gpt-4o-mini-2024-07-18': 128000,

    'gpt-4-turbo': 128000,
    'gpt-4-turbo-2024-04-09': 128000,
    'gpt-4-turbo-preview': 128000,

    'gpt-4': 8192,
    'gpt-4-0613': 8192,
    'gpt-4-0314': 8192,

    'gpt-3.5-turbo': 4096,
    'gpt-3.5-turbo-16k': 16384,
    'gpt-3.5-turbo-1106': 16384,
    'gpt-3.5-turbo-0613': 4096,
    'gpt-3.5-turbo-0301': 4096,

    'text-davinci-003': 4097,
    'text-davinci-002': 4097,
    'text-davinci-001': 2049,
    'text-curie-001': 2049,
    'text-babbage-001': 2049,
    'text-ada-001': 2049
  }

  return contextWindows[modelId] || 4000 // Fallback
}


async function list_openai(apiKey: string): Promise<ProviderModels> {
    const res = await providerFetch(providerUrl("openai", "models"), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    })

    if (!res.ok) throw new ApiError(providerError(res.status), 502)

    const data = await res.json()

    const modelsWithCapabilities = (data.data || [])
      .filter((m: { id?: string }) => typeof m.id === "string")
      .map((m: { id: string; object?: string; capabilities?: { vision?: boolean; function_calling?: boolean; json_mode?: boolean } }) => ({
        id: m.id,
        contextWindow: getContextWindowForOpenAIModel(m.id),
        capabilities: {
          vision: m.capabilities?.vision || false,
          function_calling: m.capabilities?.function_calling || false,
          json_mode: m.capabilities?.json_mode || false
        }
      }))

    return {
      models: modelsWithCapabilities.map((m: { id: string }) => m.id),
      modelsWithCapabilities
    }

}

function getContextWindowForGeminiModel(modelName: string): number {
  const contextWindows: Record<string, number> = {

    'models/gemini-1.5-pro': 2000000,
    'models/gemini-1.5-flash': 1000000,
    'models/gemini-1.5-pro-001': 2000000,
    'models/gemini-1.5-flash-001': 1000000,

    'models/gemini-pro': 30720,
    'models/gemini-pro-vision': 30720,

    'models/gemini-2.0-flash-exp': 1000000,

    'models/gemini-ultra': 30720,
    'models/gemini-nano': 30720
  }

  return contextWindows[modelName] || 30720 // Fallback
}


async function list_gemini(apiKey: string): Promise<ProviderModels> {

    const url = `${providerRegistry.gemini.defaultBaseUrl}/v1beta/models?key=${encodeURIComponent(apiKey)}`
    const res = await providerFetch(url, { cache: "no-store" })
    if (!res.ok) throw new ApiError(providerError(res.status), 502)
    const data = await res.json()

    const modelsWithCapabilities = (data.models || [])
      .filter((m: { name?: string }) => typeof m.name === "string")
      .map((m: { name: string; supportedGenerationMethods?: string[] }) => ({
        id: m.name,
        contextWindow: getContextWindowForGeminiModel(m.name),
        capabilities: {
          vision: m.supportedGenerationMethods?.includes('generateContent') || false,
          function_calling: m.supportedGenerationMethods?.includes('generateContent') || false,
          json_mode: false // Gemini doesn't have explicit JSON mode
        }
      }))

    return {
      models: modelsWithCapabilities.map((m: { id: string }) => m.id),
      modelsWithCapabilities
    }

}

function getContextWindowForOpenRouterModel(modelId: string): number {
  const contextWindows: Record<string, number> = {

    'claude-3-5-sonnet-20241022': 200000,
    'claude-3-opus-20240229': 200000,
    'claude-3-sonnet-20240229': 200000,
    'claude-3-haiku-20240307': 200000,
    'claude-2.1': 200000,
    'claude-2.0': 100000,
    'claude-instant-1.2': 100000,

    'llama-3.1-405b-instruct': 128000,
    'llama-3.1-70b-instruct': 128000,
    'llama-3.1-8b-instruct': 128000,
    'llama-3-70b-instruct': 8192,
    'llama-3-8b-instruct': 8192,
    'llama-2-70b-chat': 4096,
    'llama-2-13b-chat': 4096,
    'llama-2-7b-chat': 4096,

    'openai/gpt-4o': 128000,
    'openai/gpt-4o-mini': 128000,
    'openai/gpt-4-turbo': 128000,
    'openai/gpt-4': 8192,
    'openai/gpt-3.5-turbo': 4096,

    'mistral-7b-instruct': 32768,
    'mixtral-8x7b-instruct': 32768,
    'codellama-34b-instruct': 16384,
    'wizardcoder-34b': 16384
  }

  return contextWindows[modelId] || 4000 // Fallback
}


async function list_openrouter(apiKey: string): Promise<ProviderModels> {
    const res = await providerFetch(providerUrl("openrouter", "models"), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://localhost",
        "X-Title": "LLM Canvas",
      },
      cache: "no-store",
    })

    if (!res.ok) throw new ApiError(providerError(res.status), 502)

    const data = await res.json()

    const modelsWithCapabilities = (data.data || [])
      .filter((m: { id?: string }) => typeof m.id === "string")
      .map((m: { id: string; context_length?: number; capabilities?: { vision?: boolean; function_calling?: boolean; json_mode?: boolean } }) => ({
        id: m.id,
        contextWindow: getContextWindowForOpenRouterModel(m.id),
        capabilities: {
          vision: m.capabilities?.vision || false,
          function_calling: m.capabilities?.function_calling || false,
          json_mode: m.capabilities?.json_mode || false
        }
      }))

    return {
      models: modelsWithCapabilities.map((m: { id: string }) => m.id),
      modelsWithCapabilities
    }

}

export async function listProviderModels(provider: string, apiKey: string): Promise<ProviderModels> {
  switch (provider) {
    case "openai": return list_openai(apiKey)
    case "gemini": return list_gemini(apiKey)
    case "openrouter": return list_openrouter(apiKey)
    default: throw new ApiError("Invalid provider")
  }
}
