import { withApiBoundary } from "@/lib/apiBoundary"
import { authenticatedWorkload } from "@/lib/authenticatedWorkload"
import { readBoundedJson } from "@/lib/requestBody"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { ApiError } from "@/lib/apiErrors"
import { parseCanonicalGraph, synchronizeCanvasNodes } from "@/lib/canonicalGraph"
import { withStorageReservation } from "@/lib/storageUtils"

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof ApiError ? error.message : "Notes operation failed" }, { status: error instanceof ApiError ? error.status : 500 })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) throw new ApiError("Unauthorized", 401)
    const { id } = await params
    const canvasId = new URL(request.url).searchParams.get("canvasId")
    if (!canvasId) throw new ApiError("canvasId is required")
    const canvas = await prisma.canvas.findFirst({ where: { id: canvasId, userId: session.user.id } })
    if (!canvas) throw new ApiError("Canvas not found", 404)
    const node = parseCanonicalGraph(canvas.content).nodes.find(node => node.id === id)
    if (!node) throw new ApiError("Node not found", 404)
    return NextResponse.json({ notes: typeof node.data.notes === "string" ? node.data.notes : "", updatedAt: canvas.updatedAt.toISOString() }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) { return failure(error) }
}

async function handlePUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) throw new ApiError("Unauthorized", 401)
    const userId = session.user.id
    const { id } = await params
    const body = await readBoundedJson(request, 6 * 1024 * 1024 + 65536)
    const { notes, canvasId, expectedUpdatedAt } = body
    if (typeof canvasId !== "string" || typeof notes !== "string" || Buffer.byteLength(notes) > 1024 * 1024) throw new ApiError("Valid canvasId and notes (maximum 1MB) are required")
    if (typeof expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(expectedUpdatedAt))) throw new ApiError("expectedUpdatedAt is required", 428)
    const canvas = await prisma.canvas.findFirst({ where: { id: canvasId, userId } })
    if (!canvas) throw new ApiError("Canvas not found", 404)
    if (canvas.updatedAt.toISOString() !== expectedUpdatedAt) throw new ApiError("Canvas changed; reload notes before saving", 409)
    const graph = parseCanonicalGraph(canvas.content)
    const node = graph.nodes.find(node => node.id === id)
    if (!node) throw new ApiError("Node not found", 404)
    node.data.notes = notes
    const content = JSON.stringify(graph)
    const extraBytes = Math.max(0, Buffer.byteLength(content) - Buffer.byteLength(canvas.content ?? "")) * 2 + 1024
    const updatedAt = new Date(Math.max(Date.now(), canvas.updatedAt.getTime() + 1))
    await withStorageReservation(userId, extraBytes, async () => prisma.$transaction(async tx => {
      const updated = await tx.canvas.updateMany({ where: { id: canvasId, userId, updatedAt: new Date(expectedUpdatedAt) }, data: { content, updatedAt } })
      if (!updated.count) throw new ApiError("Canvas changed; reload notes before saving", 409)
      await synchronizeCanvasNodes(tx, canvasId, graph)
    }))
    return NextResponse.json({ success: true, notes, baseUpdatedAt: expectedUpdatedAt, updatedAt: updatedAt.toISOString() }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) { return failure(error) }
}

async function boundaryPUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return authenticatedWorkload("write", () => handlePUT(request, { params }))
}

export function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withApiBoundary(request, () => boundaryPUT(request, { params }))
}
