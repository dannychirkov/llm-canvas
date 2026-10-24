/**
 * Smart Summarizer - intelligent prompt generation and strategy selection system
 */

import { SummaryLength, SummaryStyle, SmartSummarizerData } from '@/types'

// Prompt matrix for different setting combinations
export const PROMPT_MATRIX: Record<SummaryLength, Record<SummaryStyle, string>> = {
  brief: {
    'key-ideas': `Analyze the following text and formulate its main idea in one or two sentences. Ignore details, convey only the essence. Respond in the same language as the source text.\n\nText:\n\n{text}`,
    'preserve-details': `Create a brief summary of the following text, preserving all key facts, numbers, names, and dates. One or two sentences with maximum informativeness. Respond in the same language as the source text.\n\nText:\n\n{text}`,
    'structured': `Create a brief structured list of key points from the following text. Each point should be one sentence. Respond in the same language as the source text.\n\nText:\n\n{text}`
  },
  medium: {
    'key-ideas': `Create a medium-length summary of the following text, focusing on main ideas and the overall picture. Several key paragraphs without filler. Respond in the same language as the source text.\n\nText:\n\n{text}`,
    'preserve-details': `Create a medium-length summary of the following text, maximally preserving facts, numbers, names, and specific data. Several paragraphs with details. Respond in the same language as the source text.\n\nText:\n\n{text}`,
    'structured': `Create a structured summary of the following text as a bulleted list. Each point should reflect one of the key ideas or arguments. Respond in the same language as the source text.\n\nText:\n\n{text}`
  },
  detailed: {
    'key-ideas': `Create a detailed summary of the following text, preserving main ideas and the overall narrative logic. Comprehensive analysis without losing meaning. Respond in the same language as the source text.\n\nText:\n\n{text}`,
    'preserve-details': `Create a detailed and comprehensive summary of the following text. Ensure that all key facts, numbers, names, and dates are included. Preserve the original structure where possible. Respond in the same language as the source text.\n\nText:\n\n{text}`,
    'structured': `Create a detailed structured summary of the following text. Use multi-level lists and subheadings to organize information. Respond in the same language as the source text.\n\nText:\n\n{text}`
  }
}

// Prompts for Map-Reduce strategy
export const MAP_REDUCE_PROMPTS = {
  map: (style: SummaryStyle): string => {
    const basePrompts = {
      'key-ideas': 'Extract the main ideas from the following text fragment. Focus on the core message and overall meaning. Respond in the same language as the source text:\n\n',
      'preserve-details': 'Extract all key facts, numbers, names, and dates from the following text fragment. Respond in the same language as the source text:\n\n',
      'structured': 'Create a structured list of key points from the following text fragment. Respond in the same language as the source text:\n\n'
    }
    return basePrompts[style]
  },
  reduce: (style: SummaryStyle): string => {
    const basePrompts = {
      'key-ideas': 'Combine the following summary parts into a unified whole, preserving the main idea and overall picture. Respond in the same language as the source text:\n\n',
      'preserve-details': 'Combine the following summary parts, preserving all facts, numbers, names, and dates. Respond in the same language as the source text:\n\n',
      'structured': 'Combine the following structured parts into a single structured document. Respond in the same language as the source text:\n\n'
    }
    return basePrompts[style]
  }
}

// Prompts for Refine strategy
export const REFINE_PROMPTS = {
  initial: (style: SummaryStyle): string => {
    const basePrompts = {
      'key-ideas': 'Create an initial summary of the following text, focusing on main ideas. Respond in the same language as the source text:\n\n',
      'preserve-details': 'Create an initial summary of the following text, preserving key facts. Respond in the same language as the source text:\n\n',
      'structured': 'Create an initial structured summary of the following text. Respond in the same language as the source text:\n\n'
    }
    return basePrompts[style]
  },
  refine: (style: SummaryStyle): string => {
    const basePrompts = {
      'key-ideas': 'Improve and expand the following summary using the new text fragment. Preserve the main idea. Respond in the same language as the source text:\n\n',
      'preserve-details': 'Improve and expand the following summary using the new text fragment. Preserve all facts. Respond in the same language as the source text:\n\n',
      'structured': 'Improve and expand the following structured summary using the new text fragment. Respond in the same language as the source text:\n\n'
    }
    return basePrompts[style]
  }
}

/**
 * Generates prompt based on user settings
 */
export function generatePrompt(
  text: string,
  length: SummaryLength = 'medium',
  style: SummaryStyle = 'key-ideas'
): string {
  const template = PROMPT_MATRIX[length][style]
  return template.replace('{text}', text)
}

/**
 * Determines model context window (static data as fallback)
 */
export function getContextWindow(provider: string, modelName: string): number {
  const contextWindows: Record<string, Record<string, number>> = {
    openai: {
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
      'gpt-4-turbo': 128000,
      'gpt-4': 8192,
      'gpt-3.5-turbo': 4096,
      'gpt-3.5-turbo-16k': 16384
    },
    gemini: {
      'gemini-1.5-pro': 2000000,
      'gemini-1.5-flash': 1000000,
      'gemini-pro': 30720
    },
    openrouter: {
      'claude-3-5-sonnet-20241022': 200000,
      'claude-3-opus-20240229': 200000,
      'claude-3-sonnet-20240229': 200000,
      'claude-3-haiku-20240307': 200000,
      'llama-3.1-405b-instruct': 128000,
      'llama-3.1-70b-instruct': 128000
    }
  }
  
  return contextWindows[provider]?.[modelName] || 4000
}

/**
 * Gets model context window dynamically via API
 */

/**
 * Determines automatic strategy based on text size and settings
 */
export function determineStrategy(
  textLength: number,
  contextWindow: number,
  style: SummaryStyle
): 'single' | 'map-reduce' | 'refine' {
  // If text fits in context window, use simple strategy
  if (textLength < contextWindow * 0.7) { // 70% of context window for safety
    return 'single'
  }
  
  // If text doesn't fit, choose strategy based on style
  if (style === 'preserve-details') {
    return 'map-reduce' // Better for extracting facts from each part
  } else {
    return 'refine' // Better for preserving overall narrative thread
  }
}

/**
 * Splits text into chunks for processing
 */
export function splitTextIntoChunks(text: string, maxChunkSize: number): string[] {
  const limit = Math.floor(maxChunkSize)
  if (!Number.isFinite(limit) || limit < 2) throw new Error("Invalid chunk size")
  const chunks: string[] = []
  let remaining = text.trim()
  while (remaining.length > limit) {
    let end = remaining.lastIndexOf(" ", limit)
    if (end < limit / 2) end = limit
    const last = remaining.charCodeAt(end - 1)
    if (last >= 0xd800 && last <= 0xdbff) end--
    const chunk = remaining.slice(0, end).trim()
    if (chunk) chunks.push(chunk)
    remaining = remaining.slice(end).trim()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

/**
 * Gets prompt for Map-Reduce strategy
 */
export function getMapReducePrompt(style: SummaryStyle, isReduce: boolean = false): string {
  if (isReduce) {
    return MAP_REDUCE_PROMPTS.reduce(style)
  }
  return MAP_REDUCE_PROMPTS.map(style)
}

/**
 * Gets prompt for Refine strategy
 */
export function getRefinePrompt(style: SummaryStyle, isRefine: boolean = false): string {
  if (isRefine) {
    return REFINE_PROMPTS.refine(style)
  }
  return REFINE_PROMPTS.initial(style)
}
