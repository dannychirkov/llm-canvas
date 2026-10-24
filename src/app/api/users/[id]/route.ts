import { withApiBoundary } from "@/lib/apiBoundary"
import { readBoundedJson } from "@/lib/requestBody"
import { ApiError } from "@/lib/apiErrors"
import { NextRequest, NextResponse } from "next/server"
import { requireOwner } from "@/lib/middleware/ownerCheck"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { cleanupCanvasMedia } from "@/lib/safeMedia"

/**
 * DELETE /api/users/[id]
 * Delete an invited user and all their data (owner only)
 */
async function boundaryDELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // 1. Owner check
    const ownerCheck = await requireOwner(req)

    if (!ownerCheck.isOwner || ownerCheck.response) {
      return ownerCheck.response || NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { id: userId } = await params

    // 2. Parse body
    let confirmEmail: unknown
    try {
      const body = await readBoundedJson(req)
      confirmEmail = body.confirmEmail
    } catch (error) {
      if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status })
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      )
    }

    if (typeof confirmEmail !== "string" || !confirmEmail || confirmEmail.length > 254) {
      return NextResponse.json(
        { error: "Confirmation email is required" },
        { status: 400 }
      )
    }

    // 3. Find user with canvases and media
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        canvases: {
          select: { id: true }
        }
      }
    })

    // 4. Validations
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      )
    }

    if (user.isOwner) {
      return NextResponse.json(
        { error: "Cannot delete the owner account" },
        { status: 400 }
      )
    }

    if (confirmEmail.trim() !== user.email) {
      return NextResponse.json(
        { error: "Email confirmation does not match" },
        { status: 400 }
      )
    }

    // 5. Collect media file paths for cleanup
    const canvasIds = user.canvases.map(canvas => canvas.id)

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Delete token usage records
      await tx.tokenUsage.deleteMany({
        where: {
          canvas: {
            userId: userId
          }
        }
      })

      // Delete all nodes associated with user's canvases
      await tx.node.deleteMany({
        where: {
          canvas: {
            userId: userId
          }
        }
      })

      // Delete all media records
      await tx.media.deleteMany({
        where: {
          canvas: {
            userId: userId
          }
        }
      })

      // Delete all canvases
      await tx.canvas.deleteMany({
        where: {
          userId: userId
        }
      })

      // Delete user settings
      await tx.userSettings.deleteMany({
        where: {
          userId: userId
        }
      })

      // Delete all sessions (logs user out)
      await tx.session.deleteMany({
        where: {
          userId: userId
        }
      })

      // Delete all accounts (OAuth connections)
      await tx.account.deleteMany({
        where: {
          userId: userId
        }
      })

      // Delete invite codes created by this user
      await tx.inviteCode.deleteMany({
        where: {
          createdBy: userId
        }
      })

      // Finally, delete the user
      // Note: InviteCode.usedBy will be set to NULL automatically (onDelete: SetNull)
      await tx.user.delete({
        where: {
          id: userId
        }
      })
    })

    // 7. Clean up media files from filesystem
    let cleanedCanvases = 0
    let failedCleanups = 0
    for (const canvasId of canvasIds) {
      try { await cleanupCanvasMedia(canvasId); cleanedCanvases++ } catch {
        console.error({ event: "account_media_cleanup_failed" })
        failedCleanups++
      }
    }

    return NextResponse.json({
      success: true,
      message: "User deleted successfully",
      cleanedCanvases,
      failedCleanups
    })

  } catch (error) {
    console.error("Error deleting user:", error)
    return NextResponse.json(
      { error: "Failed to delete user. Please try again." },
      { status: 500 }
    )
  }
}

export function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withApiBoundary(req, () => boundaryDELETE(req, { params }))
}
