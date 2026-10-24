/**
 * Storage-related constants that can be safely imported in client components
 * This file contains no server-only dependencies (fs, prisma, etc.)
 */

/**
 * Default storage limit in bytes (1GB)
 * This constant can be safely used in both client and server components
 */
export const DEFAULT_STORAGE_LIMIT_BYTES = 1073741824 // 1GB

/**
 * Maximum file size for images and CSV files (10MB)
 * This constant matches the server-side limit in src/app/api/media/upload/route.ts
 */
export const MAX_IMAGE_OR_CSV_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * Maximum file size for video files (50MB)
 * This constant matches the server-side limit in src/app/api/media/upload/route.ts
 */
export const MAX_VIDEO_SIZE = 50 * 1024 * 1024 // 50MB

/**
 * Get default storage limit from environment variable (in bytes)
 * Defaults to 1GB (1073741824 bytes) if not set
 * 
 * NOTE: This function accesses process.env, which is only available on the server.
 * For client components, use DEFAULT_STORAGE_LIMIT_BYTES constant directly.
 */
export function getDefaultStorageLimit(): number {
  // Only access process.env on the server (it will be undefined on client)
  if (typeof process === 'undefined' || !process.env) {
    return DEFAULT_STORAGE_LIMIT_BYTES
  }
  
  const envValue = process.env.MVP_STORAGE_LIMIT_DEFAULT
  if (envValue) {
    const parsed = parseInt(envValue, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  // Default to 1GB
  return DEFAULT_STORAGE_LIMIT_BYTES
}

