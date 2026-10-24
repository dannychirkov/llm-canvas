import { withApiBoundary } from "@/lib/apiBoundary"
import { readBoundedJson } from "@/lib/requestBody"
import { NextRequest, NextResponse } from "next/server"
import { requireUserId, requireCanvasAccess } from "@/lib/providerCredentials"
import { prisma } from "@/lib/prisma"
import { ApiError, publicError, errorStatus } from "@/lib/apiErrors"

async function boundaryPOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId()
    const { id: canvasId } = await params
    await requireCanvasAccess(userId, canvasId)
    const body = await readBoundedJson(request)
    if (typeof body.executionId !== "string") throw new ApiError("A server execution receipt is required; usage is recorded by the execution route")
    const receipt = await prisma.tokenUsage.findFirst({ where: { id: body.executionId, canvasId, canvas: { userId } }, select: { id: true } })
    if (!receipt) throw new ApiError("Execution receipt not found", 404)
    const canvas = await prisma.canvas.findUnique({ where: { id: canvasId }, select: { totalTokensUsed: true } })
    return NextResponse.json({ success: true, executionId: receipt.id, usageRecorded: true, totalTokensUsed: canvas?.totalTokensUsed ?? 0 })
  } catch (failure) {
    return NextResponse.json({ error: publicError(failure) }, { status: errorStatus(failure) })
  }
}

export function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withApiBoundary(request, () => boundaryPOST(request, { params }))
}
