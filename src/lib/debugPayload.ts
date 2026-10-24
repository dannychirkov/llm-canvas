const DEBUG_STRING_LIMIT = 8192
const DEBUG_DOCUMENT_LIMIT = 32768

export function debugPreview(value: unknown, limit = DEBUG_DOCUMENT_LIMIT): unknown {
  let budget = limit
  const visit = (current: unknown, depth: number): unknown => {
    if (budget <= 0 || depth > 8) return "[debug preview truncated]"
    budget -= 16
    if (typeof current === "string") {
      const allowed = Math.min(DEBUG_STRING_LIMIT, budget)
      budget -= Math.min(current.length, allowed)
      if (/^data:[^,]*;base64,/.test(current)) return `[inline media omitted; ${current.length} characters]`
      return current.length > allowed ? current.slice(0, allowed) + ` [truncated; ${current.length} original characters]` : current
    }
    if (Array.isArray(current)) {
      const entries = current.slice(0, 100).map(entry => visit(entry, depth + 1))
      if (current.length > 100) entries.push(`[${current.length - 100} further items omitted]`)
      return entries
    }
    if (current && typeof current === "object") {
      const entries = Object.entries(current).slice(0, 100).map(([key, entry]) => [key, /^(authorization|cookie|apiKey|password|accessToken)$/i.test(key) ? "[redacted]" : visit(entry, depth + 1)])
      return Object.fromEntries(entries)
    }
    return current
  }
  return visit(value, 0)
}

function debugString(value: unknown): unknown {
  if (typeof value !== "string" || value.length <= DEBUG_DOCUMENT_LIMIT) return value
  return JSON.stringify({ truncated: true, originalCharacters: value.length, preview: value.slice(0, DEBUG_DOCUMENT_LIMIT) })
}

export function compactNodeData(data: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data }
  if (result.debugInfo) result.debugInfo = debugPreview(result.debugInfo)
  for (const key of ["rawResponse", "structuredResponse"]) result[key] = debugString(result[key])
  if (result.lastExecutionState && typeof result.lastExecutionState === "object") {
    const snapshot = { ...result.lastExecutionState } as Record<string, unknown>
    if (snapshot.requestPayload) snapshot.requestPayload = debugPreview(snapshot.requestPayload)
    if (typeof snapshot.finalPrompt === "string" && snapshot.finalPrompt.length > DEBUG_DOCUMENT_LIMIT) {
      snapshot.finalPrompt = debugString(snapshot.finalPrompt)
      snapshot.debugPromptTruncated = true
    }
    result.lastExecutionState = snapshot
  }
  if (result.status !== "processing" && Object.hasOwn(result, "streamingText")) result.streamingText = ""
  return result
}

export function compactCanvasDocument<Document extends { nodes: Array<{ data: Record<string, unknown> }> }>(document: Document): Document {
  return { ...document, nodes: document.nodes.map(node => ({ ...node, data: compactNodeData(node.data) })) }
}
