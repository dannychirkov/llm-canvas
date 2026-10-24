import { withApiBoundary } from "@/lib/apiBoundary"
import { authenticatedWorkload } from "@/lib/authenticatedWorkload"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { calculateCanvasMetrics, parseCanvasDocument } from "@/lib/canvasMetrics"
import { ApiError } from "@/lib/apiErrors"
import { trackCanvasUpdated, trackCanvasDeleted } from "@/lib/analytics"
import { parseCanonicalGraph, synchronizeCanvasNodes } from "@/lib/canonicalGraph"
import { withStorageReservation } from "@/lib/storageUtils"
import { cleanupCanvasMedia } from "@/lib/safeMedia"
import { readCanvasBody, canvasMetadata, canvasRecordBytes, graphNodeBytes, compactCanvasSelect, canvasFailure } from "@/lib/canvasPersistence"
import { compactCanvasDocument } from "@/lib/debugPayload"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) throw new ApiError("Unauthorized", 401)
    const { id } = await params
    const canvas = await prisma.canvas.findFirst({ where: { id, userId: session.user.id } })
    if (!canvas) throw new ApiError("Canvas not found", 404)
    const content = canvas.content ? JSON.stringify(compactCanvasDocument(parseCanonicalGraph(canvas.content))) : canvas.content
    return NextResponse.json({ ...canvas, content }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) { return canvasFailure(error) }
}

async function boundaryDELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) throw new ApiError("Unauthorized", 401)
    const { id } = await params
    const canvas = await prisma.canvas.findFirst({ where: { id, userId: session.user.id }, select: { id: true, title: true } })
    if (!canvas) throw new ApiError("Canvas not found", 404)
    const removed = await prisma.canvas.deleteMany({ where: { id, userId: session.user.id } })
    if (!removed.count) throw new ApiError("Canvas not found", 404)
    let warning: string | undefined
    try { await cleanupCanvasMedia(id) } catch {
      console.error({ event: "canvas_media_cleanup_failed" })
      warning = "Canvas deleted; media cleanup could not be completed"
    }
    trackCanvasDeleted({ canvas_id: id, canvas_title: canvas.title, canvas_type: "default" })
    return NextResponse.json({ success: true, ...(warning ? { warning } : {}) }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) { return canvasFailure(error) }
}

async function handlePUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) throw new ApiError("Unauthorized", 401)
    const userId = session.user.id
    const { id } = await params
    const body = await readCanvasBody(request)
    const metadata = canvasMetadata(body)
    const writesContent = Object.hasOwn(body, "content")
    if (!writesContent && !Object.keys(metadata).length) throw new ApiError("A title, description or content update is required")
    if (writesContent && body.expectedUpdatedAt === undefined) throw new ApiError("expectedUpdatedAt is required for content updates", 428)
    if (body.expectedUpdatedAt !== undefined && (typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt)))) throw new ApiError("Invalid expectedUpdatedAt")
    const existing = await prisma.canvas.findFirst({ where: { id, userId } })
    if (!existing) throw new ApiError("Canvas not found", 404)
    const expected = body.expectedUpdatedAt === undefined ? existing.updatedAt : new Date(body.expectedUpdatedAt as string)
    if (expected.getTime() !== existing.updatedAt.getTime()) throw new ApiError("Canvas changed; reload before saving", 409)
    const document = writesContent ? compactCanvasDocument(parseCanvasDocument(body.content)) : undefined
    const graph = document ? parseCanonicalGraph(document) : undefined
    const metrics = document ? await calculateCanvasMetrics(document) : undefined
    const content = document ? JSON.stringify(document) : existing.content
    const title = metadata.title ?? existing.title
    const description = metadata.description === undefined ? existing.description : metadata.description
    let nodeDelta = 0
    if (graph) {
      const [current] = await prisma.$queryRaw<Array<{ bytes: bigint | number }>>`SELECT COALESCE(SUM(length(CAST(data AS BLOB)) + length(CAST(position AS BLOB)) + 128), 0) AS bytes FROM nodes WHERE canvasId = ${id}`
      nodeDelta = graphNodeBytes(graph) - Number(current.bytes)
    }
    const additionalBytes = Math.max(0, canvasRecordBytes(content, title, description) - canvasRecordBytes(existing.content, existing.title, existing.description) + nodeDelta)
    const updatedAt = new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1))
    const canvas = await withStorageReservation(userId, additionalBytes, async () => prisma.$transaction(async tx => {
      const updated = await tx.canvas.updateMany({ where: { id, userId, updatedAt: expected }, data: { ...metadata, ...(graph ? { content, ...metrics } : {}), updatedAt } })
      if (!updated.count) throw new ApiError("Canvas changed; reload before saving", 409)
      if (graph) {
        let previousIds: Set<string>
        try { previousIds = new Set(parseCanonicalGraph(existing.content).nodes.map(node => node.id)) }
        catch { previousIds = new Set((await tx.node.findMany({ where: { canvasId: id }, select: { id: true } })).map(node => node.id)) }
        const added = graph.nodes.filter(node => !previousIds.has(node.id)).length
        await synchronizeCanvasNodes(tx, id, graph)
        if (added) await tx.user.update({ where: { id: userId }, data: { totalNodesCreated: { increment: added } } })
      }
      return tx.canvas.findUniqueOrThrow({ where: { id }, select: compactCanvasSelect })
    }, { timeout: 30000 }))
    trackCanvasUpdated({ canvas_id: id, canvas_title: canvas.title, canvas_type: "default" })
    return NextResponse.json(canvas, { headers: { "Cache-Control": "no-store" } })
  } catch (error) { return canvasFailure(error) }
}

async function boundaryPUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return authenticatedWorkload("write", () => handlePUT(request, { params }))
}

export function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withApiBoundary(request, () => boundaryDELETE(request, { params }))
}

export function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withApiBoundary(request, () => boundaryPUT(request, { params }))
}
