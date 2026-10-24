import { NextResponse } from "next/server"
import { getCurrentUserCount } from "@/lib/inviteUtils"

/**
 * GET /api/auth/registration-info
 * Returns whether an invite code is required for registration
 */
export async function GET() {
  try {
    const userCount = await getCurrentUserCount()
    const requiresInvite = userCount > 0

    return NextResponse.json({
      requiresInvite,
      userCount
    })
  } catch (error) {
    console.error("Error checking registration info:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

