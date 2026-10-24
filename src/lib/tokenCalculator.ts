import type { TokenProviderId } from "@/lib/providers/registry"
/**
 * Token Calculator for different AI providers
 * Handles text and image token calculation
 */

export interface TokenCalculationResult {
  textTokens: number
  imageTokens: number
  videoTokens: number
  totalTokens: number
  breakdown: {
    text: string
    images: string
    videos?: string
    total: string
  }
}

export interface MediaData {
  text?: string
  images?: Array<{
    width: number
    height: number
    mimeType: string
  }>
  videoFrames?: Array<{
    width: number
    height: number
    mimeType: string
  }>
  videoDurationMs?: number
  csvData?: string
  csvLimitEnabled?: boolean
  csvMaxRows?: number
  imageDetail?: 'low' | 'high'
}

/**
 * Calculate tokens for text content
 * Uses a simple approximation: ~4 characters per token
 */
export function calculateTextTokens(text: string): number {
  if (!text) return 0
  
  // Remove extra whitespace and normalize
  const normalizedText = text.trim().replace(/\s+/g, ' ')
  
  // Rough approximation: 4 characters per token
  // This is a simplified version - real tokenization would be more complex
  return Math.ceil(normalizedText.length / 4)
}

/**
 * Calculate tokens for images based on provider
 */
export function calculateImageTokens(
  images: Array<{ width: number; height: number; mimeType: string }>, 
  provider: TokenProviderId,
  detail: 'low' | 'high' = 'high'
): number {
  if (!images || images.length === 0) return 0
  
  let totalTokens = 0
  
  for (const image of images) {
    if (provider === 'openai') {
      totalTokens += calculateOpenAIImageTokens(image, detail)
    } else if (provider === 'gemini') {
      totalTokens += calculateGeminiImageTokens(image)
    }
  }
  
  return totalTokens
}

/**
 * Calculate OpenAI image tokens according to official documentation
 */
function calculateOpenAIImageTokens(image: { width: number; height: number; mimeType: string }, detail: 'low' | 'high'): number {
  const { width, height } = image
  
  if (detail === 'low') {
    // Low detail: always 85 tokens
    return 85
  }
  
  // High detail: scale image and calculate tiles
  // First, scale down to fit within 2048x2048 while maintaining aspect ratio
  let scaledWidth = width
  let scaledHeight = height
  
  if (width > 2048 || height > 2048) {
    const scale = Math.min(2048 / width, 2048 / height)
    scaledWidth = Math.floor(width * scale)
    scaledHeight = Math.floor(height * scale)
  }
  
  // Then, scale the shorter side to 768px while maintaining aspect ratio
  if (scaledWidth > 768 && scaledHeight > 768) {
    const scale = Math.min(768 / scaledWidth, 768 / scaledHeight)
    scaledWidth = Math.floor(scaledWidth * scale)
    scaledHeight = Math.floor(scaledHeight * scale)
  }
  
  // Calculate number of 512x512 tiles needed
  const tiles = Math.ceil(scaledWidth / 512) * Math.ceil(scaledHeight / 512)
  
  // Base cost: 85 tokens + 170 tokens per tile
  return 85 + (tiles * 170)
}

/**
 * Calculate Gemini image tokens according to official documentation
 */
function calculateGeminiImageTokens(image: { width: number; height: number; mimeType: string }): number {
  const { width, height } = image
  
  // Gemini formula: Math.ceil((width * height) / 150_000) * 256
  const pixels = width * height
  const tokenGroups = Math.ceil(pixels / 150_000)
  
  return tokenGroups * 256
}

/**
 * Rough estimation for Gemini video tokens based on duration.
 * Gemini processes video natively, so we estimate tokens by duration:
 * every 2 seconds of video ~256 tokens.
 */
function calculateGeminiVideoTokens(durationMs?: number): number {
  if (!durationMs || durationMs <= 0) return 0
  const durationSec = durationMs / 1000
  const segments = Math.max(1, Math.ceil(durationSec / 2))
  return segments * 256
}

/**
 * Calculate tokens for CSV data with optional row limit
 */
export function calculateCSVTokens(csvData: string, limitEnabled?: boolean, maxRows?: number): number {
  if (!csvData) return 0
  
  let dataToProcess = csvData
  
  // Apply row limit if enabled
  if (limitEnabled && maxRows && maxRows > 0) {
    const lines = csvData.split('\n')
    if (lines.length > maxRows) {
      dataToProcess = lines.slice(0, maxRows).join('\n')
    }
  }
  
  // CSV data is treated as text
  return calculateTextTokens(dataToProcess)
}

/**
 * Main function to calculate total tokens for media data
 */
export function calculateMediaTokens(mediaData: MediaData, provider: TokenProviderId): TokenCalculationResult {
  const textTokens = calculateTextTokens(mediaData.text || '')
  let imageSources = mediaData.images || []

  if (provider === 'openai' && mediaData.videoFrames?.length) {
    imageSources = imageSources.concat(mediaData.videoFrames)
  }

  const imageTokens = calculateImageTokens(
    imageSources, 
    provider, 
    mediaData.imageDetail || 'high'
  )
  const csvTokens = calculateCSVTokens(
    mediaData.csvData || '', 
    mediaData.csvLimitEnabled, 
    mediaData.csvMaxRows
  )
  const videoTokens = provider === 'gemini'
    ? calculateGeminiVideoTokens(mediaData.videoDurationMs)
    : 0
  
  const totalTokens = textTokens + imageTokens + csvTokens + videoTokens
  
  return {
    textTokens: textTokens + csvTokens, // Combine text and CSV
    imageTokens,
    videoTokens,
    totalTokens,
    breakdown: {
      text: `${textTokens + csvTokens} tokens`,
      images: `${imageTokens} tokens`,
      videos: videoTokens ? `${videoTokens} tokens` : undefined,
      total: `${totalTokens} tokens`
    }
  }
}

/**
 * Format token count for display
 */
export function formatTokenCount(tokens: number): string {
  if (tokens === 0) return '0 tokens'
  if (tokens === 1) return '1 token'
  return `${tokens.toLocaleString()} tokens`
}

/**
 * Get cost estimation for tokens (approximate)
 */
export function estimateCost(tokens: number, provider: TokenProviderId): string {
  // Rough cost estimates (as of 2024)
  const costs = {
    openai: {
      input: 0.00001, // $0.01 per 1K tokens
      output: 0.00003  // $0.03 per 1K tokens
    },
    gemini: {
      input: 0.0000075, // $0.0075 per 1K tokens
      output: 0.00003   // $0.03 per 1K tokens
    }
  }
  
  const cost = tokens * costs[provider].input
  return cost < 0.001 ? '< $0.001' : `~$${cost.toFixed(3)}`
}

/**
 * Calculate tokens for both providers simultaneously
 */
export function calculateTokensForBothProviders(mediaData: MediaData): {
  openai: TokenCalculationResult
  gemini: TokenCalculationResult
} {
  return {
    openai: calculateMediaTokens(mediaData, 'openai'),
    gemini: calculateMediaTokens(mediaData, 'gemini')
  }
}
