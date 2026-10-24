import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { calculateUserStorageUsage } from "@/lib/storageUtils"
import { join } from "path"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.user.id

    // Get active projects (canvases) - current count
    const activeCanvases = await prisma.canvas.count({
      where: {
        userId
      }
    })

    // Get all canvases with cached values
    const canvases = await prisma.canvas.findMany({
      where: {
        userId
      },
      select: {
        id: true,
        nodeCount: true,
        largestContextTokens: true,
        totalTokensUsed: true,
        createdAt: true
      }
    })

    // Get media count for storage calculation
    const mediaCount = await prisma.media.count({
      where: { 
        canvas: { userId }
      }
    })

    // Calculate active values (current state)
    let activeNodes = 0
    let activeTokens = 0

    // Use cached values directly
    for (const canvas of canvases) {
      const nodeCount = canvas.nodeCount || 0
      const tokensUsed = canvas.totalTokensUsed || 0
      
      activeNodes += nodeCount
      activeTokens += tokensUsed
    }

    // Calculate average nodes per canvas for both modes
    const activeAvgNodesPerCanvas = activeCanvases > 0 ? activeNodes / activeCanvases : 0

    // Get user's canvas IDs for storage calculation
    const userCanvasIds = canvases.map((canvas: typeof canvases[number]) => canvas.id)
    
    // Calculate storage usage
    const storageUsage = await calculateUserStorageUsage(
      userId,
      activeCanvases,
      activeNodes,
      mediaCount,
      userCanvasIds
    )

    // Get user info including total statistics
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        isOwner: true,
        totalNodesCreated: true,
        totalCanvasesCreated: true,
        totalTokensCreated: true
      }
    })

    const isOwner = user?.isOwner ?? false

    // Total values (cumulative statistics)
    const totalCanvases = user?.totalCanvasesCreated ?? 0
    const totalNodes = user?.totalNodesCreated ?? 0
    const totalTokens = user?.totalTokensCreated ?? 0
    const totalAvgNodesPerCanvas = totalCanvases > 0 ? totalNodes / totalCanvases : 0

    const statistics = {
      active: {
        canvases: activeCanvases,
        nodes: activeNodes,
        tokens: activeTokens,
        avgNodesPerCanvas: activeAvgNodesPerCanvas
      },
      total: {
        canvases: totalCanvases,
        nodes: totalNodes,
        tokens: totalTokens,
        avgNodesPerCanvas: totalAvgNodesPerCanvas
      },
      storageUsed: storageUsage.formattedSize,
      storageLimit: {
        limitBytes: storageUsage.limitBytes ?? null,
        limitFormatted: storageUsage.limitFormatted ?? null,
        usagePercentage: storageUsage.usagePercentage ?? null,
        warningThreshold: storageUsage.warningThreshold ?? null,
        isOverLimit: storageUsage.isOverLimit ?? false,
        isNearLimit: storageUsage.isNearLimit ?? false
      },
      isOwner
    }

    return NextResponse.json(statistics)
  } catch (error) {
    console.error("Error fetching statistics:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
