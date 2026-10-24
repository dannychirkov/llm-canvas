import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

/**
 * Check if the current user is the installation owner
 */
export async function isOwner(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isOwner: true }
  })
  return user?.isOwner === true
}

/**
 * Middleware to check if user is owner, returns unauthorized if not
 */
export async function requireOwner(req: NextRequest): Promise<{
  isOwner: boolean
  userId?: string
  response?: NextResponse
}> {
  const session = await auth()
  
  if (!session?.user?.id) {
    return {
      isOwner: false,
      response: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }
  }

  const owner = await isOwner(session.user.id)
  
  if (!owner) {
    return {
      isOwner: false,
      userId: session.user.id,
      response: NextResponse.json(
        { error: "Only installation owner can manage invites" },
        { status: 403 }
      )
    }
  }

  return {
    isOwner: true,
    userId: session.user.id
  }
}

