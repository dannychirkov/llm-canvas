import { prisma } from "@/lib/prisma"

/**
 * Get the maximum number of users allowed for this installation
 * Reads from MVP_USER_LIMIT environment variable, defaults to 10
 */
export function getUserLimit(): number {
  const limit = process.env.MVP_USER_LIMIT
  if (limit) {
    const parsed = parseInt(limit, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  return 10 // Default limit
}

/**
 * Get the current number of users in the system
 */
export async function getCurrentUserCount(): Promise<number> {
  return await prisma.user.count()
}

/**
 * Check if a new invite can be created (user limit not reached)
 */
export async function canCreateInvite(): Promise<boolean> {
  const currentCount = await getCurrentUserCount()
  const limit = getUserLimit()
  return currentCount < limit
}

/**
 * Generate cryptographically secure random bytes using Web Crypto API
 * Works in both Node.js and Edge Runtime
 */
function getRandomBytes(count: number): Uint8Array {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    // Web Crypto API (works in both Node.js and Edge Runtime)
    const bytes = new Uint8Array(count)
    crypto.getRandomValues(bytes)
    return bytes
  } else {
    // Fallback for older environments (shouldn't happen in modern Node.js/Edge)
    throw new Error('Cryptographically secure random number generator not available')
  }
}

/**
 * Generate a random invite code (8-10 characters, alphanumeric)
 * Uses cryptographically secure random number generation with rejection sampling
 * to avoid modulo bias
 */
export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // Excludes ambiguous characters
  const length = 8
  const charsetLength = chars.length
  
  // Calculate the maximum valid byte value to avoid modulo bias
  // We only accept bytes in the range [0, maxValid) where maxValid is
  // the largest multiple of charsetLength that fits in 256
  const maxValid = Math.floor(256 / charsetLength) * charsetLength
  
  let code = ""
  let bytesNeeded = length
  
  while (bytesNeeded > 0) {
    // Generate enough random bytes (we may need more due to rejection)
    const randomBytesArray = getRandomBytes(bytesNeeded * 2) // Generate extra to account for rejections
    
    for (let i = 0; i < randomBytesArray.length && bytesNeeded > 0; i++) {
      const byte = randomBytesArray[i]
      
      // Rejection sampling: only use bytes in the unbiased range
      if (byte < maxValid) {
        const index = byte % charsetLength
        code += chars.charAt(index)
        bytesNeeded--
      }
      // If byte >= maxValid, reject it and continue to next byte
    }
  }
  
  return code
}

/**
 * Check if an invite code is valid and unused
 */
export async function validateInviteCode(code: string): Promise<{
  valid: boolean
  inviteCode?: { id: string; createdBy: string }
  error?: string
}> {
  if (!code || code.trim().length === 0) {
    return { valid: false, error: "Invite code is required" }
  }

  const inviteCode = await prisma.inviteCode.findUnique({
    where: { code: code.trim().toUpperCase() }
  })

  if (!inviteCode) {
    return { valid: false, error: "Invalid or expired invite code" }
  }

  if (inviteCode.usedAt || inviteCode.usedBy) {
    return { valid: false, error: "This invite code has already been used" }
  }

  return {
    valid: true,
    inviteCode: {
      id: inviteCode.id,
      createdBy: inviteCode.createdBy
    }
  }
}

/**
 * Mark an invite code as used
 */
export async function markInviteCodeAsUsed(
  inviteCodeId: string,
  userId: string
): Promise<void> {
  await prisma.inviteCode.update({
    where: { id: inviteCodeId },
    data: {
      usedAt: new Date(),
      usedBy: userId
    }
  })
}

/**
 * Check if user registration is allowed (checks both limit and invite code if needed)
 */
export async function canRegisterNewUser(inviteCode?: string): Promise<{
  allowed: boolean
  error?: string
  requiresInvite: boolean
}> {
  const userCount = await getCurrentUserCount()
  const requiresInvite = userCount > 0

  // First user doesn't need invite
  if (!requiresInvite) {
    return { allowed: true, requiresInvite: false }
  }

  // Check user limit
  const limit = getUserLimit()
  if (userCount >= limit) {
    return {
      allowed: false,
      error: "User limit reached. Cannot create new accounts.",
      requiresInvite: true
    }
  }

  // Check invite code
  if (!inviteCode) {
    return {
      allowed: false,
      error: "Invite code is required for registration",
      requiresInvite: true
    }
  }

  const validation = await validateInviteCode(inviteCode)
  if (!validation.valid) {
    return {
      allowed: false,
      error: validation.error || "Invalid invite code",
      requiresInvite: true
    }
  }

  return { allowed: true, requiresInvite: true }
}

