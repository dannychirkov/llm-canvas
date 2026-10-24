import { ApiError } from "@/lib/apiErrors"

export interface CustomEndpoint {
  id: string
  label: string
  baseUrl: string
  enc?: string
  encHeaders?: string
  encWorkflow?: string
  apiType?: "openai-compatible" | "comfyui"
  chatApi?: "chat-completions" | "responses"
  authStyle: "bearer" | "none"
  models: string[]
  contextWindow: number
  modelContextWindows?: Record<string, number>
  discoveredModelContextWindows?: Record<string, number>
}

export type SafeCustomEndpoint = Omit<CustomEndpoint, "enc" | "encHeaders" | "encWorkflow"> & { hasKey: boolean; hasHeaders: boolean; hasWorkflow?: boolean }

export function normalizeBaseUrl(input: unknown, apiType: "openai-compatible" | "comfyui" = "openai-compatible"): string {
  if (typeof input !== "string" || !input || /\s/.test(input)) throw new ApiError("Base URL must not contain whitespace")
  let url: URL
  try { url = new URL(input) } catch { throw new ApiError("Invalid base URL") }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || input.includes("?") || input.includes("#")) {
    throw new ApiError("Use an HTTP(S) URL without credentials, query or fragment")
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || (apiType === "comfyui" ? "/" : "/v1")
  return url.toString().replace(/\/+$/, "")
}

export function contextWindowValue(input: unknown, fallback = 32000): number {
  if (input === undefined || input === "") return fallback
  const value = Number(input)
  if (!Number.isSafeInteger(value) || value < 128 || value > 100_000_000) throw new ApiError("Context window must be an integer between 128 and 100000000")
  return value
}

export function recordValue(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? structuredClone(input as Record<string, unknown>) : {}
}

export function customEndpoints(input: unknown): CustomEndpoint[] {
  const value = recordValue(input).custom
  return Array.isArray(value) ? value as CustomEndpoint[] : []
}

export function safeCustomEndpoint(endpoint: CustomEndpoint): SafeCustomEndpoint {
  return { id: endpoint.id, label: endpoint.label, baseUrl: endpoint.baseUrl, authStyle: endpoint.authStyle, models: endpoint.models, contextWindow: endpoint.contextWindow, modelContextWindows: endpoint.modelContextWindows, discoveredModelContextWindows: endpoint.discoveredModelContextWindows, apiType: endpoint.apiType ?? "openai-compatible", chatApi: endpoint.chatApi ?? "chat-completions", hasKey: Boolean(endpoint.enc), hasHeaders: Boolean(endpoint.encHeaders), hasWorkflow: Boolean(endpoint.encWorkflow) }
}

export function customModelContextWindow(endpoint: Pick<CustomEndpoint, "contextWindow" | "modelContextWindows" | "discoveredModelContextWindows">, modelName: string): number {
  return endpoint.modelContextWindows?.[modelName] ?? endpoint.discoveredModelContextWindows?.[modelName] ?? endpoint.contextWindow
}

export function normalizeModels(input: unknown, limit = 500): string[] {
  if (!Array.isArray(input) || input.length > limit) throw new ApiError(`Models must be an array with at most ${limit} entries`)
  return [...new Set(input.map(model => {
    if (typeof model !== "string" || !model.trim() || model.length > 256) throw new ApiError("Invalid model ID")
    return model.trim()
  }))]
}
