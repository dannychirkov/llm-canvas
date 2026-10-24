import fs from "fs"
const { readdir } = fs.promises
import { join } from "path"
import { createHash } from "crypto"
import { ApiError } from "@/lib/apiErrors"
import { assertNoSymlinks, assertStorageId } from "@/lib/publicPath"
import { prisma } from "@/lib/prisma"
import { getDefaultStorageLimit } from "@/lib/storageConstants"
import { acquireStorageLock } from "@/lib/storageLock"
import { formatStorageSize, formatStoragePercentage, getStorageWarningThreshold } from "@/lib/formatUtils"
// Re-export client-safe formatting utilities
export { formatStorageSize, formatStoragePercentage, getStorageWarningThreshold }

/**
 * Recursively calculate the total size of a directory
 */
export async function calculateFolderSize(dirPath: string): Promise<number> {
  try {
    const directoryStats = await fs.promises.lstat(dirPath)
    if (directoryStats.isSymbolicLink()) throw new ApiError("Invalid storage path")
    const files = await readdir(dirPath)
    let totalSize = 0

    for (const file of files) {
      const filePath = join(dirPath, file)
      const stats = await fs.promises.lstat(filePath)

      if (stats.isSymbolicLink()) throw new ApiError("Invalid storage path")

      if (stats.isDirectory()) {
        totalSize += await calculateFolderSize(filePath)
      } else {
        totalSize += stats.size
      }
    }

    return totalSize
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return 0
    throw error
  }
}

/**
 * Estimate database storage size for a user
 * This is a rough estimation based on record counts and average sizes
 */
export function estimateDatabaseSize(
  canvasCount: number,
  nodeCount: number,
  mediaCount: number
): number {
  // Rough estimates for average record sizes in bytes
  const AVG_CANVAS_SIZE = 2048 // ~2KB per canvas (title, description, content)
  const AVG_NODE_SIZE = 1024   // ~1KB per node (type, position, data)
  const AVG_MEDIA_RECORD_SIZE = 512 // ~512B per media record (metadata only, not file content)

  return (canvasCount * AVG_CANVAS_SIZE) +
    (nodeCount * AVG_NODE_SIZE) +
    (mediaCount * AVG_MEDIA_RECORD_SIZE)
}

/**
 * Calculate total storage usage for a user
 */
export async function calculateUserStorageUsage(
  userId: string,
  _canvasCount: number,
  _nodeCount: number,
  _mediaCount: number,
  userCanvasIds: string[]
): Promise<{
  totalBytes: number
  formattedSize: string
  breakdown: {
    mediaFiles: number
    database: number
  }
  limitBytes?: number | null
  limitFormatted?: string | null
  usagePercentage?: number | null
  warningThreshold?: number | null
  isOverLimit?: boolean
  isNearLimit?: boolean
  isOwner: boolean
}> {
  // Calculate media files size only for user's canvases
  let mediaFilesSize = 0
  const uploadsDir = join(process.cwd(), 'public', 'uploads', 'canvases')

  for (const canvasId of userCanvasIds) {
    assertStorageId(canvasId)
    const canvasUploadsDir = join(uploadsDir, canvasId)
    assertNoSymlinks(canvasUploadsDir)
    mediaFilesSize += await calculateFolderSize(canvasUploadsDir)
    const legacyDir = join(process.cwd(), "public", "canvases", canvasId)
    assertNoSymlinks(legacyDir)
    mediaFilesSize += await calculateFolderSize(legacyDir)
  }

  const [measured] = await prisma.$queryRaw<Array<{ bytes: bigint | number }>>`
    SELECT
      COALESCE((SELECT SUM(length(CAST(COALESCE(content, '') AS BLOB)) + length(CAST(title AS BLOB)) + length(CAST(COALESCE(description, '') AS BLOB)) + 256) FROM canvases WHERE userId = ${userId}), 0)
      + COALESCE((SELECT SUM(length(CAST(data AS BLOB)) + length(CAST(position AS BLOB)) + 128) FROM nodes WHERE canvasId IN (SELECT id FROM canvases WHERE userId = ${userId})), 0)
      + COALESCE((SELECT SUM(length(CAST(COALESCE(csvData, '') AS BLOB)) + length(CAST(COALESCE(videoFrames, '') AS BLOB)) + 512) FROM media WHERE canvasId IN (SELECT id FROM canvases WHERE userId = ${userId})), 0)
      + COALESCE((SELECT COUNT(*) * 256 FROM token_usage WHERE canvasId IN (SELECT id FROM canvases WHERE userId = ${userId})), 0) AS bytes`
  const databaseSize = Number(measured.bytes)

  const totalBytes = mediaFilesSize + databaseSize

  // Get user storage limit using getUserStorageLimit (returns null for owners, 
  // explicit limit or default limit for non-owners)
  const limitBytes = await getUserStorageLimit(userId)

  // Check if user is owner (limitBytes is null only for owners)
  const isOwner = limitBytes === null

  // If owner, return without limit info
  if (isOwner) {
    return {
      totalBytes,
      formattedSize: formatStorageSize(totalBytes),
      breakdown: {
        mediaFiles: mediaFilesSize,
        database: databaseSize
      },
      limitBytes: null,
      limitFormatted: null,
      usagePercentage: null,
      warningThreshold: null,
      isOverLimit: false,
      isNearLimit: false,
      isOwner
    }
  }

  // For non-owners, limitBytes is always set (never null)
  // Calculate usage percentage and warning threshold
  const usagePercentage = Math.round((totalBytes / limitBytes) * 100)
  const warningThreshold = getStorageWarningThreshold()
  const isOverLimit = totalBytes > limitBytes
  const isNearLimit = usagePercentage >= warningThreshold

  return {
    totalBytes,
    formattedSize: formatStorageSize(totalBytes),
    breakdown: {
      mediaFiles: mediaFilesSize,
      database: databaseSize
    },
    limitBytes,
    limitFormatted: formatStorageSize(limitBytes),
    usagePercentage,
    warningThreshold,
    isOverLimit,
    isNearLimit,
    isOwner
  }
}

/**
 * Re-export getDefaultStorageLimit from storageConstants for backward compatibility
 * @deprecated Import directly from @/lib/storageConstants instead
 */
export { getDefaultStorageLimit } from "@/lib/storageConstants"

/**
 * Get storage limit for a specific user
 * Returns NULL for owner (unlimited) or the user's specific limit
 */
export async function getUserStorageLimit(userId: string): Promise<number | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { storageLimitBytes: true, isOwner: true }
  })

  if (!user) {
    throw new Error("User not found")
  }

  // Owner has unlimited storage (NULL)
  if (user.isOwner) {
    return null
  }

  // If user has a specific limit (non-zero), return it, otherwise return default
  // Treat 0, null, or undefined as absence of usable limit to avoid division-by-zero
  if (user.storageLimitBytes && user.storageLimitBytes > 0) {
    return user.storageLimitBytes
  }

  return getDefaultStorageLimit()
}

/**
 * Helper function to get user storage data
 * Looks up the user, loads canvas data, and calculates current usage
 * @throws Error if user is not found
 */
async function getUserStorageData(userId: string): Promise<{
  currentUsage: number
  canvasIds: string[]
  canvasCount: number
  nodeCount: number
  mediaCount: number
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true }
  })

  if (!user) {
    throw new Error("User not found")
  }

  const canvases = await prisma.canvas.findMany({
    where: { userId },
    select: { id: true }
  })

  const canvasIds = canvases.map(c => c.id)
  const canvasCount = canvases.length
  const nodeCount = await prisma.node.count({ where: { canvasId: { in: canvasIds } } })
  const mediaCount = await prisma.media.count({ where: { canvasId: { in: canvasIds } } })

  const usage = await calculateUserStorageUsage(
    userId,
    canvasCount,
    nodeCount,
    mediaCount,
    canvasIds
  )

  return {
    currentUsage: usage.totalBytes,
    canvasIds,
    canvasCount,
    nodeCount,
    mediaCount
  }
}

/**
 * Check if a user can upload a file of the given size
 * Returns an object with allowed status, current usage, limit, and wouldExceed flag
 * Does not throw on exceeding the limit - returns wouldExceed: true instead
 * @returns { allowed: boolean; currentUsage: number; limit: number | null; wouldExceed: boolean }
 */
export async function checkStorageLimit(
  userId: string,
  additionalBytes: number
): Promise<{ allowed: boolean; currentUsage: number; limit: number | null; wouldExceed: boolean }> {
  if (!Number.isSafeInteger(additionalBytes) || additionalBytes < 0) throw new ApiError("Invalid storage reservation")
  const limit = await getUserStorageLimit(userId)
  const storageData = await getUserStorageData(userId)

  // Owner has unlimited storage
  if (limit === null) {
    return {
      allowed: true,
      currentUsage: storageData.currentUsage,
      limit: null,
      wouldExceed: false
    }
  }

  // Non-owner: check if additional bytes would exceed limit
  const wouldExceed = storageData.currentUsage + additionalBytes > limit

  return {
    allowed: !wouldExceed,
    currentUsage: storageData.currentUsage,
    limit,
    wouldExceed
  }
}

export async function withStorageReservation<Result>(
  userId: string,
  additionalBytes: number,
  operation: (reservation: { verify: (actualAdditionalBytes: number) => void }) => Promise<Result>
): Promise<Result> {
  const lockRoot = join(process.cwd(), "public", "uploads", ".quota-locks")
  assertNoSymlinks(lockRoot)
  await fs.promises.mkdir(lockRoot, { recursive: true })
  const lockPath = join(lockRoot, createHash("sha256").update(userId).digest("hex"))
  const release = await acquireStorageLock(lockPath)
  try {
    const check = await checkStorageLimit(userId, additionalBytes)
    const verify = (actualAdditionalBytes: number) => {
      if (!Number.isSafeInteger(actualAdditionalBytes) || actualAdditionalBytes < 0) throw new ApiError("Invalid storage reservation")
      if (actualAdditionalBytes > 0 && check.limit !== null && check.currentUsage + actualAdditionalBytes > check.limit) throw new ApiError("Storage quota exceeded", 403)
    }
    verify(additionalBytes)
    return await operation({ verify })
  } finally {
    await release()
  }
}

