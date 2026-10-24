import { ApiError } from "@/lib/apiErrors"

type WorkflowValue = null | boolean | number | string | WorkflowValue[] | { [key: string]: WorkflowValue }
export type ComfyWorkflowTemplate = Record<string, { class_type: string; inputs: Record<string, WorkflowValue> }>
export const MAX_COMFY_WORKFLOW_BYTES = 512 * 1024
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"])
const placeholder = /\{\{([^{}]+)\}\}/g

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
}

/** Validate an API graph, not the frontend's nodes/links layout export. */
export function validateComfyWorkflow(input: unknown): ComfyWorkflowTemplate {
  let bytes: number
  try { bytes = Buffer.byteLength(JSON.stringify(input) ?? "", "utf8") } catch { throw new ApiError("Invalid ComfyUI workflow") }
  if (bytes > MAX_COMFY_WORKFLOW_BYTES) throw new ApiError("ComfyUI workflow exceeds 512 KiB")
  if (!object(input) || !Object.keys(input).length || Object.keys(input).length > 500) throw new ApiError("ComfyUI workflow must contain between 1 and 500 API nodes")
  let hasPrompt = false
  function value(item: unknown, depth: number): WorkflowValue {
    if (depth > 20) throw new ApiError("ComfyUI workflow exceeds the nesting limit")
    if (item === null || typeof item === "boolean") return item
    if (typeof item === "number" && Number.isFinite(item)) return item
    if (typeof item === "string") {
      const tokens = [...item.matchAll(placeholder)]
      if (item.replace(placeholder, "").includes("{{") || item.replace(placeholder, "").includes("}}")) throw new ApiError("Invalid ComfyUI workflow placeholder")
      for (const match of tokens) {
        if (match[1] === "prompt") hasPrompt = true
        else if (match[1] !== "model" && match[1] !== "seed" && !/^image:[0-3]$/.test(match[1])) throw new ApiError("Unknown ComfyUI workflow placeholder")
        if ((match[1] === "seed" || match[1].startsWith("image:")) && item !== match[0]) throw new ApiError("ComfyUI seed and image placeholders must occupy an entire value")
      }
      return item
    }
    if (Array.isArray(item)) return item.map(entry => value(entry, depth + 1))
    if (!object(item)) throw new ApiError("Invalid ComfyUI workflow value")
    return Object.fromEntries(Object.entries(item).map(([key, entry]) => {
      if (unsafeKeys.has(key) || /\{\{|\}\}/.test(key)) throw new ApiError("Invalid ComfyUI workflow key")
      return [key, value(entry, depth + 1)]
    }))
  }
  const graph: ComfyWorkflowTemplate = {}
  for (const [id, node] of Object.entries(input)) {
    if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(id) || unsafeKeys.has(id) || !object(node) || typeof node.class_type !== "string" || !node.class_type.trim() || node.class_type.length > 256 || /\{\{|\}\}/.test(node.class_type) || !object(node.inputs)) throw new ApiError("Use a ComfyUI API workflow with class_type and inputs for every node")
    // Layout titles, extra_pnginfo and unrelated metadata are not execution inputs.
    graph[id] = { class_type: node.class_type, inputs: value(node.inputs, 1) as Record<string, WorkflowValue> }
  }
  if (!hasPrompt) throw new ApiError("ComfyUI workflow must contain a {{prompt}} placeholder")
  return graph
}

export function comfyImageIndices(template: ComfyWorkflowTemplate): number[] {
  const found = new Set<number>()
  function visit(value: WorkflowValue): void {
    if (typeof value === "string") {
      const match = /^\{\{image:([0-3])\}\}$/.exec(value)
      if (match) found.add(Number(match[1]))
    } else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === "object") Object.values(value).forEach(visit)
  }
  Object.values(template).forEach(node => visit(node.inputs))
  return [...found].sort((a, b) => a - b)
}

export function renderComfyWorkflow(template: ComfyWorkflowTemplate, bindings: { prompt: string; model: string; seed: number; images: string[] }): ComfyWorkflowTemplate {
  function replace(value: WorkflowValue): WorkflowValue {
    if (typeof value === "string") {
      if (value === "{{seed}}") return bindings.seed
      const image = /^\{\{image:([0-3])\}\}$/.exec(value)
      if (image) {
        const filename = bindings.images[Number(image[1])]
        if (!filename) throw new ApiError("ComfyUI workflow requires a missing image attachment")
        return filename
      }
      // A single pass never interprets placeholders or JSON in user-supplied text.
      return value.replace(placeholder, (_, token: string) => token === "prompt" ? bindings.prompt : bindings.model)
    }
    if (Array.isArray(value)) return value.map(replace)
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replace(entry)]))
    return value
  }
  return Object.fromEntries(Object.entries(template).map(([id, node]) => [id, { class_type: node.class_type, inputs: replace(node.inputs) as Record<string, WorkflowValue> }]))
}
