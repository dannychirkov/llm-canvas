import { withApiBoundary } from "@/lib/apiBoundary"
import { authenticatedWorkload } from "@/lib/authenticatedWorkload"
import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { ApiError } from "@/lib/apiErrors"
import { getRandomPresetPrompt } from "@/lib/presetPrompts"
import { trackCanvasCreated } from "@/lib/analytics"
import { invalidateCanvasCache, shouldUpdateCache } from "@/lib/cacheUtils"
import { parseCanonicalGraph, synchronizeCanvasNodes } from "@/lib/canonicalGraph"
import { withStorageReservation } from "@/lib/storageUtils"
import { readCanvasBody, canvasMetadata, canvasRecordBytes, graphNodeBytes, canvasFailure } from "@/lib/canvasPersistence"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) throw new ApiError("Unauthorized", 401)
    const canvases = await prisma.canvas.findMany({
      where: { userId: session.user.id },
      select: {
        id: true, title: true, description: true, createdAt: true, updatedAt: true,
        isPublic: true, isPinned: true, nodeCount: true, largestContextTokens: true,
        contextCacheUpdated: true, totalTokensUsed: true
      },
      orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }]
    })
    for (const canvas of canvases) {
      if (!canvas.largestContextTokens || shouldUpdateCache(canvas.contextCacheUpdated)) {
        const metrics = await invalidateCanvasCache(canvas.id)
        if (metrics) Object.assign(canvas, metrics)
      }
    }
    return NextResponse.json(canvases.map(canvas => ({
      ...canvas, nodeCount: canvas.nodeCount || 0, largestContextTokens: canvas.largestContextTokens || 0, totalTokensUsed: canvas.totalTokensUsed || 0
    })), { headers: { "Cache-Control": "no-store" } })
  } catch (error) { return canvasFailure(error) }
}

async function handlePOST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) throw new ApiError("Unauthorized", 401)
    const userId = session.user.id
    const metadata = canvasMetadata(await readCanvasBody(request), true)
    const title = metadata.title!
    const description = metadata.description ?? ""
    const graph = parseCanonicalGraph({ nodes: [
      { id: randomUUID(), type: "memory", position: { x: -300, y: -150 }, data: { title: "Permanent Memory", value: "", hidden: false } },
      { id: randomUUID(), type: "gemini", position: { x: 100, y: 0 }, data: { title: "Gemini", promptText: getRandomPresetPrompt(), status: "idle", hidden: false } }
    ], edges: [] })
    const content = JSON.stringify(graph)
    const bytes = canvasRecordBytes(content, title, description) + graphNodeBytes(graph)
    const canvas = await withStorageReservation(userId, bytes, async () => prisma.$transaction(async tx => {
      const created = await tx.canvas.create({ data: { id: randomUUID(), userId, title, description, content, nodeCount: graph.nodes.length } })
      await synchronizeCanvasNodes(tx, created.id, graph)
      await tx.user.update({ where: { id: userId }, data: { totalCanvasesCreated: { increment: 1 }, totalNodesCreated: { increment: graph.nodes.length } } })
      return created
    }, { timeout: 30000 }))
    trackCanvasCreated({ canvas_id: canvas.id, canvas_title: canvas.title, canvas_type: "default" })
    return NextResponse.json(canvas, { status: 201, headers: { "Cache-Control": "no-store" } })
  } catch (error) { return canvasFailure(error) }
}

async function boundaryPOST(request: NextRequest) {
  return authenticatedWorkload("write", () => handlePOST(request))
}

export function POST(request: NextRequest) {
  return withApiBoundary(request, () => boundaryPOST(request))
}
