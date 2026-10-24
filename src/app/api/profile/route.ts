import { withApiBoundary } from "@/lib/apiBoundary"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import type { UserInternal } from "@/types"
import { toPublicUser } from "@/lib/userUtils"
import { AuthRequestError, enforceAuthRate, readAuthJson, validPasswordInput, withPasswordWork } from "@/lib/authHardening"

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id }
    }) as UserInternal | null

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Return public User type without passwordHash
    return NextResponse.json(toPublicUser(user))

  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

async function boundaryPUT(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    enforceAuthRate("profile")
    enforceAuthRate("profile", session.user.id)
    const body = await readAuthJson(req)
    const { name, email, password, analyticsEnabled } = body

    // Validate required fields
    if (typeof name !== "string" || !name.trim() || name.length > 200 || typeof email !== "string" || !email || email.length > 254 || (analyticsEnabled !== undefined && typeof analyticsEnabled !== "boolean")) {
      return NextResponse.json({ error: "Name and email are required" }, { status: 400 })
    }

    // Trim and validate email format
    const trimmedEmail = email.trim()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmedEmail)) {
      return NextResponse.json({ error: "Please enter a valid email address" }, { status: 400 })
    }

    // Get current user data
    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id }
    }) as UserInternal | null

    if (!currentUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Check if email is being changed
    const emailChanged = trimmedEmail !== currentUser.email

    // If email is being changed, require password verification
    if (emailChanged) {
      if (!validPasswordInput(password)) {
        return NextResponse.json({ 
          error: "Password is required to change email address" 
        }, { status: 400 })
      }

      // Verify current password
      if (!currentUser.passwordHash) {
        return NextResponse.json({ 
          error: "No password set for this account" 
        }, { status: 400 })
      }

      const isPasswordValid = await withPasswordWork(() => bcrypt.compare(password, currentUser.passwordHash!))
      if (!isPasswordValid) {
        return NextResponse.json({ 
          error: "Invalid password" 
        }, { status: 400 })
      }

      // Check if new email is already taken
      const existingUser = await prisma.user.findUnique({
        where: { email: trimmedEmail }
      })

      if (existingUser && existingUser.id !== session.user.id) {
        return NextResponse.json({ 
          error: "Email address is already in use" 
        }, { status: 400 })
      }
    }

    // Update user profile
    const updateData: {
      name: string
      email: string
      analyticsEnabled?: boolean
      updatedAt: Date
    } = {
      name: name.trim(),
      email: trimmedEmail,
      updatedAt: new Date()
    }
    
    // Only update analyticsEnabled if it's provided
    if (analyticsEnabled !== undefined) {
      updateData.analyticsEnabled = analyticsEnabled
    }
    
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: updateData
    }) as UserInternal

    // Return updated user data (without sensitive information)
    return NextResponse.json(toPublicUser(updatedUser))

  } catch (error) {
    if (error instanceof AuthRequestError) return NextResponse.json({ error: error.message }, { status: error.statusCode, headers: error.statusCode === 429 ? { "Retry-After": "60" } : undefined })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export function PUT(req: NextRequest) {
  return withApiBoundary(req, () => boundaryPUT(req))
}
