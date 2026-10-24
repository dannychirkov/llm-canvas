import { readBoundedJson } from "./requestBody"
import { ApiError } from "@/lib/apiErrors"
import type { CanonicalGraph } from "@/lib/canonicalGraph"

export const MAX_CANVAS_REQUEST_BYTES = 128 * 1024 * 1024

export const compactCanvasSelect = {
  id: true, title: true, description: true, isPublic: true, isPinned: true,
  createdAt: true, updatedAt: true, userId: true, nodeCount: true,
  largestContextTokens: true, contextCacheUpdated: true, totalTokensUsed: true
} as const

export async function readCanvasBody(request: Request): Promise<Record<string, unknown>> {
  return readBoundedJson(request, MAX_CANVAS_REQUEST_BYTES, 120_000)
}

export function canvasMetadata(body: Record<string, unknown>, creating = false): { title?: string; description?: string | null } {
  const metadata: { title?: string; description?: string | null } = {}
  if (creating || Object.hasOwn(body, "title")) {
    if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 200) throw new ApiError("Title must contain between 1 and 200 characters")
    metadata.title = body.title.trim()
  }
  if (Object.hasOwn(body, "description")) {
    if (body.description !== null && (typeof body.description !== "string" || body.description.length > 10000)) throw new ApiError("Description must be text up to 10000 characters or null")
    metadata.description = body.description as string | null
  }
  return metadata
}

export function canvasRecordBytes(content: string | null, title: string, description: string | null): number {
  return Buffer.byteLength(content ?? "") + Buffer.byteLength(title) + Buffer.byteLength(description ?? "") + 256
}

export function graphNodeBytes(graph: CanonicalGraph): number {
  return graph.nodes.reduce((total, node) => total + Buffer.byteLength(JSON.stringify(node.data)) + Buffer.byteLength(JSON.stringify(node.position ?? { x: 0, y: 0 })) + 128, 0)
}

export function canvasFailure(error: unknown): Response {
  const conflict = error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code))
  return Response.json({ error: error instanceof ApiError ? error.message : conflict ? "Canvas changed; reload before saving" : "Canvas operation failed" }, { status: error instanceof ApiError ? error.status : conflict ? 409 : 500 })
}
