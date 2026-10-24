import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { calculateUserStorageUsage } from "@/lib/storageUtils"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.user.id

    // Get user's canvas and media counts
    const [canvasCount, nodeCount, mediaCount] = await Promise.all([
      prisma.canvas.count({
        where: { userId }
      }),
      prisma.node.count({
        where: { 
          canvas: { userId }
        }
      }),
      prisma.media.count({
        where: { 
          canvas: { userId }
        }
      })
    ])

    // Get all canvas IDs for this user to calculate uploads directory
    const userCanvases = await prisma.canvas.findMany({
      where: { userId },
      select: { id: true }
    })

    const userCanvasIds = userCanvases.map((canvas: typeof userCanvases[number]) => canvas.id)
    
    // Calculate total storage usage
    const storageUsage = await calculateUserStorageUsage(
      userId,
      canvasCount,
      nodeCount,
      mediaCount,
      userCanvasIds
    )

    return NextResponse.json({
      totalBytes: storageUsage.totalBytes,
      formattedSize: storageUsage.formattedSize,
      breakdown: storageUsage.breakdown,
      counts: {
        canvases: canvasCount,
        nodes: nodeCount,
        media: mediaCount
      },
      limit: {
        limitBytes: storageUsage.limitBytes ?? null,
        limitFormatted: storageUsage.limitFormatted ?? null,
        usagePercentage: storageUsage.usagePercentage ?? null,
        warningThreshold: storageUsage.warningThreshold ?? null,
        isOverLimit: storageUsage.isOverLimit ?? false,
        isNearLimit: storageUsage.isNearLimit ?? false
      },
      isOwner: storageUsage.isOwner
    })
  } catch (error) {
    console.error("Error calculating storage usage:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
