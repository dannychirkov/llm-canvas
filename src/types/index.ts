import type { Node as ReactFlowNode, Edge as ReactFlowEdge, NodeProps as ReactFlowNodeProps } from 'reactflow'

// Types based on Prisma schema
// Internal server type with sensitive data (passwordHash)
export interface UserInternal {
  id: string
  email: string
  name: string | null
  image: string | null
  passwordHash: string | null
  analyticsEnabled: boolean
  isOwner: boolean
  createdAt: Date
  updatedAt: Date
}

// Public client type without sensitive data
export interface User {
  id: string
  email: string
  name: string | null
  image: string | null
  analyticsEnabled: boolean
  isOwner: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Canvas {
  id: string
  title: string
  description: string | null
  content: string | null
  isPublic: boolean
  isPinned: boolean
  createdAt: Date
  updatedAt: Date
  nodeCount: number | null
  largestContextTokens: number | null
  contextCacheUpdated: Date | null
  totalTokensUsed: number | null
  userId: string
}
export type Node = ReactFlowNode
export type Edge = ReactFlowEdge
export type NodeProps = ReactFlowNodeProps

export interface CanvasWithUser extends Canvas {
  user: User
}

export interface UserWithCanvases extends User {
  canvases: Canvas[]
}

// Nano Banana types
export interface GeneratedImage {
  url: string
  mediaId: string
  width: number
  height: number
  usageSource?: "provider" | "unreported"
}

export interface IterationHistoryItem {
  url: string
  mediaId: string
  prompt: string
  timestamp: number
}

// Extended token breakdown structure with support for additional fields
export interface TokenBreakdown {
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  cachedTokens?: number
  audioTokens?: number
  videoTokens?: number
  imageTokens?: number
}

export interface ExecutionUsageData {
  usageSource?: "provider" | "estimated" | "unreported"
  executionId?: string
}

export interface NanoBananaData extends ExecutionUsageData {
  title?: string
  mode: "text-to-image" | "image-edit" | "composition" | "iterative"
  promptText?: string
  responseText?: string
  generatedImage?: GeneratedImage
  iterationHistory?: IterationHistoryItem[]
  status?: "idle" | "processing" | "done" | "error" | "edited"
  hidden?: boolean
  isCollapsed?: boolean
  tokens?: number
  tokenBreakdown?: TokenBreakdown
  isStreaming?: boolean
  streamingText?: string
  executionStartTime?: number
  lastExecutionState?: LastExecutionState
}

// Streaming types
export interface StreamingResponse {
  content?: string
  fullResponse?: string
  tokens?: number
  done?: boolean
  error?: string
  generatedImage?: GeneratedImage
  rawResponse?: string
}

export interface GroundingChunk {
  web?: {
    uri?: string
    title?: string
  }
}

export interface GroundingMetadata {
  chunks?: GroundingChunk[]
  searchEntryPoint?: {
    renderedContent?: string
  }
}

// API Request/Response Types
export interface ImageData {
  dataUrl: string
  mimeType: string
  mediaId?: string
  timestampMs?: number
  width?: number
  height?: number
  filePath?: string
}

export interface VideoFrameDescriptor {
  path: string
  width: number
  height: number
  timestampMs: number
  mimeType: string
}

export interface VideoAttachment {
  canvasId?: string
  mediaId: string
  filePath: string
  mimeType: string
  fileSize: number
  durationMs: number
  frameRate?: number
  frameCount?: number
  thumbnailPath?: string
  frames?: VideoFrameDescriptor[]
  caption?: string
  geminiFileUri?: string | null
  geminiUploadedAt?: string | null
}

export interface CsvFileData {
  filename: string
  caption?: string
  csvRows: number
  csvColumns: number
  csvData: string
}

export interface RequestOptions {
  temperature?: number
  top_p?: number
  max_tokens?: number
  seed?: number
}

export interface GeminiPayload {
  contents: Array<{
    role: string
    parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
      | { fileData: { fileUri: string; mimeType: string } }
    >
  }>
  tools?: Array<{ googleSearch: Record<string, never> }>
  generationConfig?: {
    temperature?: number
    topP?: number
    maxOutputTokens?: number
  }
}

export interface OpenAIPayload {
  model: string
  messages: Array<{
    role: string
    content: Array<{ type: string; text?: string; image_url?: { url: string } }>
  }>
  temperature?: number
  top_p?: number
  max_tokens?: number
  stream?: boolean
  stream_options?: { include_usage: boolean }
}

export interface OpenRouterPayload {
  model: string
  messages: Array<{
    role: string
    content: Array<{ type: string; text?: string; image_url?: { url: string } }>
  }>
  temperature?: number
  top_p?: number
  max_tokens?: number
  stream?: boolean
  stream_options?: { include_usage: boolean }
}

export interface NanoBananaPayload {
  contents: Array<{
    parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>
  }>
  generationConfig?: {
    temperature?: number
    topP?: number
    maxOutputTokens?: number
    responseModalities?: string[]
  }
}

export interface LastExecutionState {
  promptText?: string
  summaryText?: string
  textContent?: string
  modelName?: string
  temperature?: number
  max_tokens?: number
  top_p?: number
  seed?: number
  responseText?: string // Save responseText to track changes after execution
  summaryLength?: SummaryLength
  summaryStyle?: SummaryStyle
  autoStrategy?: "single" | "map-reduce" | "refine"
  contextWindow?: number
  textLength?: number
  finalPrompt?: string
  requestPayload?: Record<string, unknown>
}

export interface NodeDebugInfo {
  provider?: string
  model?: string
  requestPayload?: Record<string, unknown>
  providerRequestPayload?: Record<string, unknown>
  requestTimestamp?: number
  responseTimestamp?: number
  latencyMs?: number
  status?: "pending" | "success" | "error"
}

export interface NodeData extends ExecutionUsageData {
  endpointId?: string
  title?: string
  promptText?: string
  responseText?: string
  status?: "idle" | "processing" | "done" | "error" | "edited"
  hidden?: boolean
  isStreaming?: boolean
  streamingText?: string
  tokens?: number
  tokenBreakdown?: TokenBreakdown
  rawResponse?: string
  structuredResponse?: string
  lastExecutionState?: LastExecutionState
  groundingMetadata?: GroundingMetadata
  debugInfo?: NodeDebugInfo
  executionStartTime?: number
}

// Common interface for all LLM nodes with provider and modelName fields
export interface LLMNodeData extends NodeData {
  provider?: string
  modelName?: string
}

// Smart Summarizer types
export type SummaryLength = "brief" | "medium" | "detailed"
export type SummaryStyle = "key-ideas" | "preserve-details" | "structured"

export interface SmartSummarizerData extends ExecutionUsageData {
  endpointId?: string
  title?: string
  provider?: string
  modelName?: string
  temperature?: number
  max_tokens?: number
  top_p?: number
  seed?: number
  status?: "idle" | "processing" | "done" | "error" | "edited"
  responseText?: string
  hidden?: boolean
  isStreaming?: boolean
  streamingText?: string
  isCollapsed?: boolean
  tokens?: number
  tokenBreakdown?: TokenBreakdown
  error?: string
  // Smart summarizer specific fields
  summaryLength?: SummaryLength
  summaryStyle?: SummaryStyle
  autoStrategy?: "single" | "map-reduce" | "refine"
  contextWindow?: number
  lastExecutionState?: LastExecutionState
  executionStartTime?: number
  // Debug inspector fields
  rawResponse?: string
  structuredResponse?: string
  debugInfo?: NodeDebugInfo
}

// LLM Node Data Types
export interface GeminiData extends NodeData {
  modelName?: string
  temperature?: number
  max_tokens?: number
  top_p?: number
  seed?: number
  groundingMetadata?: GroundingMetadata
  isCollapsed?: boolean
  error?: string
  useTools?: boolean
}

export interface OpenAIData extends NodeData {
  imageResponseFormat?: "auto" | "b64_json"
  mode?: "chat" | "image-generation" | "image-edit" | "chat-image"
  generatedImage?: GeneratedImage
  modelName?: string
  temperature?: number
  max_tokens?: number
  top_p?: number
  seed?: number
  isCollapsed?: boolean
  error?: string
}

export interface OpenRouterData extends NodeData {
  modelName?: string
  temperature?: number
  max_tokens?: number
  top_p?: number
  seed?: number
  isCollapsed?: boolean
  error?: string
}

export interface MediaData {
  title?: string
  url?: string
  caption?: string
  mediaId?: string
  filePath?: string
  filename?: string
  mimeType?: string
  fileSize?: number
  width?: number
  height?: number
  canvasId?: string
  csvData?: string
  csvRows?: number
  csvColumns?: number
  csvLimitEnabled?: boolean
  csvMaxRows?: number
  durationMs?: number
  frameRate?: number
  frameCount?: number
  videoFrames?: VideoFrameDescriptor[]
  thumbnailPath?: string
  geminiFileUri?: string | null
  geminiUploadedAt?: string | null
  videoFilePath?: string
  videoMimeType?: string
  videoFileSize?: number
  isVideo?: boolean
  isImage?: boolean
  isCsv?: boolean
  isCollapsed?: boolean
  mediaFiles?: Array<{
    name: string
    url: string
    type: string
    size: number
  }>
  status?: "idle" | "processing" | "done" | "error"
  error?: string
  loadingMessage?: string
  hidden?: boolean
}

