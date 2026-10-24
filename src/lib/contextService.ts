/**
 * Service for assembling context from node graph
 * Implements assembleContext function with precise formatting rules
 */

import { Node, Edge } from "reactflow"
import { VideoAttachment, type VideoFrameDescriptor } from "@/types"
import { videoFrameList } from "./videoFrameMetadata"
import { appendCsvContext, formatCsvContext, limitCsvRows } from "./csvContext"
import { ApiError } from "./apiErrors"

const ATTACHMENT_ERROR = "A connected attachment could not be loaded. Re-upload the file or remove its connection, then try again."

// Extend ReactFlow types for our needs
export interface ContextNode extends Node {
  data: {
    hidden?: boolean
    // LLM nodes (openai, gemini, openrouter, nanobanana)
    promptText?: string
    responseText?: string
    // TextNode
    textContent?: string
    // SummarizerNode
    summaryText?: string
    // MemoryNode
    value?: string
    // NotesNode and MediaNode are ignored
    notes?: string
    url?: string
    caption?: string
    // Other possible fields
    [key: string]: any
  }
}

/**
 * Result of context assembly with multimodal support
 */
export interface ContextResult {
  text: string
  images: Array<{
    id: string
    dataUrl: string
    mimeType: string
    width: number
    height: number
    caption?: string
  }>
  csvFiles: Array<{
    id: string
    filename: string
    csvData: string
    csvRows: number
    csvColumns: number
    caption?: string
  }>
  videos: VideoAttachment[]
}

/**
 * Assembles context from node graph, starting from target node and traversing parent nodes
 * @param targetNodeId - ID of target node
 * @param nodes - array of all nodes
 * @param edges - array of all edges
 * @param excludeExecutedNodes - exclude executed LLM nodes from context (for token preview)
 * @returns formatted context string
 */
export function assembleContext(
  targetNodeId: string,
  nodes: Node[],
  edges: Edge[],
  excludeExecutedNodes: boolean = false
): string {
  // First collect all MemoryNode on canvas
  const memoryNodes = nodes.filter(node =>
    node.type === 'memory' &&
    !node.data.hidden &&
    node.data.value?.trim()
  )

  // Collect content of all MemoryNode
  const memoryContent = memoryNodes
    .map(node => `Persistent Memory: ${node.data.value}`)
    .join('\n\n')

  // Build graph of connections for traversal
  const nodeMap = new Map<string, Node>()
  const parentMap = new Map<string, string[]>()

  // Fill node map
  nodes.forEach(node => {
    nodeMap.set(node.id, node)
  })

  // Build parent connection map
  edges.forEach(edge => {
    if (!parentMap.has(edge.target)) {
      parentMap.set(edge.target, [])
    }
    parentMap.get(edge.target)!.push(edge.source)
  })

  // Traverse graph upward from target node
  const visited = new Set<string>()
  const contextParts: string[] = []

  function traverseUp(nodeId: string, isTargetNode: boolean = false) {
    if (visited.has(nodeId)) return
    visited.add(nodeId)

    const node = nodeMap.get(nodeId)
    if (!node) return

    // Skip hidden nodes
    if (node.data.hidden) return

    // Get parent nodes
    const parents = parentMap.get(nodeId) || []

    // First process parent nodes
    parents.forEach(parentId => {
      traverseUp(parentId, false)
    })

    // Process current node
    // Target node is included in context only if it has responseText (already executed)
    if (!isTargetNode || (isTargetNode && node.data?.responseText?.trim())) {
      const formattedContent = formatNodeContent(node, excludeExecutedNodes)
      if (formattedContent) {
        contextParts.push(formattedContent)
      }
    }
  }

  // Start traversal from target node, but mark it as target
  traverseUp(targetNodeId, true)

  // Combine all context parts
  const contextPartsString = contextParts.join('\n\n')

  // Return final context: first memory, then rest of context
  if (memoryContent && contextPartsString) {
    return `${memoryContent}\n\n${contextPartsString}`
  } else if (memoryContent) {
    return memoryContent
  } else if (contextPartsString) {
    return contextPartsString
  } else {
    return ''
  }
}

/**
 * Formats node content according to rules
 * @param node - node to format
 * @param excludeExecutedNodes - exclude executed LLM nodes
 * @returns formatted string or null if node should be ignored
 */
function formatNodeContent(node: Node, excludeExecutedNodes: boolean = false): string | null {
  const { type, data } = node

  switch (type) {
    case 'custom':
    case 'openai':
    case 'gemini':
    case 'openrouter':
    case 'nanobanana':
      return formatLLMNode(data, excludeExecutedNodes)

    case 'text':
      return formatTextNode(data)

    case 'summarizer':
      return formatSummarizerNode(data)

    case 'memory':
      // MemoryNode are processed separately at the beginning of the function
      return null

    case 'notes':
    case 'media':
      return formatMediaNode(data)

    default:
      // For unknown types return null
      return null
  }
}

/**
 * Formats LLM node (OpenAI, Gemini, OpenRouter)
 * Format: User: [promptText]\nAssistant: [responseText]
 */
function formatLLMNode(data: Node['data'], excludeExecutedNodes: boolean = false): string | null {
  // If we need to exclude executed nodes and node is executed, skip it
  if (excludeExecutedNodes && data.status === 'done') {
    return null
  }

  const { promptText, responseText } = data

  if (!promptText?.trim() && !responseText?.trim()) {
    return null
  }

  const parts: string[] = []

  if (promptText?.trim()) {
    parts.push(`User: ${promptText.trim()}`)
  }

  if (responseText?.trim()) {
    const label = data.status === 'error' ? 'Assistant partial output (failed execution; incomplete and unverified)' : 'Assistant'
    parts.push(`${label}: ${responseText.trim()}`)
  }

  return parts.length > 0 ? parts.join('\n') : null
}

/**
 * Formats TextNode
 * Format: Text Input: [textContent]
 */
function formatTextNode(data: Node['data']): string | null {
  const { textContent } = data

  if (!textContent?.trim()) {
    return null
  }

  return `Text Input: ${textContent.trim()}`
}

/**
 * Formats SummarizerNode
 * Format: Assistant Summary: [summaryText]
 */
function formatSummarizerNode(data: Node['data']): string | null {
  // An explicitly empty response must not resurrect an older legacy summary.
  const summaryText = typeof data.responseText === 'string' ? data.responseText : data.summaryText

  if (!summaryText?.trim()) {
    return null
  }

  const label = data.status === 'error' ? 'Assistant Summary partial output (failed execution; incomplete and unverified)' : 'Assistant Summary'
  return `${label}: ${summaryText.trim()}`
}

/**
 * Formats MediaNode
 * Format: Media: [filename] - [caption] (if caption exists)
 * For CSV files: CSV Data: [filename] - [csvData] - [caption]
 */
function formatMediaNode(data: Node['data']): string | null {
  const { caption, filename, csvData, mimeType, csvLimitEnabled, csvMaxRows } = data

  if (mimeType === 'text/csv' && typeof csvData === 'string') {
    return formatCsvContext({
      filename: filename || 'CSV attachment',
      csvData: limitCsvRows(csvData, csvLimitEnabled, csvMaxRows),
      csvRows: data.csvRows,
      csvColumns: data.csvColumns,
      caption
    })
  }

  if (!caption?.trim() && !filename?.trim()) {
    return null
  }

  const parts: string[] = []

  if (filename?.trim()) {
    parts.push(`Media: ${filename.trim()}`)
  }

  if (caption?.trim()) {
    parts.push(`Caption: ${caption.trim()}`)
  }

  return parts.length > 0 ? parts.join(' - ') : null
}

/**
 * Assembles context with multimodal support (text + images + videos)
 * @param targetNodeId - ID of target node
 * @param nodes - array of all nodes
 * @param edges - array of all edges
 * @param excludeExecutedNodes - exclude executed LLM nodes from context (for token preview)
 * @returns object with text and images
 */
export async function assembleContextWithMedia(
  targetNodeId: string,
  nodes: Node[],
  edges: Edge[],
  excludeExecutedNodes: boolean = false
): Promise<ContextResult> {
  // Collect MediaNode connected to target node
  const mediaNodes = getConnectedMediaNodes(targetNodeId, nodes, edges)

  const videos: VideoAttachment[] = []

  // Load media files
  const mediaResults = await Promise.all(
    mediaNodes.map(async (node) => {
      try {
        // For MediaNode - load via API
        if (node.type === 'media' || node.data.generatedImage) {
          const mediaId = node.type === 'media' ? node.data.mediaId : node.data.generatedImage?.mediaId
          // Check that mediaId exists
          if (!mediaId) {
            throw new ApiError(ATTACHMENT_ERROR)
          }

          const mimeType = node.data.mimeType || ''
          if (mimeType.startsWith('video/')) {
            const attachment = await buildVideoAttachment(node)
            if (!attachment) throw new ApiError(ATTACHMENT_ERROR)
            videos.push(attachment)
            return null
          }

          // Determine if we're running on server
          const isServer = typeof window === 'undefined'

          if (isServer) {
            // On server read file directly
            const fs = await import('fs')
            const readFile = fs.promises.readFile
            const { resolvePublicPath } = await import('@/lib/publicPath')
            const { prisma } = await import('@/lib/prisma')

            const media = await prisma.media.findUnique({
              where: { id: mediaId },
              include: {
                canvas: {
                  select: { userId: true }
                }
              }
            })

            if (!media) {
              throw new ApiError(ATTACHMENT_ERROR)
            }

            const fullPath = resolvePublicPath(media.filePath, media.canvasId)
            const fileBuffer = await readFile(fullPath)
            const base64 = fileBuffer.toString('base64')
            const dataUrl = `data:${media.mimeType};base64,${base64}`

            return {
              node,
              mediaData: {
                dataUrl,
                mimeType: media.mimeType,
                filename: media.filename,
                width: media.width,
                height: media.height,
                csvData: media.csvData,
                csvRows: media.csvRows,
                csvColumns: media.csvColumns
              }
            }
          } else {
            // In browser use fetch
            const response = await fetch(`/api/media/${mediaId}/base64`)
            if (!response.ok) {
              throw new ApiError(ATTACHMENT_ERROR)
            }
            const mediaData = await response.json()
            return {
              node,
              mediaData
            }
          }
        }


        throw new ApiError(ATTACHMENT_ERROR)
      } catch {
        // Do not leak filesystem paths, response bodies or database details.
        throw new ApiError(ATTACHMENT_ERROR)
      }
    })
  )

  // Filter null values
  const validMedia = mediaResults.filter(Boolean) as Array<{
    node: Node
    mediaData: any
  }>

  for (const { mediaData } of validMedia) {
    if (typeof mediaData?.mimeType !== 'string') throw new ApiError(ATTACHMENT_ERROR)
    if (mediaData.mimeType.startsWith('image/')) {
      if (typeof mediaData.dataUrl !== 'string' || !mediaData.dataUrl.startsWith(`data:${mediaData.mimeType};base64,`) || !mediaData.dataUrl.split(',')[1]?.trim()) {
        throw new ApiError(ATTACHMENT_ERROR)
      }
    } else if (mediaData.mimeType !== 'text/csv' || typeof mediaData.csvData !== 'string') {
      throw new ApiError(ATTACHMENT_ERROR)
    }
  }

  // Separate images and CSV files
  // In src/lib/contextService.ts, lines 380-389:



  const images = validMedia
    .filter(({ mediaData }) => mediaData.mimeType.startsWith('image/'))
    .map(({ node, mediaData }) => {
      const imageData = {
        id: node.data.generatedImage
          ? node.data.generatedImage?.mediaId || node.id
          : node.data.mediaId,
        dataUrl: mediaData.dataUrl,
        mimeType: mediaData.mimeType,
        width: mediaData.width || 0,
        height: mediaData.height || 0,
        caption: node.data.caption
      }



      return imageData
    })

  const csvFiles = validMedia
    .filter(({ mediaData }) => mediaData.mimeType === 'text/csv')
    .map(({ node, mediaData }) => {
      const processedCsvData = limitCsvRows(mediaData.csvData, node.data.csvLimitEnabled, node.data.csvMaxRows)

      return {
        id: node.data.mediaId,
        filename: mediaData.filename || 'CSV attachment',
        csvData: processedCsvData,
        csvRows: mediaData.csvRows,
        csvColumns: mediaData.csvColumns,
        caption: node.data.caption
      }
    })

  // Use the loaded CSV contents rather than potentially stale cached node rows.
  const loadedCsv = new Map(validMedia.filter(({ mediaData }) => mediaData.mimeType === 'text/csv').map(({ node, mediaData }) => [node.id, mediaData]))
  const contextNodes = nodes.map(node => {
    const csv = loadedCsv.get(node.id)
    return csv ? { ...node, data: { ...node.data, ...csv } } : node
  })
  const textContext = assembleContext(targetNodeId, contextNodes, edges, excludeExecutedNodes)



  return {
    text: appendCsvContext(textContext, csvFiles),
    images,
    csvFiles,
    videos
  }
}

/**
 * Gets MediaNode and NanoBanana nodes with images connected to target node
 */
export function getConnectedMediaNodes(
  targetNodeId: string,
  nodes: Node[],
  edges: Edge[]
): Node[] {


  // Build connection map
  const parentMap = new Map<string, string[]>()
  edges.forEach(edge => {
    if (!parentMap.has(edge.target)) {
      parentMap.set(edge.target, [])
    }
    parentMap.get(edge.target)!.push(edge.source)
  })

  // Traverse graph upward from target node
  const visited = new Set<string>()
  const mediaNodes: Node[] = []

  function traverseUp(nodeId: string) {
    if (visited.has(nodeId)) return
    visited.add(nodeId)

    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    if (node.data.hidden) return

    // Include incomplete media references too: execution must report them, not omit them.
    if (nodeId !== targetNodeId && node.type === 'media' && !node.data.hidden) {
      mediaNodes.push(node)
    }

    // If this is NanoBanana node with done status and generated image, add to result
    if (nodeId !== targetNodeId && (node.type === 'nanobanana' || (node.type === 'custom' && (node.data.mode === 'image-generation' || node.data.mode === 'image-edit' || node.data.mode === 'chat-image')))) {


      if (!node.data.hidden && node.data.status === 'done' && node.data.generatedImage) {

        mediaNodes.push(node)
      } else {

      }
    }

    // Continue traversing parent nodes
    const parents = parentMap.get(nodeId) || []
    parents.forEach(parentId => traverseUp(parentId))
  }

  traverseUp(targetNodeId)



  return mediaNodes
}

async function buildVideoAttachment(node: Node): Promise<VideoAttachment | null> {
  if (!node.data?.mediaId || !node.data?.filePath || !node.data?.mimeType?.startsWith('video/')) {
    return null
  }

  let videoFrames = node.data.videoFrames
  let durationMs = node.data.durationMs
  let frameRate = node.data.frameRate
  let frameCount = node.data.frameCount
  let thumbnailPath = node.data.thumbnailPath
  let fileSize = node.data.fileSize
  let geminiFileUri = node.data.geminiFileUri
  let geminiUploadedAt = node.data.geminiUploadedAt

  const needsServerData = (typeof window === 'undefined') && (!videoFrames || !thumbnailPath)
  let dataFromDb = false

  if (needsServerData) {
    try {
      const { prisma } = await import('@/lib/prisma')
      const media = await prisma.media.findUnique({
        where: { id: node.data.mediaId }
      })

      if (media) {
        const hadVideoFrames = !!videoFrames
        const hadThumbnail = !!thumbnailPath
        const hadGeminiUri = !!geminiFileUri

        videoFrames = (media.videoFrames as any) || videoFrames
        durationMs = durationMs ?? media.durationMs ?? undefined
        frameRate = frameRate ?? media.frameRate ?? undefined
        frameCount = frameCount ?? media.frameCount ?? undefined
        thumbnailPath = thumbnailPath ?? media.thumbnailPath ?? undefined
        fileSize = fileSize ?? media.fileSize ?? undefined
        geminiFileUri = geminiFileUri ?? media.geminiFileUri ?? undefined
        geminiUploadedAt = geminiUploadedAt ?? (media.geminiUploadedAt ? media.geminiUploadedAt.toISOString() : null)

        dataFromDb = true

        // Logging in development mode about data synchronization
        if (process.env.NODE_ENV === 'development') {
          const fieldsFromDb: string[] = []
          if (!hadVideoFrames && media.videoFrames) fieldsFromDb.push('videoFrames')
          if (!hadThumbnail && media.thumbnailPath) fieldsFromDb.push('thumbnailPath')
          if (!hadGeminiUri && media.geminiFileUri) fieldsFromDb.push('geminiFileUri')

          if (fieldsFromDb.length > 0) {

          }
        }
      } else {
        throw new ApiError(ATTACHMENT_ERROR)
      }
    } catch {
      throw new ApiError(ATTACHMENT_ERROR)
    }
  } else if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    // In browser warn if gemini fields are missing but might be in DB
    if (!geminiFileUri && node.data.mediaId) {
      console.warn(`[buildVideoAttachment] Video node ${node.id} (media ${node.data.mediaId}) missing geminiFileUri. Consider syncing from DB.`)
    }
  }

  return {
    mediaId: node.data.mediaId,
    filePath: node.data.filePath,
    mimeType: node.data.mimeType,
    fileSize: fileSize || 0,
    durationMs: durationMs || 0,
    frameRate,
    frameCount: frameCount ?? (videoFrames ? videoFrameList<VideoFrameDescriptor>(videoFrames).length : undefined),
    thumbnailPath,
    frames: videoFrameList<VideoFrameDescriptor>(videoFrames),
    caption: node.data.caption,
    geminiFileUri: geminiFileUri ?? null,
    geminiUploadedAt: geminiUploadedAt ?? null
  }
}
