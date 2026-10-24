import { withApiBoundary } from "@/lib/apiBoundary"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { AuthRequestError, enforceAuthRate, readAuthJson, validPasswordInput, withPasswordWork } from "@/lib/authHardening"
import { validatePassword } from "@/lib/passwordUtils"

async function boundaryPOST(request: NextRequest) {
  try {
    // Get the current session
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    // Parse request body
    enforceAuthRate("password")
    enforceAuthRate("password", session.user.id)
    const body = await readAuthJson(request)
    const { currentPassword, newPassword } = body

    // Validate input
    if (!validPasswordInput(currentPassword) || !validPasswordInput(newPassword)) {
      return NextResponse.json(
        { error: "Current and new passwords must contain 1 to 72 bytes" },
        { status: 400 }
      )
    }

    const validation = validatePassword(newPassword)
    if (!validation.isValid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      )
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: session.user.id }
    })

    if (!user || !user.passwordHash) {
      return NextResponse.json(
        { error: "User not found or no password set" },
        { status: 404 }
      )
    }

    // Verify current password
    const isCurrentPasswordValid = await withPasswordWork(() => bcrypt.compare(currentPassword, user.passwordHash!))

    if (!isCurrentPasswordValid) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 400 }
      )
    }

    // Check if new password is different from current
    const isSamePassword = await withPasswordWork(() => bcrypt.compare(newPassword, user.passwordHash!))
    if (isSamePassword) {
      return NextResponse.json(
        { error: "New password must be different from current password" },
        { status: 400 }
      )
    }

    // Hash new password
    const newPasswordHash = await withPasswordWork(() => bcrypt.hash(newPassword, 12))

    // Update password in database
    const result = await prisma.user.updateMany({
      where: { id: session.user.id, passwordHash: user.passwordHash, authVersion: user.authVersion },
      data: { passwordHash: newPasswordHash, authVersion: { increment: 1 } }
    })
    if (result.count !== 1) return NextResponse.json({ error: "Password changed concurrently. Sign in again." }, { status: 409 })

    return NextResponse.json(
      { message: "Password changed successfully. Sign in again." },
      { status: 200 }
    )

  } catch (error) {
    if (error instanceof AuthRequestError) return NextResponse.json({ error: error.message }, { status: error.statusCode, headers: error.statusCode === 429 ? { "Retry-After": "60" } : undefined })
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export function POST(request: NextRequest) {
  return withApiBoundary(request, () => boundaryPOST(request))
}
