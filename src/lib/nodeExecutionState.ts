import type { Node } from "reactflow"
import { compactNodeData } from "./debugPayload"

/** Apply the same execution/edit rules to React state and a batch's private graph. */
export function patchExecutionNode(node: Node, patch: Record<string, unknown>): Node {
  const previous = node.data || {}
  const merged = { ...previous, ...patch }
  const previousStatus = String(previous.status || "idle")
  let status = typeof patch.status === "string" ? patch.status : previousStatus
  const snapshot = merged.lastExecutionState
  if (snapshot) {
    const fields = [
      "promptText", "summaryText", "textContent", "modelName", "endpointId", "mode", "imageResponseFormat",
      "temperature", "max_tokens", "top_p", "seed", "responseText", "summaryLength", "summaryStyle",
      "autoStrategy", "contextWindow", "textLength",
    ].filter(field => node.type !== "summarizer" || !["promptText", "textContent", "mode", "imageResponseFormat"].includes(field))
    if (node.type === "summarizer") fields.push("provider")
    const value = (data: Record<string, unknown>, field: string) => {
      if (field === "mode" && node.type === "custom") return data[field] ?? "chat"
      if (field === "mode" && node.type === "nanobanana") return data[field] ?? "text-to-image"
      if (field === "imageResponseFormat" && (node.type === "custom" || node.type === "nanobanana")) return data[field] ?? "auto"
      return data[field]
    }
    const changed = fields.some(field => value(merged, field) !== value(snapshot, field))
    const matches = fields.every(field => !(field in snapshot) || value(merged, field) === value(snapshot, field))
    if (typeof patch.status !== "string" || patch.status === "done") {
      if ((previousStatus === "done" || patch.status === "done") && changed) status = "edited"
      else if (previousStatus === "edited" && matches) status = "done"
    }
  }
  return { ...node, data: compactNodeData({ ...merged, status }) }
}
