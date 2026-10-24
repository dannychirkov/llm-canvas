import { withWorkload } from "@/lib/workloadBudget"
import type { RequestOptions, ImageData, CsvFileData, VideoAttachment, SummaryLength, SummaryStyle } from "@/types"
import type { ProviderId } from "@/lib/providers/registry"
import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { requireUserId, requireCanvasAccess } from "@/lib/providerCredentials"
import { ApiError, publicError, errorStatus } from "@/lib/apiErrors"
import { parseTokenUsageFromRawResponse } from "@/lib/tokenParser"
import { tokenCount, usageTotal, type UsageBreakdown } from "@/lib/tokenUsage"
import { isProviderId } from "@/lib/providers/registry"
import { withUsageObserver } from "@/lib/usageObservation"
import { compactNodeData, debugPreview } from "@/lib/debugPayload"
import { readCanvasBody } from "@/lib/canvasPersistence"
export { observeProviderUsage } from "@/lib/usageObservation"

type Payload = Record<string, unknown>
type UsageSource = "provider" | "estimated" | "unreported"

interface UsageContext {
  userId: string
  canvasId?: string
  executionId: string
  body: Payload
  records: number
  observedTokens: number
  source: UsageSource
  breakdown: UsageBreakdown
  receipt?: { executionId: string; usageRecorded: boolean; canvasTotalTokensUsed: number }
}

function record(value: unknown): Payload {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Payload : {}
}

export function normalizeExecutionUsage(body: Payload, output: Payload) {
  const provider = isProviderId(body.provider) ? body.provider : undefined
  const parsed = typeof output.rawResponse === "string" ? parseTokenUsageFromRawResponse(output.rawResponse, provider) : null
  const tokenBreakdown = parsed ?? record(output.tokenBreakdown) as UsageBreakdown
  const reported = parsed?.totalTokens ?? tokenCount(output.tokens)
  const hasDetails = tokenCount(tokenBreakdown.inputTokens) !== undefined || tokenCount(tokenBreakdown.outputTokens) !== undefined
  const explicitSource = output.usageSource as UsageSource | undefined
  const known = !!parsed || explicitSource === "provider" || (explicitSource !== "estimated" && explicitSource !== "unreported" && (hasDetails || !!output.strategy) && reported !== undefined)
  const responseText = typeof output.responseText === "string" ? output.responseText : typeof output.fullResponse === "string" ? output.fullResponse : ""
  const prompt = typeof body.finalPrompt === "string" ? body.finalPrompt : typeof body.text === "string" ? body.text : ""
  const estimate = responseText ? Math.ceil((prompt.length + responseText.length) / 4) : 0
  const usageSource: UsageSource = known ? "provider" : explicitSource === "unreported" ? "unreported" : estimate > 0 ? "estimated" : "unreported"
  return { ...output, tokens: known ? usageTotal(reported, tokenBreakdown, provider) : usageSource === "estimated" ? explicitSource === "estimated" && reported !== undefined ? reported : estimate : 0, tokenBreakdown: known ? tokenBreakdown : null, usageSource }
}

export async function recordExecutionUsage(userId: string, canvasId: string, executionId: string, provider: string, modelName: string, output: ReturnType<typeof normalizeExecutionUsage>) {
  return prisma.$transaction(async transaction => {
    const canvas = await transaction.canvas.findFirst({ where: { id: canvasId, userId }, select: { id: true, totalTokensUsed: true, updatedAt: true } })
    if (!canvas) throw new ApiError("Canvas not found", 404)
    const existing = await transaction.tokenUsage.findUnique({ where: { id: executionId } })
    if (existing) {
      if (existing.canvasId !== canvasId) throw new ApiError("Execution receipt conflict", 409)
      return { executionId, usageRecorded: true, canvasTotalTokensUsed: canvas.totalTokensUsed ?? 0 }
    }
    const initialCounter = canvas.totalTokensUsed === null ? (await transaction.tokenUsage.aggregate({ where: { canvasId }, _sum: { totalTokens: true } }))._sum.totalTokens ?? 0 : 0
    const breakdown = output.tokenBreakdown ?? {}
    await transaction.tokenUsage.create({ data: {
      id: executionId, canvasId, operator: provider, modelName, totalTokens: output.tokens,
      inputTokens: breakdown.inputTokens, outputTokens: breakdown.outputTokens,
      reasoningTokens: breakdown.reasoningTokens, cachedTokens: breakdown.cachedTokens,
      audioTokens: breakdown.audioTokens, videoTokens: breakdown.videoTokens, imageTokens: breakdown.imageTokens,
      otherTools: Math.max(0, output.tokens - usageTotal(undefined, breakdown, provider)),
      usageSource: output.usageSource
    } })
    await transaction.canvas.updateMany({ where: { id: canvasId, totalTokensUsed: null }, data: { totalTokensUsed: initialCounter } })
    const updated = await transaction.canvas.update({ where: { id: canvasId }, data: { totalTokensUsed: { increment: output.tokens }, updatedAt: canvas.updatedAt }, select: { totalTokensUsed: true } })
    await transaction.user.update({ where: { id: userId }, data: { totalTokensCreated: { increment: output.tokens } } })
    return { executionId, usageRecorded: true, canvasTotalTokensUsed: updated.totalTokensUsed ?? 0 }
  })
}

async function observeUsage(context: UsageContext, output: Payload, finalPrompt?: string) {
  if (!context.canvasId) return
  const normalized = normalizeExecutionUsage(finalPrompt === undefined ? context.body : { ...context.body, finalPrompt }, output)
  const id = context.executionId + "_step_" + (context.records + 1)
  context.receipt = await recordExecutionUsage(context.userId, context.canvasId, id, String(context.body.provider), typeof context.body.modelName === "string" ? context.body.modelName : context.body.provider === "nanobanana" ? "gemini-2.5-flash-image" : "Unknown", normalized)
  context.records++
  context.observedTokens += normalized.tokens
  if (normalized.usageSource !== "provider") context.source = normalized.usageSource
  for (const field of ["inputTokens", "outputTokens", "reasoningTokens", "cachedTokens", "audioTokens", "videoTokens", "imageTokens"] as const) {
    if (normalized.tokenBreakdown?.[field] !== undefined) context.breakdown[field] = (context.breakdown[field] ?? 0) + normalized.tokenBreakdown[field]!
  }
}

type ExecutionInput = Payload & RequestOptions & {
  provider?: ProviderId; canvasId?: string; endpointId?: string; modelName?: string
  finalPrompt?: string; images?: ImageData[]; csvFiles?: CsvFileData[]; videos?: VideoAttachment[]
  mode?: string; useTools?: boolean; text?: string; summaryLength?: SummaryLength; summaryStyle?: SummaryStyle
}
const requestInputs = new WeakMap<Request, ExecutionInput>()
export async function executionRequestBody(request: Request): Promise<ExecutionInput> {
  const body = requestInputs.get(request)
  if (!body) throw new ApiError("Execution input is unavailable")
  return body
}

export async function withExecutionAccounting<TRequest extends Request>(request: TRequest, execute: (request: TRequest) => Promise<Response>): Promise<Response> {
  try {
    const userId = await requireUserId()
    return await withWorkload(userId, "execution", () => accountExecution(request, execute, userId))
  } catch (failure) {
    return Response.json({ error: publicError(failure) }, { status: errorStatus(failure), headers: errorStatus(failure) === 429 ? { "Retry-After": "1" } : undefined })
  }
}

async function accountExecution<TRequest extends Request>(request: TRequest, execute: (request: TRequest) => Promise<Response>, userId: string): Promise<Response> {
  let context: UsageContext | undefined
  try {
    const body = await readCanvasBody(request) as ExecutionInput
    requestInputs.set(request, body)
    const canvasId = typeof body.canvasId === "string" ? body.canvasId : undefined
    if (canvasId) await requireCanvasAccess(userId, canvasId)
    const executionId = "execution_" + randomUUID()
    context = { userId, canvasId, executionId, body, records: 0, observedTokens: 0, source: "provider", breakdown: {} }
    const current = context
    const finalize = async (value: Payload) => {
      const normalized = normalizeExecutionUsage(body, value)
      const receipt = current.receipt ?? (canvasId ? await recordExecutionUsage(userId, canvasId, executionId, String(body.provider), typeof body.modelName === "string" ? body.modelName : body.provider === "nanobanana" ? "gemini-2.5-flash-image" : "Unknown", normalized) : { executionId, usageRecorded: false })
      return { ...compactNodeData(normalized), ...(value.providerRequestPayload ? { providerRequestPayload: debugPreview(value.providerRequestPayload) } : {}), ...receipt }
    }
    const response = await withUsageObserver((value, prompt) => observeUsage(current, value, prompt), () => execute(request))
    const partialUsage = () => ({ ...(current.receipt ?? {}), partialUsageTokens: current.observedTokens, usageSource: current.source, tokenBreakdown: current.breakdown })
    if (!response.ok || !response.body) {
      if (current.records) return Response.json({ error: "Provider execution failed", ...partialUsage() }, { status: response.ok ? 502 : response.status })
      return response
    }
    if (response.headers.get("Content-Type")?.includes("application/json")) {
      const value = record(await response.json())
      return Response.json(value.error ? value : await finalize(value), { status: response.status, headers: { "Cache-Control": "no-store" } })
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let buffer = ""
    let finished = false
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const emit = async (line: string) => {
            if (!line.startsWith("data:")) return
            const text = line.slice(5).trim()
            if (!text || text === "[DONE]") return
            const value = record(JSON.parse(text))
            if (finished) return
            if (value.error || value.type === "error") {
              finished = true
              Object.assign(value, partialUsage())
            }
            if (value.done || value.type === "done") {
              const result = await finalize(value)
              finished = true
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(result)}\n\n`))
            } else controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
          }
          const chunk = await reader.read()
          buffer += decoder.decode(chunk.value, { stream: !chunk.done })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""
          for (const line of lines) await emit(line)
          if (chunk.done) {
            if (buffer.trim()) await emit(buffer)
            if (!finished) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Provider stream ended before completion", type: "error", ...partialUsage() })}\n\n`))
            controller.close()
            reader.releaseLock()
          }
        } catch (failure) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: publicError(failure), type: "error", ...partialUsage() })}\n\n`))
          controller.close()
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
      },
      async cancel() { await reader.cancel().catch(() => {}); reader.releaseLock() }
    })
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" } })
  } catch (failure) {
    return Response.json({ error: publicError(failure), ...(context?.receipt ?? {}), ...(context?.observedTokens ? { partialUsageTokens: context.observedTokens, usageSource: context.source, tokenBreakdown: context.breakdown } : {}) }, { status: errorStatus(failure) })
  } finally { requestInputs.delete(request) }
}
