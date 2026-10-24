interface ProviderDefinition {
  id: string
  label: string
  kind: "openai-compatible" | "gemini" | "image"
  defaultBaseUrl: string
  modelsProvider: string
  supportsStreaming: boolean
  supportsImages: boolean
  supportsTools: boolean
  authStyle: "bearer" | "query-key"
}

export const providerRegistry = {
  openai: { id: "openai", label: "OpenAI", kind: "openai-compatible", defaultBaseUrl: "https://api.openai.com/v1", modelsProvider: "openai", supportsStreaming: true, supportsImages: true, supportsTools: false, authStyle: "bearer" },
  gemini: { id: "gemini", label: "Google Gemini", kind: "gemini", defaultBaseUrl: "https://generativelanguage.googleapis.com", modelsProvider: "gemini", supportsStreaming: true, supportsImages: true, supportsTools: true, authStyle: "query-key" },
  openrouter: { id: "openrouter", label: "OpenRouter", kind: "openai-compatible", defaultBaseUrl: "https://openrouter.ai/api/v1", modelsProvider: "openrouter", supportsStreaming: true, supportsImages: true, supportsTools: false, authStyle: "bearer" },
  custom: { id: "custom", label: "Custom endpoint", kind: "openai-compatible", defaultBaseUrl: "", modelsProvider: "custom", supportsStreaming: true, supportsImages: true, supportsTools: false, authStyle: "bearer" },
  nanobanana: { id: "nanobanana", label: "Nano Banana", kind: "image", defaultBaseUrl: "https://generativelanguage.googleapis.com", modelsProvider: "gemini", supportsStreaming: false, supportsImages: true, supportsTools: false, authStyle: "query-key" }
} as const satisfies Record<string, ProviderDefinition>

export type ProviderId = keyof typeof providerRegistry
export type CredentialProviderId = Exclude<ProviderId, "nanobanana" | "custom">
export type TokenProviderId = typeof providerRegistry.openai.id | typeof providerRegistry.gemini.id

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.hasOwn(providerRegistry, value)
}

export function providerUrl(provider: ProviderId, resource: string): string {
  return providerRegistry[provider].defaultBaseUrl + "/" + resource.replace(/^\/+/, "")
}

export function providerHeaders(provider: ProviderId, apiKey: string): Record<string, string> {
  if (providerRegistry[provider].authStyle === "query-key") return { "x-goog-api-key": apiKey }
  return { Authorization: `Bearer ${apiKey}` }
}
