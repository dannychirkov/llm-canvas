import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { aggregateNodeUsage } from "@/lib/tokenUsage"

/**
 * GET /api/canvas/[id]/token-statistics
 * Returns aggregated token statistics from database (TokenUsage table)
 * This includes all executed nodes, including deleted ones
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: canvasId } = await params

    if (!canvasId || !/^[a-zA-Z0-9_-]{1,200}$/.test(canvasId)) {
      return NextResponse.json(
        { error: "Invalid canvas ID format" },
        { status: 400 }
      )
    }

    // Check if canvas exists and belongs to user
    const canvas = await prisma.canvas.findFirst({
      where: {
        id: canvasId,
        userId: session.user.id
      },
      select: { id: true }
    })

    if (!canvas) {
      return NextResponse.json(
        { error: "Canvas not found" },
        { status: 404 }
      )
    }

    // Get all token usage records for this canvas
    const tokenUsageRecords = await prisma.tokenUsage.findMany({
      where: { canvasId },
      orderBy: { createdAt: 'asc' }
    })

    const stats = aggregateNodeUsage(tokenUsageRecords.map(record => ({
      id: record.id, type: record.operator, position: { x: 0, y: 0 },
      data: { status: "done", modelName: record.modelName, tokens: record.totalTokens, usageSource: record.usageSource ?? "legacy", tokenBreakdown: {
        inputTokens: record.inputTokens ?? undefined, outputTokens: record.outputTokens ?? undefined,
        reasoningTokens: record.reasoningTokens ?? undefined, cachedTokens: record.cachedTokens ?? undefined,
        audioTokens: record.audioTokens ?? undefined, videoTokens: record.videoTokens ?? undefined, imageTokens: record.imageTokens ?? undefined
      } }
    })))

    return NextResponse.json(stats)
  } catch (error) {
    console.error("Error fetching token statistics:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

