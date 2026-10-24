/**
 * Format bytes to human-readable format with automatic unit selection
 * This is a client-safe utility that doesn't use Node.js modules
 */
export function formatStorageSize(bytes: number): string {
  if (bytes === 0) return "0 B"
  
  const units = ["B", "KB", "MB", "GB", "TB"]
  const k = 1024
  const decimals = 2
  
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const size = parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))
  
  return `${size} ${units[i]}`
}

/**
 * Format storage usage as percentage
 * This is a client-safe utility that doesn't use Node.js modules
 */
export function formatStoragePercentage(used: number, limit: number): string {
  if (limit === 0) return "0%"
  const percentage = Math.round((used / limit) * 100)
  return `${percentage}%`
}

/**
 * Get storage warning threshold percentage (85% = 15% free space remaining)
 * This is a client-safe utility that doesn't use Node.js modules
 */
export function getStorageWarningThreshold(): number {
  return 85
}

