import { normalizeModels, recordValue } from "@/lib/providers/customTypes"

export interface CustomModelInfo {
  id: string
  contextWindow: number
}

export function parseCustomModels(payload: unknown) {
  const data = recordValue(payload).data
  const entries = Array.isArray(data) ? data.map(recordValue) : []
  const models = normalizeModels(entries.map(model => model.id), 5000)
  const byId = new Map(entries.map(model => [model.id, model]))
  const modelContextWindows: Record<string, number> = {}
  const modelsWithCapabilities: CustomModelInfo[] = models.map(id => {
    const model = byId.get(id)!
    const topProvider = recordValue(model.top_provider)
    const limits = recordValue(model.limits)
    const config = recordValue(model.config)
    const candidates = [model.context_length, model.context_window, model.contextWindow, model.max_context_length, model.max_model_len, model.max_position_embeddings, topProvider.context_length, limits.context_window, config.max_position_embeddings, model.max_input_tokens]
    const contextWindow = candidates.map(value => typeof value === "number" || typeof value === "string" ? Number(value) : NaN).find(value => Number.isSafeInteger(value) && value >= 128 && value <= 100_000_000) ?? 0
    if (contextWindow) modelContextWindows[id] = contextWindow
    return { id, contextWindow }
  })
  return { models, modelsWithCapabilities, modelContextWindows }
}
