import { withApiBoundary } from "@/lib/apiBoundary"
import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  getUserLimit
} from "@/lib/inviteUtils"
import { validatePassword } from "@/lib/passwordUtils"
import { getDefaultStorageLimit } from "@/lib/storageConstants"
import type { UserInternal } from "@/types"
import { toPublicUser } from "@/lib/userUtils"
import { RegistrationError } from "@/lib/registrationErrors"
import { AuthRequestError, enforceAuthRate, readAuthJson, validPasswordInput, withPasswordWork } from "@/lib/authHardening"

async function boundaryPOST(request: NextRequest) {
  try {
    enforceAuthRate("register")
    const body = await readAuthJson(request)
    const { password, name, inviteCode } = body
    const email = typeof body.email === "string" ? body.email.trim() : ""

    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validPasswordInput(password) || (name !== undefined && (typeof name !== "string" || name.length > 200)) || (inviteCode !== undefined && (typeof inviteCode !== "string" || inviteCode.length > 128))) {
      return NextResponse.json(
        { error: "A valid email and password (at most 72 bytes) are required" },
        { status: 400 }
      )
    }
    enforceAuthRate("register", email)

    // Validate password
    const passwordValidation = validatePassword(password)
    if (!passwordValidation.isValid) {
      return NextResponse.json(
        { error: passwordValidation.error },
        { status: 400 }
      )
    }

    const [existingUser, userCount, owner] = await Promise.all([
      prisma.user.findUnique({ where: { email }, select: { id: true } }),
      prisma.user.count(),
      prisma.user.findFirst({ where: { isOwner: true }, select: { id: true } })
    ])
    if (existingUser) throw new RegistrationError("User with this email already exists", 409)
    if (userCount !== 0 || owner) {
      if (userCount >= getUserLimit()) throw new RegistrationError("Registration is currently unavailable. Please contact the administrator.", 503)
      if (typeof inviteCode !== "string" || !inviteCode.trim()) throw new RegistrationError("Invite code is required for registration", 400)
      const invite = await prisma.inviteCode.findUnique({
        where: { code: inviteCode.trim().toUpperCase() },
        select: { usedAt: true, usedBy: true }
      })
      if (!invite) throw new RegistrationError("Invalid or expired invite code", 400)
      if (invite.usedAt || invite.usedBy) throw new RegistrationError("This invite code has already been used", 409)
    }
    const passwordHash = await withPasswordWork(() => bcrypt.hash(password, 12))

    // Use a transaction to ensure atomicity of user creation and invite code claiming
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Check if user already exists (inside transaction)
      const existingUser = await tx.user.findUnique({
        where: { email }
      })

      if (existingUser) {
        throw new RegistrationError("User with this email already exists", 409)
      }

      // Check user count and limit (inside transaction)
      // Also check if there's already an owner to prevent race condition
      const userCount = await tx.user.count()
      const ownerExists = await tx.user.findFirst({
        where: { isOwner: true },
        select: { id: true }
      })
      
      // Only the first user (when count is 0) should become owner
      // But we need to handle race condition where multiple users register simultaneously
      const isFirstUser = userCount === 0 && !ownerExists
      const limit = getUserLimit()

      // Validate registration eligibility and claim invite code if needed
      let normalizedCode: string | undefined
      
      if (!isFirstUser) {
        // Check user limit
        if (userCount >= limit) {
          throw new RegistrationError("Registration is currently unavailable. Please contact the administrator.", 503)
        }

        // For non-first users, require invite code
        if (!inviteCode || !inviteCode.trim()) {
          throw new RegistrationError("Invite code is required for registration", 400)
        }

        normalizedCode = inviteCode.trim().toUpperCase()
        const now = new Date()
        
        // Atomically claim the invite code by setting usedAt (but not usedBy yet)
        // This prevents TOCTOU race conditions - only one request can claim the code
        // Using updateMany with conditions ensures atomicity at database level
        // We set usedAt to mark it as claimed, and will set usedBy after user creation
        const claimResult = await tx.inviteCode.updateMany({
          where: {
            code: normalizedCode,
            usedAt: null,  // Only claim if not already used
            usedBy: null  // Only claim if not already used
          },
          data: {
            usedAt: now
            // usedBy remains NULL until we create the user
          }
        })

        if (claimResult.count === 0) {
          // Check if code exists but is already used or doesn't exist
          const existing = await tx.inviteCode.findUnique({
            where: { code: normalizedCode },
            select: { usedAt: true, usedBy: true }
          })

          if (!existing) {
            throw new RegistrationError("Invalid or expired invite code", 400)
          }

          if (existing.usedAt || existing.usedBy) {
            throw new RegistrationError("This invite code has already been used", 409)
          }

          // Edge case - should not reach here
          throw new RegistrationError("Invite code is not available", 400)
        }
      }

      // Always initialize new user with default storage limit
      // We'll set it to NULL (unlimited) only after deterministically obtaining ownership
      const storageLimitBytes = getDefaultStorageLimit()

      // Create user - initially set isOwner to false
      // We'll atomically claim ownership after creation if we're truly first
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: name || null,
          analyticsEnabled: false,
          isOwner: false, // Start as false, will atomically set to true if truly first user
          storageLimitBytes // Default limit for all users initially
        }
      })

      // Atomically claim ownership if we're the first user
      // This prevents race condition where multiple first users set isOwner: true
      if (isFirstUser) {
        // Check again after user creation - has an owner been created by another transaction?
        const currentOwnerExists = await tx.user.findFirst({
          where: { isOwner: true },
          select: { id: true }
        })

        // Only proceed if no owner exists yet (all transactions in the race condition will see this)
        // Set the newly created user as owner in a single atomic operation
        // Only in this code path where we actually grant owner status, set storageLimitBytes to NULL (unlimited)
        if (!currentOwnerExists) {
          await tx.user.update({
            where: { id: user.id },
            data: { 
              isOwner: true,
              storageLimitBytes: null // Owner has unlimited storage - only set here after confirming ownership
            }
          })
          user.isOwner = true
          user.storageLimitBytes = null
        }
      }

      // If we claimed an invite code, update it with the actual user ID
      // We update the code that has usedAt set but usedBy is still NULL
      // This ensures we're updating the code we just claimed in this transaction
      if (!isFirstUser && normalizedCode) {
        const updateResult = await tx.inviteCode.updateMany({
          where: {
            code: normalizedCode,
            usedAt: { not: null },  // Must have usedAt set (we just set it)
            usedBy: null             // But usedBy must still be NULL
          },
          data: {
            usedBy: user.id
          }
        })

        // This must always update exactly 1 row - if not, data integrity is compromised
        if (updateResult.count !== 1) {
          throw new RegistrationError(
            `Data integrity error: Expected to update 1 invite code, but updated ${updateResult.count}. ` +
            `This indicates a critical system error. Transaction will be rolled back.`,
            500
          )
        }
      }

      return user
    }, {
      timeout: 30000 // 30 second timeout for transaction
    }) as UserInternal

    return NextResponse.json({
      message: "User created successfully",
      user: toPublicUser(result)
    })
  } catch (error) {
    if (error instanceof AuthRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode, headers: error.statusCode === 429 ? { "Retry-After": "60" } : undefined })
    }
    
    // Handle RegistrationError with explicit status code
    if (error instanceof RegistrationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }

    // Handle Prisma errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 is unique constraint violation
      if (error.code === 'P2002') {
        return NextResponse.json(
          { error: "User with this email already exists" },
          { status: 409 }
        )
      }
    }
    
    // Fallback for unexpected errors
    return NextResponse.json(
      { error: "Registration failed" },
      { status: 500 }
    )
  }
}

export function POST(request: NextRequest) {
  return withApiBoundary(request, () => boundaryPOST(request))
}
