import { withApiBoundary } from "@/lib/apiBoundary"
import { NextRequest, NextResponse } from "next/server"
import { requireOwner } from "@/lib/middleware/ownerCheck"
import { prisma } from "@/lib/prisma"
import {
  generateInviteCode,
  canCreateInvite,
  getUserLimit,
  getCurrentUserCount
} from "@/lib/inviteUtils"
import { calculateUserStorageUsage, getStorageWarningThreshold } from "@/lib/storageUtils"

const MAX_CODE_GENERATION_ATTEMPTS = 10

/**
 * GET /api/invites
 * List all invite codes (owner only)
 */
export async function GET(req: NextRequest) {
  try {
    const ownerCheck = await requireOwner(req)
    
    if (!ownerCheck.isOwner || ownerCheck.response) {
      return ownerCheck.response || NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const invites = await prisma.inviteCode.findMany({
      include: {
        creator: { select: { email: true } },
        usedByUser: { select: { email: true } }
      },
      orderBy: { createdAt: "desc" }
    })

    // Map invites to response format with storage usage info
    const inviteData = await Promise.all(invites.map(async (invite) => {
      // Determine status: pending (usedAt set but usedBy is NULL - registration in progress), used (completed), or active
      // usedAt being set but usedBy being NULL indicates the code is claimed but user creation is in progress
      let status: "active" | "used" | "pending"
      if (invite.usedAt && !invite.usedBy) {
        // Code is claimed (usedAt set) but user not yet created (usedBy is NULL)
        status = "pending"
      } else if (invite.usedAt && invite.usedBy) {
        // Code is fully used
        status = "used"
      } else {
        // Code is available
        status = "active"
      }

      // Get storage usage info for used invites
      let storageUsage = null
      let storageWarning = false

      if (status === "used" && invite.usedBy) {
        try {
          // Get user's canvas and media counts
          const [canvasCount, nodeCount, mediaCount] = await Promise.all([
            prisma.canvas.count({ where: { userId: invite.usedBy } }),
            prisma.node.count({ where: { canvas: { userId: invite.usedBy } } }),
            prisma.media.count({ where: { canvas: { userId: invite.usedBy } } })
          ])

          // Get all canvas IDs
          const userCanvases = await prisma.canvas.findMany({
            where: { userId: invite.usedBy },
            select: { id: true }
          })

          const userCanvasIds = userCanvases.map((canvas) => canvas.id)

          // Calculate storage usage
          const usage = await calculateUserStorageUsage(
            invite.usedBy,
            canvasCount,
            nodeCount,
            mediaCount,
            userCanvasIds
          )

          storageUsage = {
            totalBytes: usage.totalBytes,
            formattedSize: usage.formattedSize,
            limitBytes: usage.limitBytes,
            limitFormatted: usage.limitFormatted,
            usagePercentage: usage.usagePercentage ?? null
          }

          // Check if user exceeds 85% of limit (warning threshold)
          const warningThreshold = getStorageWarningThreshold()
          if (usage.usagePercentage != null && usage.usagePercentage >= warningThreshold) {
            storageWarning = true
          }
        } catch (error) {
          console.error(`Error calculating storage for user ${invite.usedBy}:`, error)
          // Continue without storage info if calculation fails
        }
      }

      return {
        id: invite.id,
        code: invite.code,
        createdBy: invite.createdBy,
        creatorEmail: invite.creator?.email || null,
        createdAt: invite.createdAt,
        usedAt: invite.usedAt,
        usedBy: invite.usedBy,
        usedByEmail: status === "pending" ? "pending" : invite.usedByUser?.email || null,
        status,
        storageUsage,
        storageWarning
      }
    }))

    const userCount = await getCurrentUserCount()
    const limit = getUserLimit()

    return NextResponse.json({
      invites: inviteData,
      stats: {
        currentUsers: userCount,
        limit,
        availableSlots: Math.max(0, limit - userCount)
      }
    })
  } catch (error) {
    console.error("Error fetching invites:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * POST /api/invites
 * Generate a new invite code (owner only)
 */
async function boundaryPOST(req: NextRequest) {
  try {
    const ownerCheck = await requireOwner(req)
    
    if (!ownerCheck.isOwner || !ownerCheck.userId || ownerCheck.response) {
      return ownerCheck.response || NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    // Check if we can create more invites
    const canCreate = await canCreateInvite()
    if (!canCreate) {
      const userCount = await getCurrentUserCount()
      const limit = getUserLimit()
      return NextResponse.json(
        {
          error: `User limit reached (${userCount}/${limit}). Cannot create new invite codes.`
        },
        { status: 400 }
      )
    }

    // Generate unique invite code
    let code: string
    let attempts = 0

    do {
      code = generateInviteCode()
      const existing = await prisma.inviteCode.findUnique({
        where: { code }
      })
      if (!existing) break
      attempts++
    } while (attempts < MAX_CODE_GENERATION_ATTEMPTS)

    if (attempts >= MAX_CODE_GENERATION_ATTEMPTS) {
      return NextResponse.json(
        { error: "Failed to generate unique invite code. Please try again." },
        { status: 500 }
      )
    }

    // Create invite code
    const invite = await prisma.inviteCode.create({
      data: {
        code,
        createdBy: ownerCheck.userId
      }
    })

    return NextResponse.json({
      id: invite.id,
      code: invite.code,
      createdAt: invite.createdAt
    })
  } catch (error) {
    console.error("Error creating invite:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}


export function POST(req: NextRequest) {
  return withApiBoundary(req, () => boundaryPOST(req))
}
