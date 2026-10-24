import { withApiBoundary } from "@/lib/apiBoundary"
import { NextRequest, NextResponse } from "next/server"
import { requireOwner } from "@/lib/middleware/ownerCheck"
import { prisma } from "@/lib/prisma"

/**
 * DELETE /api/invites/[id]
 * Revoke an unused invite code (owner only)
 */
async function boundaryDELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ownerCheck = await requireOwner(req)
    
    if (!ownerCheck.isOwner || ownerCheck.response) {
      return ownerCheck.response || NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const { id: inviteId } = await params

    // Find the invite code
    const invite = await prisma.inviteCode.findUnique({
      where: { id: inviteId }
    })

    if (!invite) {
      return NextResponse.json(
        { error: "Invite code not found" },
        { status: 404 }
      )
    }

    // Can only delete unused invites
    if (invite.usedAt || invite.usedBy) {
      return NextResponse.json(
        { error: "Cannot delete an invite code that has already been used" },
        { status: 400 }
      )
    }

    // Delete the invite code
    await prisma.inviteCode.delete({
      where: { id: inviteId }
    })

    return NextResponse.json({
      message: "Invite code revoked successfully"
    })
  } catch (error) {
    console.error("Error deleting invite:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}


export function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withApiBoundary(req, () => boundaryDELETE(req, { params }))
}
