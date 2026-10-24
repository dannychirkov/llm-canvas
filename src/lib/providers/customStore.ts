import { randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { encryptString, decryptString } from "@/lib/crypto"
import { ApiError, providerError } from "@/lib/apiErrors"
import { providerFetch } from "@/lib/providerRequest"
import { parseCustomModels } from "@/lib/providers/customModels"
import { requireProviderEgress } from "@/lib/providers/providerEgress"
import { validateComfyWorkflow } from "./comfyWorkflow"
import { readProviderJson } from "./responseBody"
import { contextWindowValue, customEndpoints, normalizeBaseUrl, normalizeModels, recordValue, safeCustomEndpoint, type CustomEndpoint } from "@/lib/providers/customTypes"

function validHeaders(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError("Custom headers must be an object")
  const source = recordValue(input)
  if (Object.keys(source).length > 20) throw new ApiError("Too many custom headers")
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(source)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name) || /^(authorization|cookie|host|content-length|transfer-encoding|content-type)$/i.test(name) || typeof value !== "string" || /[\r\n]/.test(value)) throw new ApiError("Invalid custom header")
    headers[name] = value
  }
  return headers
}

async function endpointInput(input: unknown, existing?: CustomEndpoint): Promise<CustomEndpoint> {
  const body = recordValue(input)
  if (typeof body.label !== "string" || !body.label.trim() || body.label.length > 100) throw new ApiError("Endpoint name is required (maximum 100 characters)")
  const authStyle = body.authStyle ?? existing?.authStyle ?? "bearer"
  const apiType = body.apiType ?? existing?.apiType ?? "openai-compatible"
  const chatApi = body.chatApi ?? existing?.chatApi ?? "chat-completions"
  if (apiType !== "openai-compatible" && apiType !== "comfyui") throw new ApiError("Select an OpenAI-compatible or ComfyUI API")
  if (chatApi !== "chat-completions" && chatApi !== "responses") throw new ApiError("Select Chat Completions or Responses API")
  if (authStyle !== "bearer" && authStyle !== "none") throw new ApiError("Invalid auth style")
  if (body.apiKey !== undefined && (typeof body.apiKey !== "string" || body.apiKey.length > 16384)) throw new ApiError("Invalid API key")
  const endpoint: CustomEndpoint = {
    id: existing?.id ?? randomUUID(), label: body.label.trim(), baseUrl: normalizeBaseUrl(body.baseUrl, apiType), authStyle, apiType, chatApi,
    models: normalizeModels(body.models ?? existing?.models ?? []), contextWindow: contextWindowValue(body.contextWindow, existing?.contextWindow),
    enc: existing?.enc, encHeaders: existing?.encHeaders, encWorkflow: existing?.encWorkflow,
    discoveredModelContextWindows: existing?.discoveredModelContextWindows
  }
  if (existing && (endpoint.baseUrl !== existing.baseUrl || apiType !== (existing.apiType ?? "openai-compatible"))) endpoint.discoveredModelContextWindows = undefined
  if (typeof body.apiKey === "string" && body.apiKey.trim()) endpoint.enc = await encryptString(body.apiKey.trim())
  if (body.clearKey === true) endpoint.enc = undefined
  if (body.workflow !== undefined) endpoint.encWorkflow = await encryptString(JSON.stringify(validateComfyWorkflow(body.workflow)))
  if (body.clearWorkflow === true) endpoint.encWorkflow = undefined
  if (body.headers !== undefined) endpoint.encHeaders = await encryptString(JSON.stringify(validHeaders(body.headers)))
  if (body.modelContextWindows !== undefined || existing?.modelContextWindows) {
    endpoint.modelContextWindows = {}
    for (const [model, value] of Object.entries(recordValue(body.modelContextWindows ?? existing?.modelContextWindows))) {
      if (!endpoint.models.includes(model)) continue
      endpoint.modelContextWindows[model] = contextWindowValue(value)
    }
  }
  return endpoint
}

function jsonProviders(providers: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(providers)) as Prisma.InputJsonValue
}

export async function saveCustomEndpoint(userId: string, input: unknown) {
  const body = recordValue(input)
  await requireProviderEgress(userId, normalizeBaseUrl(body.baseUrl, body.apiType === "comfyui" ? "comfyui" : "openai-compatible"))
  return prisma.$transaction(async transaction => {
    const settings = await transaction.userSettings.findUnique({ where: { userId } })
    const providers = recordValue(settings?.providers)
    const endpoints = customEndpoints(providers)
    const existing = endpoints.find(endpoint => endpoint.id === body.id)
    if (body.id && !existing) throw new ApiError("Endpoint not found", 404)
    if (!existing && endpoints.length >= 25) throw new ApiError("Maximum 25 custom endpoints")
    const endpoint = await endpointInput(body, existing)
    providers.custom = existing ? endpoints.map(item => item.id === endpoint.id ? endpoint : item) : [...endpoints, endpoint]
    await transaction.userSettings.upsert({ where: { userId }, update: { providers: jsonProviders(providers) }, create: { userId, providers: jsonProviders(providers) } })
    return safeCustomEndpoint(endpoint)
  })
}

export async function deleteCustomEndpoint(userId: string, id: unknown) {
  await prisma.$transaction(async transaction => {
    const settings = await transaction.userSettings.findUnique({ where: { userId } })
    const providers = recordValue(settings?.providers)
    const endpoints = customEndpoints(providers)
    if (!endpoints.some(endpoint => endpoint.id === id)) throw new ApiError("Endpoint not found", 404)
    providers.custom = endpoints.filter(endpoint => endpoint.id !== id)
    await transaction.userSettings.update({ where: { userId }, data: { providers: jsonProviders(providers) } })
  })
}

export async function resolveCustomEndpoint(userId: string, id: unknown) {
  if (typeof id !== "string") throw new ApiError("Select a custom endpoint")
  const settings = await prisma.userSettings.findUnique({ where: { userId } })
  const endpoint = customEndpoints(settings?.providers).find(endpoint => endpoint.id === id)
  if (!endpoint) throw new ApiError("Endpoint not found", 404)
  await requireProviderEgress(userId, normalizeBaseUrl(endpoint.baseUrl, endpoint.apiType))
  if (endpoint.authStyle !== "none" && !endpoint.enc) throw new ApiError("Configure an endpoint key first")
  const apiKey = endpoint.authStyle === "none" ? "" : await decryptString(endpoint.enc!)
  const headers = endpoint.encHeaders ? validHeaders(JSON.parse(await decryptString(endpoint.encHeaders))) : {}
  if (endpoint.authStyle !== "none") headers.Authorization = `Bearer ${apiKey}`
  const workflow = endpoint.encWorkflow ? validateComfyWorkflow(JSON.parse(await decryptString(endpoint.encWorkflow))) : undefined
  return { ...endpoint, baseUrl: normalizeBaseUrl(endpoint.baseUrl, endpoint.apiType), headers, apiKey, workflow }
}

export async function validateCustomConnection(userId: string, id: unknown, signal: AbortSignal) {
  const endpoint = await resolveCustomEndpoint(userId, id)
  const started = performance.now()
  try {
    if (endpoint.apiType === "comfyui") {
      const response = await providerFetch(endpoint.baseUrl + "/system_stats", { headers: endpoint.headers, cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) })
      if (!response.ok) throw new ApiError(providerError(response.status), 502)
      const stats = recordValue(await readProviderJson(response))
      if (!stats.system || !Array.isArray(stats.devices)) throw new ApiError("The endpoint did not return ComfyUI system metadata", 502)
      const models = endpoint.models
      return { models, modelsWithCapabilities: models.map(id => ({ id, contextWindow: 0 })), modelContextWindows: {}, latencyMs: Math.round(performance.now() - started), apiType: "comfyui", workflowConfigured: Boolean(endpoint.workflow) }
    }
    const response = await providerFetch(endpoint.baseUrl + "/models", { headers: endpoint.headers, cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) })
    if (!response.ok) throw new ApiError(response.status === 404 ? "Models endpoint not found; enter models manually" : providerError(response.status), response.status === 404 || response.status === 401 || response.status === 403 ? response.status : 502)
    const discovered = parseCustomModels(await readProviderJson(response))
    await prisma.$transaction(async transaction => {
      const settings = await transaction.userSettings.findUnique({ where: { userId } })
      const providers = recordValue(settings?.providers)
      const endpoints = customEndpoints(providers)
      const current = endpoints.find(candidate => candidate.id === id)
      if (!current || current.baseUrl !== endpoint.baseUrl) return
      current.discoveredModelContextWindows = discovered.modelContextWindows
      providers.custom = endpoints
      await transaction.userSettings.update({ where: { userId }, data: { providers: jsonProviders(providers) } })
    })
    return { ...discovered, latencyMs: Math.round(performance.now() - started) }
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new ApiError("Provider connection timed out or was cancelled", 504)
    throw error
  }
}

export async function normalizeImportedProviders(input: unknown): Promise<Record<string, unknown>> {
  const providers = recordValue(input)
  for (const name of ["openai", "gemini", "openrouter"]) {
    const value = recordValue(providers[name])
    const normalized: Record<string, unknown> = { activeModels: Array.isArray(value.activeModels) ? normalizeModels(value.activeModels) : [] }
    if (typeof value.enc === "string") normalized.enc = value.enc
    if (typeof value.apiKey === "string" && value.apiKey) normalized.enc = await encryptString(value.apiKey)
    if (typeof value.lastVerifiedAt === "string") normalized.lastVerifiedAt = value.lastVerifiedAt
    providers[name] = normalized
  }
  if (providers.custom !== undefined) {
    if (!Array.isArray(providers.custom) || providers.custom.length > 25) throw new ApiError("Invalid custom endpoints backup")
    const ids = new Set<string>()
    const normalized: CustomEndpoint[] = []
    for (const value of providers.custom) {
      const source = recordValue(value)
      if (typeof source.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(source.id) || ids.has(source.id)) throw new ApiError("Invalid or duplicate endpoint ID")
      ids.add(source.id)
      const existing: CustomEndpoint = { id: source.id, label: "", baseUrl: normalizeBaseUrl(source.baseUrl, source.apiType === "comfyui" ? "comfyui" : "openai-compatible"), authStyle: "bearer", models: [], contextWindow: 32000 }
      if (typeof source.enc === "string") existing.enc = source.enc
      if (typeof source.encHeaders === "string") existing.encHeaders = source.encHeaders
      if (typeof source.encWorkflow === "string") existing.encWorkflow = source.encWorkflow
      if (source.discoveredModelContextWindows !== undefined) {
        const windows = recordValue(source.discoveredModelContextWindows)
        normalizeModels(Object.keys(windows), 5000)
        existing.discoveredModelContextWindows = Object.fromEntries(Object.entries(windows).map(([model, value]) => [model, contextWindowValue(value)]))
      }
      normalized.push(await endpointInput(source, existing))
    }
    providers.custom = normalized
  }
  return encryptedBackupValue(JSON.parse(JSON.stringify(providers))) as Record<string, unknown>
}

function encryptedBackupValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(encryptedBackupValue)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(apiKey|password|authorization|headers|accessToken)$/i.test(key)).map(([key, nested]) => [key, encryptedBackupValue(nested)]))
}
