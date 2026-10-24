import { withApiBoundary } from "@/lib/apiBoundary"
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { cleanupCanvasMedia } from "@/lib/safeMedia"
import type { UserInternal } from '@/types'
import { AuthRequestError, enforceAuthRate, readAuthJson, validPasswordInput, withPasswordWork } from '@/lib/authHardening'
import { ApiError } from '@/lib/apiErrors'

async function boundaryDELETE(request: Request) {
  try {
    // Authenticate user
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Parse request body
    enforceAuthRate("password")
    enforceAuthRate("password", userId)
    const body = await readAuthJson(request)
    const { email, password } = body

    if (typeof email !== "string" || !email || email.length > 254 || !validPasswordInput(password)) {
      return NextResponse.json({
        error: 'A valid email and password (at most 72 bytes) are required'
      }, { status: 400 })
    }

    // Get user from database
    type UserWithCanvasesAndMedia = UserInternal & {
      canvases: Array<{
        id: string
      }>
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        canvases: {
          select: { id: true }
        }
      }
    }) as UserWithCanvasesAndMedia | null

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify email matches
    if (email.trim() !== user.email) {
      return NextResponse.json({
        error: 'Email does not match your account email'
      }, { status: 400 })
    }

    // Verify password
    if (user.passwordHash) {
      // User has a password stored - verify it
      const isPasswordValid = await withPasswordWork(() => bcrypt.compare(password, user.passwordHash!))
      if (!isPasswordValid) {
        return NextResponse.json({
          error: 'Invalid password'
        }, { status: 400 })
      }
    } else {
      // User doesn't have a password stored - this shouldn't happen for regular accounts
      return NextResponse.json({
        error: 'Account security issue: No password found. Please contact support.'
      }, { status: 400 })
    }

    // Collect media file paths for cleanup
    const canvasIds = user.canvases.map(canvas => canvas.id)

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Recheck persisted ownership and credentials in the deletion transaction.
      const currentUser = await tx.user.findUnique({
        where: { id: userId },
        select: { isOwner: true, email: true, passwordHash: true }
      })
      if (!currentUser || currentUser.email !== user.email || currentUser.passwordHash !== user.passwordHash) {
        throw new ApiError('Account changed. Please retry account deletion.', 409)
      }
      if (currentUser.isOwner && await tx.user.count() > 1) {
        throw new ApiError('Cannot delete the owner account while other users remain.', 409)
      }

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

      // Delete all invite codes created by this user
      await tx.inviteCode.deleteMany({
        where: {
          createdBy: userId
        }
      })

      // Finally, delete the user account
      await tx.user.delete({
        where: {
          id: userId
        }
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    // Clean up media files from filesystem
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
      message: 'Account deleted successfully',
      cleanedCanvases,
      failedCleanups
    })

  } catch (error) {
    if (error instanceof AuthRequestError) return NextResponse.json({ error: error.message }, { status: error.statusCode, headers: error.statusCode === 429 ? { "Retry-After": "60" } : undefined })
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2028', 'P2025'].includes(error.code)) {
      return NextResponse.json({ error: 'Account changed or is busy. Please retry account deletion.' }, { status: 409 })
    }
    console.error({ event: "account_deletion_failed" })
    return NextResponse.json(
      { error: 'Failed to delete account. Please try again.' },
      { status: 500 }
    )
  }
}

export function DELETE(request: Request) {
  return withApiBoundary(request, () => boundaryDELETE(request))
}
