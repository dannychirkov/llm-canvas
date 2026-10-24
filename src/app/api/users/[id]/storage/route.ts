import { withApiBoundary } from "@/lib/apiBoundary"
import { NextRequest, NextResponse } from "next/server"
import { requireOwner } from "@/lib/middleware/ownerCheck"
import { prisma } from "@/lib/prisma"
import { calculateUserStorageUsage, formatStorageSize } from "@/lib/storageUtils"
import { ApiError } from "@/lib/apiErrors"
import { readBoundedJson } from "@/lib/requestBody"

/**
 * GET /api/users/[id]/storage
 * Get user storage limit and usage (owner only)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ownerCheck = await requireOwner(req)

    if (!ownerCheck.isOwner || ownerCheck.response) {
      return ownerCheck.response || NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { id: userId } = await params

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        isOwner: true,
        storageLimitBytes: true
      }
    })

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      )
    }

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

    // Get all canvas IDs for this user
    const userCanvases = await prisma.canvas.findMany({
      where: { userId },
      select: { id: true }
    })

    const userCanvasIds = userCanvases.map((canvas) => canvas.id)
    
    // Calculate total storage usage
    const storageUsage = await calculateUserStorageUsage(
      userId,
      canvasCount,
      nodeCount,
      mediaCount,
      userCanvasIds
    )

    return NextResponse.json({
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      isOwner: storageUsage.isOwner,
      storage: {
        totalBytes: storageUsage.totalBytes,
        formattedSize: storageUsage.formattedSize,
        limitBytes: storageUsage.limitBytes ?? null,
        limitFormatted: storageUsage.limitFormatted ?? null,
        usagePercentage: storageUsage.usagePercentage ?? null,
        warningThreshold: storageUsage.warningThreshold ?? null,
        isOverLimit: storageUsage.isOverLimit ?? false,
        isNearLimit: storageUsage.isNearLimit ?? false,
        breakdown: storageUsage.breakdown
      }
    })
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error({ event: "user_storage_fetch_failed" })
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/users/[id]/storage
 * Update user storage limit (owner only)
 */
async function boundaryPATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ownerCheck = await requireOwner(req)

    if (!ownerCheck.isOwner || !ownerCheck.userId || ownerCheck.response) {
      return ownerCheck.response || NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { id: userId } = await params
    const { storageLimitBytes } = await readBoundedJson(req)

    // Validate storage limit
    if (storageLimitBytes !== null && (
      typeof storageLimitBytes !== "number" ||
      !Number.isSafeInteger(storageLimitBytes) ||
      storageLimitBytes <= 0 ||
      storageLimitBytes > 2147483647
    )) {
      return NextResponse.json(
        { error: "Storage limit must be a positive integer up to 2147483647 or null for unlimited" },
        { status: 400 }
      )
    }

    // Get user to check if they exist and if they're the owner
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isOwner: true }
    })

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      )
    }

    // Prevent changing owner's limit (owner always has unlimited)
    if (user.isOwner && storageLimitBytes !== null) {
      return NextResponse.json(
        { error: "Owner storage limit cannot be changed (always unlimited)" },
        { status: 400 }
      )
    }

    // Update storage limit
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        storageLimitBytes
      },
      select: {
        id: true,
        email: true,
        storageLimitBytes: true
      }
    })

    return NextResponse.json({
      message: "Storage limit updated successfully",
      user: {
        id: updated.id,
        email: updated.email,
        storageLimitBytes: updated.storageLimitBytes,
        limitFormatted: updated.storageLimitBytes ? formatStorageSize(updated.storageLimitBytes) : null
      }
    })
  } catch (error) {
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error({ event: "user_storage_update_failed" })
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}


export function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withApiBoundary(req, () => boundaryPATCH(req, { params }))
}
