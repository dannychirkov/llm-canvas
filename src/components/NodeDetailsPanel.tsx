"use client"
import ImageOutputSettings from "@/components/ImageOutputSettings"
import type { CredentialProviderId } from "@/lib/providers/registry"


import { escapeHtml } from "@/lib/htmlEscape"
import { renderCsvPreview } from "@/lib/csvPreview"

import { useEffect, useState, useMemo, useCallback } from "react"
import { Node, Edge } from "reactflow"
import { X, Copy, Code, ChevronDown, ChevronRight, Check, Edit3, Upload, FileText, Calculator, Maximize, Download, Trash2, RotateCcw } from "lucide-react"
import TokenUsageSection from "./TokenUsageSection"
import TokenPreviewSection from "./TokenPreviewSection"
import { isProviderId } from "@/lib/providers/registry"
import { nodeOperator } from "@/lib/tokenUsage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { getPrimaryColor } from "@/components/nodes/colors"
import { assembleContext } from "@/lib/contextService"
import { calculateTokenPreview, type TokenPreviewResult } from "@/lib/tokenPreviewCalculator"
import { customModelContextWindow } from "@/lib/providers/customTypes"
import { useSettings } from "@/components/providers/SettingsProvider"
import MarkdownRenderer from "@/components/MarkdownRenderer"
import NodeThoughts from "@/components/NodeThoughts"
import { SummaryLength, SummaryStyle, type VideoFrameDescriptor } from "@/types"
import { videoFrameList } from "@/lib/videoFrameMetadata"
import { isNavigableNodeType, getNodeTypeIcon } from "@/components/nodes/NodeTypeIcon"
import { calculateTokensForBothProviders, formatTokenCount } from "@/lib/tokenCalculator"

// Function to estimate token count in text
function estimateTokenCount(text: string): number {
  if (!text) return 0
  try {
    const matches = text.match(/\p{L}+|\p{N}+|[^\s\p{L}\p{N}]/gu)
    return matches ? matches.length : Math.ceil(text.length / 4)
  } catch {
    return Math.ceil(text.length / 4)
  }
}

// Function to highlight JSON with beautiful color scheme
const highlightJSON = (jsonString: string) => {
  try {
    const parsed = JSON.parse(jsonString)
    const formatted = JSON.stringify(parsed, null, 2)

    return formatted
      .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
        let className = 'text-slate-300' // default color

        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            // Dark emerald green for keys
            className = 'text-emerald-600'
          } else {
            // Complex red shade for strings (burgundy-red with pink tint)
            className = 'text-rose-400'
          }
        } else if (/true|false/.test(match)) {
          // Warm purple for boolean values
          className = 'text-violet-400'
        } else if (/null/.test(match)) {
          // Soft orange for null
          className = 'text-amber-400'
        } else if (/^-?\d/.test(match)) {
          // Bright cyan for numbers
          className = 'text-cyan-400'
        }

        return `<span class="${className}">${escapeHtml(match)}</span>`
      })
  } catch (error) {
    // If not JSON, return as is
    return escapeHtml(jsonString)
  }
}

interface NodeDetailsPanelProps {
  selectedNode: Node | null
  isOpen: boolean
  onClose: () => void
  allNodes: Node[]
  allEdges: Edge[]
  onNodeUpdate?: (id: string, patch: Record<string, any>) => void
  onRun?: (id: string) => void
  onRestore?: (id: string) => void
  onNavigateToNode?: (nodeId: string) => void
  embedded?: boolean
}

export default function NodeDetailsPanel({ selectedNode, isOpen, onClose, allNodes, allEdges, onNodeUpdate, onRun, onRestore, onNavigateToNode, embedded = false }: NodeDetailsPanelProps) {
  const [activeTab, setActiveTab] = useState<'editor' | 'debug'>('editor')
  const [isRequestCollapsed, setIsRequestCollapsed] = useState(true)
  const [isProviderRequestCollapsed, setIsProviderRequestCollapsed] = useState(true)
  const [isRawResponseCollapsed, setIsRawResponseCollapsed] = useState(true)
  const [isStructuredResponseCollapsed, setIsStructuredResponseCollapsed] = useState(true)
  const [isFinalPromptCollapsed, setIsFinalPromptCollapsed] = useState(true)
  const [isNodeInfoCollapsed, setIsNodeInfoCollapsed] = useState(true)
  const [isTokenInfoCollapsed, setIsTokenInfoCollapsed] = useState(false)
  const [requestCopied, setRequestCopied] = useState(false)
  const [providerRequestCopied, setProviderRequestCopied] = useState(false)
  const [rawResponseCopied, setRawResponseCopied] = useState(false)
  const [structuredResponseCopied, setStructuredResponseCopied] = useState(false)
  const [finalPromptCopied, setFinalPromptCopied] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [editingResponse, setEditingResponse] = useState(false)
  const [localResponseText, setLocalResponseText] = useState(selectedNode?.data?.responseText || '')
  const [showRawText, setShowRawText] = useState(false)
  const [showRawTextContent, setShowRawTextContent] = useState(false)
  const localTextContent = selectedNode?.data?.textContent || ''
  const localCaption = selectedNode?.data?.caption || ''
  const localPromptText = selectedNode?.data?.promptText || ''
  const [textContentCopied, setTextContentCopied] = useState<'text' | 'md' | null>(null)
  const [responseCopied, setResponseCopied] = useState<'text' | 'md' | null>(null)
  const [calculatedTokenPreview, setTokenPreview] = useState<TokenPreviewResult | null>(null)
  const [previewPending, setIsCalculatingPreview] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const settings = useSettings()
  const selectedCustomEndpoint = settings.customEndpoints.find(endpoint => endpoint.id === selectedNode?.data?.endpointId)
  const selectedContextCapacity = selectedCustomEndpoint?.apiType === "comfyui" ? undefined : selectedCustomEndpoint ? customModelContextWindow(selectedCustomEndpoint, selectedNode?.data?.modelName ?? "") : selectedNode?.data?.contextWindow
  const usageSource = selectedNode?.data?.usageSource ?? selectedNode?.data?.generatedImage?.usageSource
  const usageLabel = usageSource === "provider" ? "Provider reported" : usageSource === "estimated" ? "Estimated" : usageSource === "unreported" ? "Not reported" : "Source unavailable"
  const [draftNodeId, setDraftNodeId] = useState(selectedNode?.id)
  const responseSource = selectedNode?.data?.responseText || ''
  const [syncedResponse, setSyncedResponse] = useState(responseSource)

  if (draftNodeId !== selectedNode?.id) {
    setDraftNodeId(selectedNode?.id)
    setLocalResponseText(responseSource)
    setRequestCopied(false)
    setProviderRequestCopied(false)
    setRawResponseCopied(false)
    setStructuredResponseCopied(false)
    setFinalPromptCopied(false)
    setShowSettings(false)
    setEditingResponse(false)
    setShowRawText(false)
    setIsRequestCollapsed(true)
    setIsProviderRequestCollapsed(true)
    setIsRawResponseCollapsed(true)
    setIsStructuredResponseCollapsed(true)
    setIsFinalPromptCollapsed(true)
    setIsNodeInfoCollapsed(true)
    setIsTokenInfoCollapsed(false)
    setTokenPreview(null)
    setIsCalculatingPreview(false)
  }
  if (syncedResponse !== responseSource) {
    setSyncedResponse(responseSource)
    if (!editingResponse) setLocalResponseText(responseSource)
  }


  // Size constraints (as in version 1)
  const minWidth = Math.floor((typeof window === "undefined" ? 1200 : window.innerWidth) * 0.4)
  const maxWidth = embedded ? Math.floor(window.innerWidth * 0.5) : Math.floor(window.innerWidth * 0.8) // Reduced from 0.55 to 0.5 (50%)

  // Optimal initial width (50% of screen width, but not less than minimum)
  const initialWidth = Math.max(minWidth, Math.floor(window.innerWidth * 0.5))

  // Get saved width from localStorage or use initial
  const getSavedWidth = () => {
    if (typeof window === 'undefined') return initialWidth
    const saved = localStorage.getItem('nodeDetailsPanelWidth')
    if (saved) {
      const parsedWidth = parseInt(saved, 10)
      // Check that saved width is within valid range
      if (parsedWidth >= minWidth && parsedWidth <= maxWidth) {
        return parsedWidth
      }
    }
    return initialWidth
  }

  // State for panel resizing (only if not embedded)
  const [panelWidth, setPanelWidth] = useState(getSavedWidth)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [startWidth, setStartWidth] = useState(0)

  // Handlers for panel resizing (only if not embedded)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (embedded) return
      setIsDragging(true)
      setStartX(e.clientX)
      setStartWidth(panelWidth)
    },
    [panelWidth, embedded]
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || embedded) return
      const deltaX = e.clientX - startX
      const newWidth = Math.max(
        minWidth,
        Math.min(maxWidth, startWidth + deltaX)
      )
      setPanelWidth(newWidth)
      // Save new width to localStorage
      localStorage.setItem('nodeDetailsPanelWidth', newWidth.toString())
    },
    [isDragging, startX, startWidth, minWidth, maxWidth, embedded]
  )

  const handleMouseUp = useCallback(() => {
    if (embedded) return
    setIsDragging(false)
  }, [embedded])

  // Global mouse handlers for resizing
  useEffect(() => {
    if (embedded) return
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = 'none'
    } else {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
    }
  }, [isDragging, handleMouseMove, handleMouseUp, embedded])

  // Synchronize gemini fields for video nodes
  useEffect(() => {
    if (!isOpen || !selectedNode || !onNodeUpdate) return
    if (selectedNode.type !== 'media') return
    
    const isVideo = selectedNode.data?.mimeType?.startsWith?.('video/') || selectedNode.data?.isVideo
    if (!isVideo) return
    
    const mediaId = selectedNode.data?.mediaId
    if (!mediaId) return
    
    // Check if gemini fields need to be synchronized
    const hasGeminiUri = selectedNode.data?.geminiFileUri
    if (hasGeminiUri) return // Already synchronized
    
    // Synchronize data from DB
    const syncGeminiFields = async () => {
      try {
        const response = await fetch(`/api/media/${mediaId}/sync`)
        if (!response.ok) {
          console.warn(`Failed to sync media data for ${mediaId}:`, response.statusText)
          return
        }
        
        const mediaData = await response.json()
        
        // Update only gemini fields if they exist in DB
        if (mediaData.geminiFileUri || mediaData.geminiUploadedAt) {
          onNodeUpdate(selectedNode.id, {
            geminiFileUri: mediaData.geminiFileUri || undefined,
            geminiUploadedAt: mediaData.geminiUploadedAt || undefined
          })
        }
      } catch (error) {
        console.error('Error syncing gemini fields:', error)
      }
    }
    
    syncGeminiFields()
  }, [isOpen, selectedNode, onNodeUpdate])

  // Handle window resize
  useEffect(() => {
    if (embedded) return
    const handleResize = () => {
      const newMinWidth = Math.floor(window.innerWidth * 0.4)
      const newMaxWidth = embedded ? Math.floor(window.innerWidth * 0.5) : Math.floor(window.innerWidth * 0.8) // Reduced from 0.55 to 0.5 (50%)

      // If current width exceeds new bounds, adjust it
      if (panelWidth < newMinWidth) {
        setPanelWidth(newMinWidth)
        localStorage.setItem('nodeDetailsPanelWidth', newMinWidth.toString())
      } else if (panelWidth > newMaxWidth) {
        setPanelWidth(newMaxWidth)
        localStorage.setItem('nodeDetailsPanelWidth', newMaxWidth.toString())
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [panelWidth, embedded])

  // ===== Media helpers (upload / drag-n-drop / remove) =====
  const handleFileUpload = useCallback(async (file: File) => {
    if (!selectedNode || selectedNode.type !== 'media' || !onNodeUpdate) return
    const isCsvFile = file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')
    const isImageFile = file.type.startsWith('image/')
    const isVideoFile = file.type.startsWith('video/')
    if (!isImageFile && !isVideoFile && !isCsvFile) {
      alert('Please select an image, video, or CSV file')
      return
    }
    setIsUploading(true)
    setUploadProgress(0)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('canvasId', (selectedNode.data as any)?.canvasId || 'temp')

      const xhr = new XMLHttpRequest()
      const responsePromise = new Promise<any>((resolve, reject) => {
        xhr.open('POST', '/api/media/upload', true)
        xhr.withCredentials = true
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100)
            setUploadProgress(percent)
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const json = JSON.parse(xhr.responseText || '{}')
              resolve(json)
            } catch (err) {
              reject(new Error('Invalid JSON response'))
            }
          } else {
            reject(new Error(xhr.responseText || `Upload failed with status ${xhr.status}`))
          }
        }
        xhr.onerror = () => reject(new Error('Network error during upload'))
        xhr.send(formData)
      })

      const result = await responsePromise
      setUploadProgress(100)
      const videoData = result.mimeType?.startsWith('video/')
      
      // Update media node data after successful upload
      // IMPORTANT: This block must be synchronized with MediaNode.tsx
      onNodeUpdate(selectedNode.id, {
        // Main media fields
        mediaId: result.mediaId,
        filePath: result.filePath,
        filename: result.filename,
        mimeType: result.mimeType,
        fileSize: result.fileSize,
        width: result.width,
        height: result.height,
        url: result.filePath, // For backward compatibility
        
        // CSV specific fields
        csvData: result.csvData,
        csvRows: result.csvRows,
        csvColumns: result.csvColumns,
        
        // Video specific fields
        durationMs: result.durationMs,
        frameRate: result.frameRate,
        frameCount: result.frameCount,
        videoFrames: result.videoFrames,
        thumbnailPath: result.thumbnailPath,
        videoFilePath: result.filePath,
        videoMimeType: videoData ? result.mimeType : undefined,
        videoFileSize: videoData ? result.fileSize : undefined,
        
        // Media type flags
        isVideo: videoData,
        isImage: !videoData && isImageFile,
        isCsv: isCsvFile
        
        // Note: geminiFileUri and geminiUploadedAt are updated separately
        // through synchronization in this component or after upload to Gemini
      })
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'))
      }, 100)
    } catch (error) {
      console.error('Upload failed:', error)
      alert(`Failed to upload file: ${error}`)
    } finally {
      setTimeout(() => {
        setIsUploading(false)
        setUploadProgress(0)
      }, 300)
    }
  }, [selectedNode, onNodeUpdate])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFileUpload(file)
  }, [handleFileUpload])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  const removeMedia = useCallback(() => {
    if (!selectedNode || selectedNode.type !== 'media' || !onNodeUpdate) return
    onNodeUpdate(selectedNode.id, {
      mediaId: undefined,
      filePath: undefined,
      filename: undefined,
      mimeType: undefined,
      fileSize: undefined,
      width: undefined,
      height: undefined,
      url: '',
      csvData: undefined,
      csvRows: undefined,
      csvColumns: undefined,
      csvLimitEnabled: undefined,
      csvMaxRows: undefined,
      durationMs: undefined,
      frameRate: undefined,
      frameCount: undefined,
      videoFrames: undefined,
      thumbnailPath: undefined,
      videoFilePath: undefined,
      videoMimeType: undefined,
      videoFileSize: undefined,
      isVideo: undefined,
      isImage: undefined,
      isCsv: undefined,
      geminiFileUri: undefined,
      geminiUploadedAt: undefined
    })
  }, [selectedNode, onNodeUpdate])

  // Generate payload for Debug Inspector (static snapshot)
  const requestPayload = useMemo(() => {
    if (!selectedNode) return ''

    const context = assembleContext(selectedNode.id, allNodes, allEdges)
    const promptText = selectedNode.data?.promptText || ''
    const finalPrompt = context ? `${context}\n\n${promptText}` : promptText

    return {
      finalPrompt,
      model: selectedNode.data?.modelName || '',
      temperature: selectedNode.data?.temperature || 0.7,
      max_tokens: selectedNode.data?.max_tokens || 1000,
      top_p: selectedNode.data?.top_p || 1.0,
      seed: selectedNode.data?.seed || undefined
    }
  }, [selectedNode?.id, allNodes, allEdges]) // Remove dependency on selectedNode.data for stability

  // Get raw response
  const rawResponse = selectedNode?.data?.rawResponse || ''
  const structuredResponseRaw = selectedNode?.data?.structuredResponse || ''

  // Function to format rawResponse into more readable form
  const formatRawResponse = useCallback((rawResponse: string) => {
    if (!rawResponse) return ''

    try {
      const parsed = JSON.parse(rawResponse)

      // If this is structuredResponse, extract and format main parts
      if (parsed.execution && parsed.parameters && parsed.input && parsed.output) {
        return JSON.stringify({
          execution: {
            provider: parsed.execution.provider,
            model: parsed.execution.model,
            timestamp: parsed.execution.timestamp,
            executionTime: parsed.execution.executionTime
          },
          parameters: parsed.parameters,
          input: {
            finalPrompt: parsed.input.finalPrompt,
            promptLength: parsed.input.promptLength,
            contextNodes: parsed.input.contextNodes,
            hasImages: parsed.input.hasImages,
            hasCsvFiles: parsed.input.hasCsvFiles
          },
          output: {
            response: parsed.output.response,
            tokens: parsed.output.tokens,
            responseLength: parsed.output.responseLength
          },
          rawApiResponse: parsed.rawApiResponse
        }, null, 2)
      }

      // If this is regular JSON, just format it
      return JSON.stringify(parsed, null, 2)
    } catch (error) {
      // If not JSON, return as is
      return rawResponse
    }
  }, [])

  // Check if node has been executed
  const hasBeenExecuted = selectedNode?.data?.status === 'done' || selectedNode?.data?.status === 'error' || selectedNode?.data?.status === 'edited'

  // Check if node has been executed
  // If node was executed, show actual payload from lastExecutionState
  const actualPayload = useMemo(() => {
    if (!selectedNode || !hasBeenExecuted) return null

    const lastExecutionState = selectedNode.data?.lastExecutionState
    if (!lastExecutionState) return null

    // Use saved finalPrompt if it exists, otherwise assemble again
    const finalPrompt = lastExecutionState.finalPrompt ||
      (() => {
        const context = assembleContext(selectedNode.id, allNodes, allEdges)
        const promptText = lastExecutionState.promptText || ''
        return context ? `${context}\n\n${promptText}` : promptText
      })()

    return {
      finalPrompt,
      model: lastExecutionState.modelName || '',
      temperature: lastExecutionState.temperature || 0.7,
      max_tokens: lastExecutionState.max_tokens || 1000,
      top_p: lastExecutionState.top_p || 1.0,
      seed: lastExecutionState.seed || undefined
    }
  }, [selectedNode?.id, selectedNode?.data?.lastExecutionState, allNodes, allEdges, hasBeenExecuted])

  const debugInfo = selectedNode?.data?.debugInfo

  const requestPayloadSource = useMemo(() => {
    if (debugInfo?.requestPayload) return debugInfo.requestPayload
    if (hasBeenExecuted && actualPayload) return actualPayload
    return requestPayload
  }, [debugInfo?.requestPayload, hasBeenExecuted, actualPayload, requestPayload])

  const providerRequestPayload = debugInfo?.providerRequestPayload

  const requestPayloadString = useMemo(() => {
    if (!requestPayloadSource) return ''
    return typeof requestPayloadSource === 'string'
      ? requestPayloadSource
      : JSON.stringify(requestPayloadSource, null, 2)
  }, [requestPayloadSource])

  const providerRequestString = useMemo(() => {
    if (!providerRequestPayload) return ''
    return JSON.stringify(providerRequestPayload, null, 2)
  }, [providerRequestPayload])

  const structuredResponseString = useMemo(() => {
    if (structuredResponseRaw) return structuredResponseRaw
    return formatRawResponse(rawResponse)
  }, [structuredResponseRaw, rawResponse, formatRawResponse])

  const canHighlightRawResponse = useMemo(() => {
    if (!rawResponse) return false
    try {
      JSON.parse(rawResponse)
      return true
    } catch {
      return false
    }
  }, [rawResponse])

  const canHighlightStructuredResponse = useMemo(() => {
    if (!structuredResponseString) return false
    try {
      JSON.parse(structuredResponseString)
      return true
    } catch {
      return false
    }
  }, [structuredResponseString])

  const savedFinalPrompt = selectedNode?.data?.lastExecutionState?.finalPrompt
  const finalPromptText = useMemo(() => {
    if (savedFinalPrompt) {
      return savedFinalPrompt
    }

    if (requestPayloadSource && typeof requestPayloadSource === 'object' && !Array.isArray(requestPayloadSource)) {
      const value = (requestPayloadSource as Record<string, unknown>).finalPrompt
      if (typeof value === 'string') {
        return value
      }
    }

    if (requestPayload && typeof requestPayload === 'object') {
      const value = (requestPayload as Record<string, unknown>).finalPrompt
      if (typeof value === 'string') {
        return value
      }
    }

    return ''
  }, [savedFinalPrompt, requestPayloadSource, requestPayload])

  const renderCodeBlock = (
    content: string,
    options: { highlight?: boolean; emptyLabel?: string } = {}
  ) => {
    const { highlight = true, emptyLabel = "Data unavailable" } = options
    if (!content || content.trim() === '') {
      return (
        <div className="p-4 text-xs text-muted-foreground italic bg-muted/20 border border-dashed border-border/40 rounded-lg">
          {emptyLabel}
        </div>
      )
    }

    if (!highlight) {
      return (
        <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
          <div className="max-h-96 overflow-auto">
            <pre className="m-0 p-4 text-xs leading-6 text-slate-100 whitespace-pre-wrap break-words font-mono">
              {content}
            </pre>
          </div>
        </div>
      )
    }

    return (
      <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
        <div className="max-h-96 overflow-auto">
          <pre
            className="m-0 p-4 text-xs leading-6 text-slate-100 whitespace-pre-wrap break-words font-mono"
            style={{ tabSize: 2 }}
            dangerouslySetInnerHTML={{ __html: highlightJSON(content) }}
          />
        </div>
      </div>
    )
  }

  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return null
    try {
      return new Date(timestamp).toLocaleString()
    } catch {
      return null
    }
  }

  const isActualRequest = hasBeenExecuted && Boolean(debugInfo?.requestPayload)
  const hasProviderRequest = Boolean(providerRequestString && providerRequestString.trim() !== '')
  const requestTimestampLabel = formatTimestamp(debugInfo?.requestTimestamp)
  const responseTimestampLabel = formatTimestamp(debugInfo?.responseTimestamp)
  const latencyLabel = typeof debugInfo?.latencyMs === 'number'
    ? `${debugInfo.latencyMs.toLocaleString()} ms`
    : null
  const tokensUsed = usageSource !== "unreported" && typeof selectedNode?.data?.tokens === 'number'
    ? selectedNode.data.tokens.toLocaleString()
    : null
  const debugStatus: "pending" | "success" | "error" | undefined =
    debugInfo?.status
    ?? (selectedNode?.data?.status === "processing"
      ? "pending"
      : selectedNode?.data?.status === "error"
        ? "error"
        : selectedNode?.data?.status === "done" || selectedNode?.data?.status === "edited"
          ? "success"
          : undefined)
  const statusBadgeConfig = useMemo(() => {
    if (!debugStatus) return null
    const map: Record<"pending" | "success" | "error", { label: string; className: string }> = {
      pending: {
        label: "In Progress",
        className: "bg-amber-500/15 text-amber-400 border border-amber-500/30"
      },
      success: {
        label: "Success",
        className: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
      },
      error: {
        label: "Error",
        className: "bg-rose-500/15 text-rose-400 border border-rose-500/30"
      }
    }
    return map[debugStatus]
  }, [debugStatus])
  const hasRequestPayload = requestPayloadString.trim() !== ''
  const hasProviderRequestPayload = providerRequestString.trim() !== ''
  const hasStructuredResponse = structuredResponseString.trim() !== ''
  const hasRawResponse = rawResponse.trim() !== ''
  const hasFinalPrompt = finalPromptText.trim() !== ''
  const canPreview = Boolean(selectedNode && !["done", "processing"].includes(selectedNode.data?.status ?? "idle") && (isProviderId(selectedNode.type) || selectedNode.type === "summarizer"))
  const previewOperator = selectedNode ? nodeOperator(selectedNode) : null
  const previewProvider = previewOperator === "gemini" || previewOperator === "nanobanana" ? "gemini" : "openai"
  const tokenPreview = canPreview ? calculatedTokenPreview : null
  const isCalculatingPreview = canPreview && previewPending

  useEffect(() => {
    let active = true
    if (!canPreview || !selectedNode) return
    const timer = setTimeout(async () => {
      setIsCalculatingPreview(true)
      try {
        const preview = await calculateTokenPreview(selectedNode.id, allNodes, allEdges, selectedNode.data?.promptText || "")
        if (active) setTokenPreview(preview)
      } catch {
        if (active) setTokenPreview(null)
      } finally {
        if (active) setIsCalculatingPreview(false)
      }
    }, 100)
    return () => { active = false; clearTimeout(timer) }
  }, [selectedNode?.id, selectedNode?.type, selectedNode?.data?.promptText, allNodes, allEdges, hasBeenExecuted, canPreview])

  // Add styles for loading animation
  useEffect(() => {
    const styleId = 'upload-progress-animation'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `
        @keyframes upload-progress {
          0% {
            transform: translateX(-100%);
          }
          50% {
            transform: translateX(250%);
          }
          100% {
            transform: translateX(-100%);
          }
        }
      `
      document.head.appendChild(style)
    }
    return () => {
      const style = document.getElementById(styleId)
      if (style) {
        style.remove()
      }
    }
  }, [])

  // Function to copy to clipboard with feedback
  const copyToClipboard = useCallback(async (text: string, type: 'request' | 'providerRequest' | 'rawResponse' | 'structuredResponse' | 'finalPrompt') => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)

      // Show feedback
      const resetTimeout = 2000

      switch (type) {
        case 'request':
          setRequestCopied(true)
          setTimeout(() => setRequestCopied(false), resetTimeout)
          break
        case 'providerRequest':
          setProviderRequestCopied(true)
          setTimeout(() => setProviderRequestCopied(false), resetTimeout)
          break
        case 'rawResponse':
          setRawResponseCopied(true)
          setTimeout(() => setRawResponseCopied(false), resetTimeout)
          break
        case 'structuredResponse':
          setStructuredResponseCopied(true)
          setTimeout(() => setStructuredResponseCopied(false), resetTimeout)
          break
        case 'finalPrompt':
          setFinalPromptCopied(true)
          setTimeout(() => setFinalPromptCopied(false), resetTimeout)
          break
      }
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }, [])

  // Strip markdown formatting from text
  const stripMarkdown = useCallback((md: string): string => {
    return md
      .replace(/```[\s\S]*?```/g, '')        // code blocks first
      .replace(/#{1,6}\s?/g, '')             // headers
      .replace(/\*\*(.+?)\*\*/g, '$1')       // bold
      .replace(/\*(.+?)\*/g, '$1')           // italic
      .replace(/_(.+?)_/g, '$1')             // italic underscore
      .replace(/`(.+?)`/g, '$1')             // inline code
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')    // links
      .replace(/!\[.*?\]\(.+?\)/g, '')       // images
      .replace(/^[-*+]\s/gm, '')             // unordered lists
      .replace(/^\d+\.\s/gm, '')             // ordered lists
      .replace(/^>\s?/gm, '')                // blockquotes
      .replace(/\n{3,}/g, '\n\n')            // multiple newlines
      .trim()
  }, [])

  // Copy text content (plain text or markdown)
  const copyTextContent = useCallback(async (mode: 'text' | 'md') => {
    const content = localTextContent
    if (!content) return

    try {
      const textToCopy = mode === 'text' ? stripMarkdown(content) : content
      await navigator.clipboard.writeText(textToCopy)
      setTextContentCopied(mode)
      setTimeout(() => setTextContentCopied(null), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }, [localTextContent, stripMarkdown])

  // Copy response text (plain text or markdown)
  const copyResponseText = useCallback(async (mode: 'text' | 'md') => {
    const content = selectedNode?.data?.responseText || ''
    if (!content) return

    try {
      const textToCopy = mode === 'text' ? stripMarkdown(content) : content
      await navigator.clipboard.writeText(textToCopy)
      setResponseCopied(mode)
      setTimeout(() => setResponseCopied(null), 2000)
    } catch (err) {
      console.error('Failed to copy response: ', err)
    }
  }, [selectedNode?.data?.responseText, stripMarkdown])

  // Function to download image
  const downloadImage = useCallback(async (imageUrl: string, filename?: string) => {
    try {
      const response = await fetch(imageUrl)
      const blob = await response.blob()

      // Create temporary link for download
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename || `nanobanana-image-${Date.now()}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to download image: ', err)
    }
  }, [])

  // Functions for working with media in panel
  const handleShowFullMedia = useCallback(() => {
    if (!selectedNode) return
    const data: any = selectedNode.data || {}
    const mediaUrl = data?.filePath || data?.url
    if (!mediaUrl) return

    const isCSV = data?.mimeType === 'text/csv' || data?.filename?.toLowerCase?.().endsWith('.csv')
    const isVideo = data?.mimeType?.startsWith?.('video/')

    if (isCSV) {
      // For CSV open in new window as text
      const csvWindow = window.open('', '_blank')
      if (csvWindow) renderCsvPreview(csvWindow.document, data.filename, data.csvData)
    } else {
      // For images and video open in new window
      window.open(`/api/media/serve${mediaUrl}`, '_blank')
    }
  }, [selectedNode])

  const handleDownloadMedia = useCallback(() => {
    if (!selectedNode) return
    const data: any = selectedNode.data || {}
    const mediaUrl = data?.filePath || data?.url
    if (!mediaUrl) return

    const isCSV = data?.mimeType === 'text/csv' || data?.filename?.toLowerCase?.().endsWith('.csv')
    const isVideo = data?.mimeType?.startsWith?.('video/')

    if (isCSV) {
      // For CSV create blob and download
      const blob = new Blob([data.csvData || ''], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = data.filename || `file-${Date.now()}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } else if (isVideo) {
      // For video use download function
      downloadImage(`/api/media/serve${mediaUrl}`, data.filename || `video-${Date.now()}.${data.filename?.split('.').pop() || 'mp4'}`)
    } else {
      // For images use existing function
      downloadImage(`/api/media/serve${mediaUrl}`, data.filename || `image-${Date.now()}.png`)
    }
  }, [selectedNode, downloadImage])

  // Check that node supports details panel
  const isSupportedNode = selectedNode && (
    selectedNode.type === 'summarizer' ||
    selectedNode.type === 'gemini' ||
    selectedNode.type === 'custom' ||
    selectedNode.type === 'openai' ||
    selectedNode.type === 'openrouter' ||
    selectedNode.type === 'nanobanana' ||
    selectedNode.type === 'text'
  )

  // Get node color based on its type and status
  const getNodeBorderColor = () => {
    if (!selectedNode) return "#9ca3af"

    const nodeType = selectedNode.type as any
    const status = selectedNode.data?.status || "idle"

    // If status is IDLE, use light gray color
    if (status === "idle") {
      return "#9ca3af" // gray-400
    }

    // Base color based on node type
    const baseColor = getPrimaryColor(nodeType)

    // Modify color based on status
    switch (status) {
      case "processing":
        return "#f59e0b" // amber-500
      case "done":
        return "#10b981" // emerald-500
      case "error":
        return "#ef4444" // red-500
      case "edited":
        return "#2563eb" // blue-600
      default:
        return baseColor
    }
  }

  const borderColor = getNodeBorderColor()

  // Handle navigation to a specific node
  const handleNavigateToNode = useCallback((nodeId: string) => {
    if (onNavigateToNode) {
      onNavigateToNode(nodeId)
    }
  }, [onNavigateToNode])


  return (
    <>
      {/* Overlay for background dimming (only if not embedded) */}
      {!embedded && (
        <div
          className={`fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity duration-300 ${isOpen && selectedNode && isSupportedNode ? "opacity-100" : "opacity-0"
            }`}
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`${embedded ? 'h-full w-full' : 'fixed left-4 top-4 bottom-4'} bg-background border border-border shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${embedded ? '' : 'rounded-xl'} overflow-hidden ${embedded || (isOpen && selectedNode && isSupportedNode) ? "translate-x-0" : "-translate-x-full"
          }`}
        style={{
          ...(embedded ? {} : { width: panelWidth }),
          borderColor: embedded ? 'transparent' : borderColor,
          borderWidth: embedded ? "0px" : "3px",
          boxShadow: embedded ? 'none' : `0 0 0 2px ${borderColor}20, 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)`
        }}
      >
        {/* Header */}
        {selectedNode && (
          <div className="flex items-center justify-between p-4 border-b border-border rounded-t-xl">
            <div className="flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: borderColor }}
              />
              <div className="flex items-center gap-2">
                {getNodeTypeIcon((selectedNode.type ?? 'text') as string)}
                <h2 className="text-lg font-semibold text-foreground truncate">
                  {selectedNode.data?.title || selectedNode.type || "Node"}
                </h2>
              </div>
            </div>
            <Button
              onClick={onClose}
              variant="ghost"
              size="sm"
              className="w-8 h-8 p-0 rounded-lg hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Content */}
        {selectedNode && (
          <div className="flex-1 overflow-hidden rounded-b-xl">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'editor' | 'debug')} className="h-full flex flex-col">
              {/* Tab Navigation - don't show for text and media nodes */}
              {selectedNode?.type !== 'text' && selectedNode?.type !== 'media' && (
                <div className="px-6 py-4 border-b border-border">
                  <TabsList className="grid w-full grid-cols-2 gap-1 p-1 bg-muted/30 rounded-lg h-auto">
                    <TabsTrigger
                      value="editor"
                      className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md transition-all duration-200 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-border/50"
                    >
                      <Edit3 className="h-4 w-4" />
                      Node Editor
                    </TabsTrigger>
                    <TabsTrigger
                      value="debug"
                      className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md transition-all duration-200 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-border/50"
                    >
                      <Code className="h-4 w-4" />
                      Debug Inspector
                    </TabsTrigger>
                  </TabsList>
                </div>
              )}

              {/* Tab Content */}
              <div className="flex-1 overflow-hidden flex flex-col">
                <TabsContent value="editor" className="mt-0 flex-1 flex flex-col">
                  <div className="flex-1 overflow-y-auto p-4 max-h-[calc(100vh-200px)] thin-scrollbar">
                    <div className="space-y-4">
                      {/* Node Editor Content - duplicates all node functions */}
                      {selectedNode && (
                        <>
                          {/* Model Selection and Run Button for AI nodes */}
                          {(selectedNode.type === 'openai' || selectedNode.type === 'gemini' || selectedNode.type === 'openrouter') && (
                            <div className="flex gap-3">
                              <div className="flex-1">
                                {(() => {
                                  const provider = selectedNode.type === 'openai' ? settings.providers.openai :
                                    selectedNode.type === 'gemini' ? settings.providers.gemini :
                                      selectedNode.type === 'openrouter' ? settings.providers.openrouter : null
                                  const hasKey = provider?.hasKey
                                  const models = provider?.activeModels || []
                                  const disabledReason = !hasKey ? "API key not set" : (models.length === 0 ? "No active models configured" : null)
                                  const canSelect = !disabledReason
                                  return (
                                    <select
                                      className="w-full rounded-md border bg-background px-3 py-2 text-sm nodrag"
                                      value={selectedNode.data?.modelName || ""}
                                      onChange={(e) => onNodeUpdate?.(selectedNode.id, { modelName: e.target.value })}
                                      disabled={!canSelect}
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onTouchStart={(e) => e.stopPropagation()}
                                      data-nodrag
                                    >
                                      {!canSelect ? (
                                        <option value="" disabled>{disabledReason}</option>
                                      ) : (
                                        <>
                                          <option value="">Select model…</option>
                                          {models.map((m) => (
                                            <option key={m} value={m}>{m}</option>
                                          ))}
                                        </>
                                      )}
                                    </select>
                                  )
                                })()}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {selectedNode.data?.status === 'edited' && selectedNode.data?.lastExecutionState && onRestore && (
                                  <Button
                                    variant="outline"
                                    onClick={() => onRestore(selectedNode.id)}
                                    title="Restore to last execution state"
                                  >
                                    <RotateCcw className="h-4 w-4 mr-2" />
                                    Restore
                                  </Button>
                                )}
                                {onRun && (
                                  <Button onClick={() => onRun(selectedNode.id)}>
                                    Run Node
                                  </Button>
                                )}
                              </div>
                            </div>
                          )}

                          {selectedNode.type === 'custom' && (
                            <div className="space-y-2">
                              <ImageOutputSettings apiType={selectedCustomEndpoint?.apiType} mode={selectedNode.data?.mode} imageResponseFormat={selectedNode.data?.imageResponseFormat} onChange={patch => onNodeUpdate?.(selectedNode.id, patch)} />
                              {selectedNode.data?.generatedImage?.url && (
                                <div className="space-y-2">
                                  <Label>Generated Image</Label>
                                  <a href={`/api/media/serve${selectedNode.data.generatedImage.url}`} target="_blank" rel="noreferrer" aria-label="Open generated image">
                                    <img src={`/api/media/serve${selectedNode.data.generatedImage.url}`} alt="Generated image" className="w-full rounded-md border object-contain max-h-96" />
                                  </a>
                                  <div className="text-xs text-muted-foreground">{selectedNode.data.generatedImage.width}×{selectedNode.data.generatedImage.height}</div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Run Button for Nano Banana */}
                          {selectedNode.type === 'nanobanana' && onRun && (
                            <div className="flex justify-end">
                              <Button onClick={() => onRun(selectedNode.id)}>
                                Generate Image
                              </Button>
                            </div>
                          )}

                          {/* Provider, Model and Run Button for Summarizer */}
                          {selectedNode.type === 'summarizer' && (
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                  <Label>Provider</Label>
                                  <select
                                    value={selectedNode.data?.provider === "custom" ? `custom:${selectedNode.data?.endpointId || ""}` : selectedNode.data?.provider || ""}
                                    onChange={(event) => {
                                      if (event.target.value.startsWith("custom:")) {
                                        const endpoint = settings.customEndpoints.find(item => item.id === event.target.value.slice(7))
                                        onNodeUpdate?.(selectedNode.id, { provider: "custom", endpointId: endpoint?.id, modelName: endpoint?.models[0] || "" })
                                      } else onNodeUpdate?.(selectedNode.id, { provider: event.target.value })
                                    }}
                                    className="w-full h-10 px-3 py-2 text-sm border border-input bg-background rounded-md ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 nodrag"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onTouchStart={(e) => e.stopPropagation()}
                                    data-nodrag
                                  >
                                    <option value="">Select provider...</option>
                                    <option value="openai">OpenAI</option>
                                    <option value="gemini">Gemini</option>
                                    <option value="openrouter">OpenRouter</option>
                                    {settings.customEndpoints.filter(endpoint => endpoint.apiType !== "comfyui").map(endpoint => <option key={endpoint.id} value={`custom:${endpoint.id}`}>{endpoint.label}</option>)}
                                  </select>
                                </div>
                                <div className="space-y-2">
                                  <Label>Model</Label>
                                  {(() => {
                                    const currentProvider = selectedNode.data?.provider as CredentialProviderId
                                    const availableModels = selectedNode.data?.provider === "custom" ? settings.customEndpoints.find(endpoint => endpoint.id === selectedNode.data?.endpointId)?.models || [] : currentProvider ? settings.providers[currentProvider]?.activeModels || [] : []
                                    const hasModels = availableModels.length > 0

                                    return (
                                      <select
                                        value={selectedNode.data?.modelName || ""}
                                        onChange={(e) => onNodeUpdate?.(selectedNode.id, { modelName: e.target.value })}
                                        disabled={!hasModels}
                                        className="w-full h-10 px-3 py-2 text-sm border border-input bg-background rounded-md ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 nodrag"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        data-nodrag
                                      >
                                        {!hasModels ? (
                                          <option value="" disabled>No models available</option>
                                        ) : (
                                          <>
                                            <option value="">Select model...</option>
                                            {availableModels.map((model) => (
                                              <option key={model} value={model}>{model}</option>
                                            ))}
                                          </>
                                        )}
                                      </select>
                                    )
                                  })()}
                                </div>
                              </div>
                              {onRun && (
                                <div className="flex justify-end">
                                  <Button onClick={() => onRun(selectedNode.id)}>
                                    Run Node
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Brief information about summarizer settings */}
                          {selectedNode.type === 'summarizer' && (
                            <div className="bg-muted/30 rounded-md px-3 py-2 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Summary:</span>
                                <span className="font-medium capitalize">
                                  {selectedNode.data?.summaryLength || 'medium'} • {selectedNode.data?.summaryStyle || 'key-ideas'}
                                </span>
                              </div>
                              {selectedNode.data?.autoStrategy && (
                                <div className="flex items-center justify-between mt-1">
                                  <span className="text-muted-foreground">Strategy:</span>
                                  <span className="font-medium capitalize">
                                    {selectedNode.data.autoStrategy === 'single' ? 'Single Request' :
                                      selectedNode.data.autoStrategy === 'map-reduce' ? 'Map-Reduce' : 'Refine'}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Nano Banana Node Settings */}
                          {selectedNode.type === 'nanobanana' && (
                            <div className="space-y-4">
                              {/* Mode Display */}
                              <div className="space-y-2">
                                <Label>Generation Mode</Label>
                                <div className="flex items-center justify-center">
                                  <div className="px-3 py-2 text-xs rounded-md border bg-primary/10 text-primary border-primary/20">
                                    {selectedNode.data?.mode === 'text-to-image' && 'Text → Image'}
                                    {selectedNode.data?.mode === 'image-edit' && 'Edit Image'}
                                    {selectedNode.data?.mode === 'composition' && 'Compose'}
                                    {selectedNode.data?.mode === 'iterative' && 'Iterative'}
                                  </div>
                                </div>
                              </div>

                              {/* Generated Image Preview */}
                              {selectedNode.data?.generatedImage?.url && (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <Label>Generated Image</Label>
                                    <div className="flex items-center gap-2">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => downloadImage(
                                          selectedNode.data.generatedImage.url ? `/api/media/serve${selectedNode.data.generatedImage.url}` : '',
                                          `nanobanana-${selectedNode.data.generatedImage.width}x${selectedNode.data.generatedImage.height}-${Date.now()}.png`
                                        )}
                                      >
                                        Download
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => window.open(selectedNode.data.generatedImage.url ? `/api/media/serve${selectedNode.data.generatedImage.url}` : '', '_blank')}
                                      >
                                        View Full
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="relative">
                                    <img
                                      src={selectedNode.data.generatedImage.url ? `/api/media/serve${selectedNode.data.generatedImage.url}` : ''}
                                      alt="Generated image"
                                      className="w-full object-contain rounded-md border"
                                      style={{
                                        height: 'auto',
                                        aspectRatio: selectedNode.data.generatedImage ? `${selectedNode.data.generatedImage.width} / ${selectedNode.data.generatedImage.height}` : 'auto'
                                      }}
                                    />
                                    <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
                                      {selectedNode.data.generatedImage.width}×{selectedNode.data.generatedImage.height}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Iteration History */}
                              {selectedNode.data?.iterationHistory && selectedNode.data.iterationHistory.length > 0 && (
                                <div className="space-y-2">
                                  <Label>Iteration History</Label>
                                  <div className="space-y-2 max-h-48 overflow-y-auto thin-scrollbar">
                                    {selectedNode.data.iterationHistory.map((iteration: any, index: number) => (
                                      <div key={index} className="flex items-center gap-3 p-3 border rounded-md hover:bg-muted/50">
                                        <img
                                          src={iteration.url ? `/api/media/serve${iteration.url}` : ''}
                                          alt={`Iteration ${index + 1}`}
                                          className="w-12 h-12 object-cover rounded border"
                                          onClick={() => window.open(iteration.url ? `/api/media/serve${iteration.url}` : '', '_blank')}
                                          style={{ cursor: 'pointer' }}
                                        />
                                        <div className="flex-1 min-w-0">
                                          <div className="text-sm font-medium text-foreground truncate">
                                            Iteration {index + 1}
                                          </div>
                                          <div className="text-xs text-muted-foreground truncate">
                                            {iteration.prompt}
                                          </div>
                                          <div className="text-xs text-muted-foreground">
                                            {new Date(iteration.timestamp).toLocaleString()}
                                          </div>
                                        </div>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => downloadImage(
                                            iteration.url ? `/api/media/serve${iteration.url}` : '',
                                            `nanobanana-iteration-${index + 1}-${Date.now()}.png`
                                          )}
                                        >
                                          Download
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Prompt Text for Nano Banana */}
                          {selectedNode.type === 'nanobanana' && (
                            <div className="space-y-2">
                              <Label>Prompt</Label>
                              <textarea
                                className="w-full min-h-[100px] rounded-md border bg-background px-3 py-2 text-sm nodrag"
                                value={localPromptText}
                                onChange={(e) => onNodeUpdate?.(selectedNode.id, { promptText: e.target.value })}
                                placeholder="Describe the image you want to generate..."
                                onPointerDown={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                onWheel={(e) => e.stopPropagation()}
                                data-nodrag
                                style={{ pointerEvents: "auto" }}
                              />
                            </div>
                          )}

                          {/* Prompt Text - don't show for summarizer, media and text */}
                          {selectedNode.type !== 'summarizer' && selectedNode.type !== 'nanobanana' && selectedNode.type !== 'text' && selectedNode.type !== 'media' && (
                            <div className="space-y-2">
                              <textarea
                                className="w-full min-h-[100px] rounded-md border bg-background px-3 py-2 text-sm nodrag"
                                value={localPromptText}
                                onChange={(e) => onNodeUpdate?.(selectedNode.id, { promptText: e.target.value })}
                                placeholder="Enter prompt..."
                                onPointerDown={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                onWheel={(e) => e.stopPropagation()}
                                data-nodrag
                                style={{ pointerEvents: "auto" }}
                              />
                            </div>
                          )}

                          {/* Text Node Content */}
                          {selectedNode.type === 'text' && (
                            <div className="space-y-3">
                              {/* Token Information */}
                              {(() => {
                                const userTokenCount = estimateTokenCount(localTextContent)
                                const usedTokenCount = selectedNode.data?.hidden ? 0 : userTokenCount
                                return (
                                  <div className="text-xs text-muted-foreground flex items-center justify-between bg-muted/30 rounded-md px-3 py-2">
                                    <span>Tokens (estimate): {userTokenCount}</span>
                                    <span>In context: {usedTokenCount}</span>
                                  </div>
                                )
                              })()}

                              {/* Text Content with Markdown Toggle */}
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label>Text Content</Label>
                                  <div className="flex items-center gap-2">
                                    {/* Copy buttons */}
                                    <button
                                      className={`text-xs px-2 py-1 rounded border hover:bg-muted/50 ${textContentCopied === 'text' ? 'bg-green-500/20 border-green-500' : ''}`}
                                      onClick={() => copyTextContent('text')}
                                      disabled={!localTextContent}
                                    >
                                      {textContentCopied === 'text' ? 'Copied!' : 'Copy'}
                                    </button>
                                    <button
                                      className={`text-xs px-2 py-1 rounded border hover:bg-muted/50 ${textContentCopied === 'md' ? 'bg-green-500/20 border-green-500' : ''}`}
                                      onClick={() => copyTextContent('md')}
                                      disabled={!localTextContent}
                                    >
                                      {textContentCopied === 'md' ? 'Copied!' : 'Copy MD'}
                                    </button>
                                    {/* Toggle button - only show when there's content */}
                                    {localTextContent && (
                                      <button
                                        className="text-xs px-2 py-1 rounded border hover:bg-muted/50"
                                        onClick={() => setShowRawTextContent(!showRawTextContent)}
                                      >
                                        {showRawTextContent ? "Preview" : "Edit"}
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {/* Show textarea if editing mode OR if no content */}
                                {(showRawTextContent || !localTextContent) ? (
                                  <textarea
                                    className="w-full min-h-[400px] rounded-md border bg-background px-3 py-2 text-sm nodrag overflow-y-auto thin-scrollbar"
                                    value={localTextContent}
                                    onChange={(e) => onNodeUpdate?.(selectedNode.id, { textContent: e.target.value })}
                                    placeholder="Enter text..."
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onTouchStart={(e) => e.stopPropagation()}
                                    onWheel={(e) => e.stopPropagation()}
                                    data-nodrag
                                    style={{ pointerEvents: "auto" }}
                                  />
                                ) : (
                                  <div className="w-full min-h-[400px] rounded-md border bg-background p-3 text-sm overflow-y-auto thin-scrollbar">
                                    <MarkdownRenderer content={localTextContent} />
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Media Node Content */}
                          {selectedNode.type === 'media' && (
                            <div className="space-y-3">
                              {/* Linear upload progress */}
                              {isUploading && (
                                <div className="space-y-2">
                                  <div className="text-xs text-muted-foreground">Uploading... {uploadProgress}%</div>
                                  <Progress value={uploadProgress} />
                                </div>
                              )}

                              {/* Media Preview or Drag-n-Drop */}
                              {(() => {
                                const data: any = selectedNode.data || {}
                                const hasMedia = Boolean(data?.filePath || data?.url)
                                const isCSV = data?.mimeType === 'text/csv' || data?.filename?.toLowerCase?.().endsWith('.csv')
                                const isImage = data?.mimeType?.startsWith?.('image/')
                                const isVideo = data?.mimeType?.startsWith?.('video/')
                                if (!hasMedia && !isCSV) {
                                  return (
                                    <div className="space-y-2">
                                      <div
                                        className={`border-2 border-dashed rounded-lg p-8 min-h-[200px] flex flex-col items-center justify-center text-center transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}`}
                                        onDrop={handleDrop}
                                        onDragOver={handleDragOver}
                                        onDragLeave={handleDragLeave}
                                      >
                                        <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                                        <p className="text-sm text-muted-foreground mb-2">
                                          Drop image, video or CSV file here or click to browse
                                        </p>
                                      </div>
                                      <div
                                        className="w-full px-4 py-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md text-center cursor-pointer transition-colors"
                                        onClick={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          const tempInput = document.createElement('input')
                                          tempInput.type = 'file'
                                          tempInput.accept = 'image/*,video/*,.csv'
                                          tempInput.onchange = (event: any) => {
                                            const file = (event.target as HTMLInputElement).files?.[0]
                                            if (file) handleFileUpload(file)
                                          }
                                          tempInput.click()
                                        }}
                                      >
                                        {isUploading ? 'Uploading...' : 'Select File'}
                                      </div>
                                    </div>
                                  )
                                }
                                // Calculate tokens for display
                                const tokenCalculations = calculateTokensForBothProviders({
                                  text: data?.caption || '',
                                  images: isImage ? [{
                                    width: data?.width || 0,
                                    height: data?.height || 0,
                                    mimeType: data?.mimeType || ''
                                  }] : [],
                                  videoFrames: isVideo ? videoFrameList<VideoFrameDescriptor>(data?.videoFrames).map(frame => ({
                                    width: frame.width || 0,
                                    height: frame.height || 0,
                                    mimeType: frame.mimeType || 'image/jpeg'
                                  })) : undefined,
                                  videoDurationMs: isVideo ? data?.durationMs : undefined,
                                  csvData: isCSV ? data?.csvData : undefined,
                                  csvLimitEnabled: data?.csvLimitEnabled,
                                  csvMaxRows: data?.csvMaxRows
                                })

                                return (
                                  <div className="space-y-2">
                                    {/* Action buttons */}
                                    <div className="flex items-center gap-2">
                                      <button
                                        className="text-xs px-2 py-1 rounded border hover:bg-muted/50"
                                        onClick={handleShowFullMedia}
                                      >
                                        Show Full
                                      </button>
                                      <button
                                        className="text-xs px-2 py-1 rounded border hover:bg-muted/50"
                                        onClick={handleDownloadMedia}
                                      >
                                        Download
                                      </button>
                                      <button
                                        className="text-xs px-2 py-1 rounded border border-red-500 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 ml-auto"
                                        onClick={removeMedia}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                    {isImage ? (
                                      <div className="relative">
                                        <img
                                          src={data.filePath || data.url ? `/api/media/serve${data.filePath || data.url}` : ''}
                                          alt={data.caption || 'Uploaded image'}
                                          className="w-full rounded-lg"
                                        />
                                      </div>
                                    ) : isVideo ? (
                                      <div className="relative">
                                        <video
                                          controls
                                          poster={data.thumbnailPath ? `/api/media/serve${data.thumbnailPath}` : undefined}
                                          className="w-full rounded-lg"
                                          preload="metadata"
                                        >
                                          {(data.filePath || data.url) && (
                                            <source src={`/api/media/serve${data.filePath || data.url}`} type={data.mimeType} />
                                          )}
                                        </video>
                                      </div>
                                    ) : isCSV ? (
                                      <div className="relative bg-muted/20 rounded-lg p-3 border">
                                        <div className="flex items-center gap-2 mb-2">
                                          <FileText className="h-4 w-4 text-blue-500" />
                                          <span className="text-sm font-medium">CSV Data</span>
                                        </div>
                                        <div className="text-xs text-muted-foreground mb-2">
                                          {data.csvRows && data.csvColumns && (
                                            <div>Rows: {data.csvRows}, Columns: {data.csvColumns}</div>
                                          )}
                                        </div>
                                        <div className="space-y-2 mb-2">
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="checkbox"
                                              id={`csv-limit-${selectedNode.id}`}
                                              className="h-3.5 w-3.5 nodrag"
                                              checked={Boolean(data.csvLimitEnabled)}
                                              onChange={(e) => onNodeUpdate?.(selectedNode.id, { csvLimitEnabled: e.target.checked })}
                                              onPointerDown={(e) => e.stopPropagation()}
                                              onMouseDown={(e) => e.stopPropagation()}
                                              onTouchStart={(e) => e.stopPropagation()}
                                              data-nodrag
                                            />
                                            <Label htmlFor={`csv-limit-${selectedNode.id}`} className="text-xs">Limit rows</Label>
                                          </div>
                                          {data.csvLimitEnabled && (
                                            <div className="flex items-center gap-2">
                                              <Label htmlFor={`csv-max-${selectedNode.id}`} className="text-xs">Max rows:</Label>
                                              <Input
                                                id={`csv-max-${selectedNode.id}`}
                                                type="number"
                                                min="1"
                                                max={data.csvRows || 1000}
                                                value={data.csvMaxRows || 50}
                                                onChange={(e) => onNodeUpdate?.(selectedNode.id, { csvMaxRows: parseInt(e.target.value) || 50 })}
                                                className="h-6 w-16 text-xs nodrag"
                                                onPointerDown={(e) => e.stopPropagation()}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onTouchStart={(e) => e.stopPropagation()}
                                                data-nodrag
                                              />
                                            </div>
                                          )}
                                        </div>
                                        {data.csvData && (
                                          <div className="bg-background rounded p-2 text-xs font-mono max-h-32 overflow-y-auto thin-scrollbar">
                                            <pre className="whitespace-pre-wrap">
                                              {(() => {
                                                let displayData: string = data.csvData
                                                if (data.csvLimitEnabled && data.csvMaxRows && data.csvMaxRows > 0) {
                                                  const lines = displayData.split('\n')
                                                  if (lines.length > data.csvMaxRows) {
                                                    const truncatedLines = lines.slice(0, data.csvMaxRows)
                                                    displayData = truncatedLines.join('\n') + '\n... (showing ' + data.csvMaxRows + ' of ' + lines.length + ' rows)'
                                                  }
                                                }
                                                const preview = displayData.substring(0, 500)
                                                return preview + (displayData.length > 500 ? '\n... (preview truncated)' : '')
                                              })()}
                                            </pre>
                                          </div>
                                        )}
                                      </div>
                                    ) : null}

                                    {/* File info */}
                                    <div className="text-xs text-muted-foreground mt-2 space-y-1">
                                      {selectedNode.data?.filename && <div>File: {selectedNode.data.filename}</div>}
                                      {selectedNode.data?.fileSize && <div>Size: {(selectedNode.data.fileSize / 1024).toFixed(1)} KB</div>}
                                      {selectedNode.data?.width && selectedNode.data?.height && <div>Dimensions: {selectedNode.data.width}×{selectedNode.data.height}</div>}
                                      {isVideo && selectedNode.data?.durationMs && (
                                        <div>Duration: {(() => {
                                          const ms = selectedNode.data.durationMs
                                          const totalSeconds = Math.floor(ms / 1000)
                                          const hours = Math.floor(totalSeconds / 3600)
                                          const minutes = Math.floor((totalSeconds % 3600) / 60)
                                          const seconds = totalSeconds % 60
                                          if (hours > 0) {
                                            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
                                          }
                                          return `${minutes}:${seconds.toString().padStart(2, '0')}`
                                        })()}</div>
                                      )}
                                      {isVideo && typeof selectedNode.data?.frameCount === 'number' && (
                                        <div>Frames captured: {selectedNode.data.frameCount}</div>
                                      )}
                                      {isVideo && selectedNode.data?.frameRate && (
                                        <div>Source FPS: {selectedNode.data.frameRate.toFixed(2)}</div>
                                      )}
                                    </div>

                                    {/* Token Calculator */}
                                    <div className="mt-3 space-y-2">
                                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <Calculator className="h-3 w-3" />
                                        Token Calculator
                                      </div>

                                      <div className="bg-muted/50 rounded-md p-3 space-y-2 text-xs">
                                        {isCSV ? (
                                          /* For CSV show only one calculation */
                                          <div className="flex justify-between items-center">
                                            <span className="font-medium">Total tokens:</span>
                                            <span>{formatTokenCount(tokenCalculations.openai.totalTokens)}</span>
                                          </div>
                                        ) : (
                                          /* For images and video show both providers */
                                          <>
                                            <div className="flex justify-between items-center">
                                              <span className="font-medium text-muted-foreground">OpenAI:</span>
                                              <span>{formatTokenCount(tokenCalculations.openai.totalTokens)}</span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                              <span className="font-medium text-muted-foreground">Gemini:</span>
                                              <span>{formatTokenCount(tokenCalculations.gemini.totalTokens)}</span>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )
                              })()}

                              {/* Caption input */}
                              <div className="space-y-2">
                                <Label>File description</Label>
                                <Input
                                  value={localCaption}
                                  onChange={(e) => onNodeUpdate?.(selectedNode.id, { caption: e.target.value })}
                                  placeholder="File description (optional)..."
                                  className="nodrag"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onTouchStart={(e) => e.stopPropagation()}
                                  data-nodrag
                                />
                              </div>
                            </div>
                          )}

                          {/* Advanced Settings - don't show for text and media nodes */}
                          {selectedNode.type !== 'text' && selectedNode.type !== 'media' && (
                            <div className="border rounded-md">
                              <button
                                className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/50"
                                onClick={() => setShowSettings(!showSettings)}
                              >
                                <span>Advanced Settings</span>
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  className={`${showSettings ? 'rotate-180' : ''} transition-transform`}
                                >
                                  <path d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                              {showSettings && (
                                <div className="p-3 space-y-3">
                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-2">
                                      <Label>Temperature</Label>
                                      <Input
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        max="2"
                                        value={selectedNode.data?.temperature ?? ""}
                                        onChange={(e) => onNodeUpdate?.(selectedNode.id, { temperature: parseFloat(e.target.value || "0") })}
                                        className="nodrag"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        data-nodrag
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label>Max tokens</Label>
                                      <Input
                                        type="number"
                                        min="1"
                                        value={selectedNode.data?.max_tokens ?? ""}
                                        onChange={(e) => onNodeUpdate?.(selectedNode.id, { max_tokens: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
                                        className="nodrag"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        data-nodrag
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label>Top P</Label>
                                      <Input
                                        type="number"
                                        step="0.1"
                                        min="0"
                                        max="1"
                                        value={selectedNode.data?.top_p ?? ""}
                                        onChange={(e) => onNodeUpdate?.(selectedNode.id, { top_p: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
                                        className="nodrag"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        data-nodrag
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label>Seed</Label>
                                      <Input
                                        type="number"
                                        min="0"
                                        value={selectedNode.data?.seed ?? ""}
                                        onChange={(e) => onNodeUpdate?.(selectedNode.id, { seed: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
                                        className="nodrag"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        data-nodrag
                                      />
                                    </div>
                                  </div>
                                  {/* Gemini-specific: Google Search toggle */}
                                  {selectedNode.type === 'gemini' && (
                                    <div className="flex items-center gap-2 pt-2 border-t">
                                      <input
                                        id={`use-tools-panel-${selectedNode.id}`}
                                        type="checkbox"
                                        className="h-3.5 w-3.5"
                                        checked={selectedNode.data?.useTools !== false}
                                        onChange={(e) => onNodeUpdate?.(selectedNode.id, { useTools: e.target.checked })}
                                      />
                                      <Label htmlFor={`use-tools-panel-${selectedNode.id}`} className="text-xs cursor-pointer">
                                        Use Google Search (grounding)
                                      </Label>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Smart Summarizer Settings */}
                              {selectedNode.type === 'summarizer' && (
                                <div className="space-y-3">
                                  <div className="text-sm font-medium text-muted-foreground">Smart Summarizer Settings</div>
                                  <div className="space-y-3">
                                    <div className="space-y-2">
                                      <Label>Summary Length</Label>
                                      <select
                                        value={selectedNode.data?.summaryLength || "medium"}
                                        onChange={(e) => onNodeUpdate?.(selectedNode.id, { summaryLength: e.target.value as SummaryLength })}
                                        className="w-full h-10 px-3 py-2 text-sm border border-input bg-background rounded-md ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 nodrag"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        data-nodrag
                                      >
                                        <option value="brief">Brief (1-2 sentences)</option>
                                        <option value="medium">Medium (key paragraphs)</option>
                                        <option value="detailed">Detailed (comprehensive)</option>
                                      </select>
                                    </div>
                                    <div className="space-y-2">
                                      <Label>Summary Style</Label>
                                      <select
                                        value={selectedNode.data?.summaryStyle || "key-ideas"}
                                        onChange={(e) => onNodeUpdate?.(selectedNode.id, { summaryStyle: e.target.value as SummaryStyle })}
                                        className="w-full h-10 px-3 py-2 text-sm border border-input bg-background rounded-md ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 nodrag"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        data-nodrag
                                      >
                                        <option value="key-ideas">Key Ideas (main concepts)</option>
                                        <option value="preserve-details">Preserve Details (facts & data)</option>
                                        <option value="structured">Structured (lists & points)</option>
                                      </select>
                                    </div>
                                  </div>

                                  {/* Show automatically selected strategy */}
                                  {selectedNode.data?.autoStrategy && (
                                    <div className="bg-muted/30 rounded-md px-3 py-2 text-xs">
                                      <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">Auto Strategy:</span>
                                        <span className="font-medium capitalize">
                                          {selectedNode.data.autoStrategy === 'single' ? 'Single Request' :
                                            selectedNode.data.autoStrategy === 'map-reduce' ? 'Map-Reduce' : 'Refine'}
                                        </span>
                                      </div>
                                      {selectedContextCapacity && (
                                        <div className="flex items-center justify-between mt-1">
                                          <span className="text-muted-foreground">Context Window:</span>
                                          <span className="font-medium">{selectedContextCapacity.toLocaleString()}</span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Response - don't show for text and media nodes */}
                          {selectedNode.type !== 'text' && selectedNode.type !== 'media' && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label>Response</Label>
                                <div className="flex items-center gap-2">
                                  {/* Copy buttons */}
                                  {selectedNode.data?.responseText && (
                                    <>
                                      <button
                                        className={`text-xs px-2 py-1 rounded border hover:bg-muted/50 ${responseCopied === 'text' ? 'bg-green-500/20 border-green-500' : ''}`}
                                        onClick={() => copyResponseText('text')}
                                      >
                                        {responseCopied === 'text' ? 'Copied!' : 'Copy'}
                                      </button>
                                      <button
                                        className={`text-xs px-2 py-1 rounded border hover:bg-muted/50 ${responseCopied === 'md' ? 'bg-green-500/20 border-green-500' : ''}`}
                                        onClick={() => copyResponseText('md')}
                                      >
                                        {responseCopied === 'md' ? 'Copied!' : 'Copy MD'}
                                      </button>
                                    </>
                                  )}
                                  {!editingResponse && selectedNode.data?.responseText && (
                                    <button
                                      className="text-xs px-2 py-1 rounded border hover:bg-muted/50"
                                      onClick={() => setShowRawText(!showRawText)}
                                    >
                                      {showRawText ? "Preview" : "Raw"}
                                    </button>
                                  )}
                                  {!editingResponse ? (
                                    <button
                                      className="text-xs px-2 py-1 rounded border hover:bg-muted/50"
                                      onClick={() => {
                                        setLocalResponseText(selectedNode.data?.responseText || '')
                                        setEditingResponse(true)
                                      }}
                                    >
                                      Edit
                                    </button>
                                  ) : (
                                    <div className="flex items-center gap-2">
                                      <button
                                        className="text-xs px-2 py-1 rounded border bg-primary text-primary-foreground hover:bg-primary/90"
                                        onClick={() => {
                                          onNodeUpdate?.(selectedNode.id, { responseText: localResponseText })
                                          setEditingResponse(false)
                                        }}
                                      >
                                        Save
                                      </button>
                                      <button
                                        className="text-xs px-2 py-1 rounded border hover:bg-muted/50"
                                        onClick={() => {
                                          setLocalResponseText(selectedNode.data?.responseText || '')
                                          setEditingResponse(false)
                                        }}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                              {!editingResponse ? (
                                selectedNode.data?.isStreaming && selectedNode.data?.streamingText ? (
                                  <div className="rounded-md border bg-background p-3 text-sm">
                                    <MarkdownRenderer content={selectedNode.data.streamingText} />
                                    <span className="animate-pulse inline-block ml-0.5">|</span>
                                  </div>
                                ) : selectedNode.data?.responseText ? (
                                  <div className={`rounded-md border bg-background p-3 text-sm ${hasBeenExecuted ? "" : "max-h-96 overflow-y-auto thin-scrollbar"}`}>
                                    {showRawText ? (
                                      <div className="whitespace-pre-wrap break-words">
                                        {selectedNode.data.responseText}
                                      </div>
                                    ) : (
                                      <MarkdownRenderer content={selectedNode.data.responseText} />
                                    )}
                                  </div>
                                ) : selectedNode.data?.status === 'processing' ? (
                                  <NodeThoughts executionStartTime={selectedNode.data?.executionStartTime} />
                                ) : (
                                  <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground italic">
                                    Response will appear here after execution...
                                  </div>
                                )
                              ) : (
                                <textarea
                                  className="w-full min-h-[300px] rounded-md border bg-background px-3 py-2 text-sm nodrag overflow-y-auto thin-scrollbar"
                                  value={localResponseText}
                                  onChange={(e) => setLocalResponseText(e.target.value)}
                                  placeholder="Edit or paste response..."
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onTouchStart={(e) => e.stopPropagation()}
                                  onWheel={(e) => e.stopPropagation()}
                                  data-nodrag
                                  style={{ pointerEvents: "auto" }}
                                />
                              )}
                            </div>
                          )}

                          {/* Real Token Usage Section - show after Response for executed nodes */}
                          {hasBeenExecuted && (usageSource || selectedNode.data?.tokens !== undefined || selectedNode.data?.tokenBreakdown) && (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <Label className="text-sm font-medium">Token Usage</Label>
                                <span className="text-xs rounded border px-2 py-1" aria-label="Usage source">{usageLabel}</span>
                              </div>
                              <div className="space-y-4">
                                {/* Token usage breakdown in 4 columns */}
                                {usageSource === "unreported" ? <p className="text-xs text-muted-foreground">Token usage was not reported by the provider.</p> : usageSource !== "provider" && usageSource !== "estimated" ? <p className="text-xs text-muted-foreground">Recorded total: {tokensUsed ?? "—"}. Usage source unavailable.</p> : <TokenUsageSection
                                  inputTokens={selectedNode.data.tokenBreakdown?.inputTokens}
                                  outputTokens={selectedNode.data.tokenBreakdown?.outputTokens}
                                  reasoningTokens={selectedNode.data.tokenBreakdown?.reasoningTokens}
                                  cachedTokens={selectedNode.data.tokenBreakdown?.cachedTokens}
                                  audioTokens={selectedNode.data.tokenBreakdown?.audioTokens}
                                  videoTokens={selectedNode.data.tokenBreakdown?.videoTokens}
                                  imageTokens={selectedNode.data.tokenBreakdown?.imageTokens}
                                  totalTokens={selectedNode.data.tokens}
                                  provider={selectedNode.type === "summarizer" ? selectedNode.data.provider : selectedNode.type}
                                  isExact={usageSource === "provider"}
                                  className="grid-cols-4"
                                />}
                                {usageSource === "estimated" && selectedNode.data.tokens === 0 && <p className="text-xs text-muted-foreground">Estimated tokens: 0</p>}
                              </div>
                            </div>
                          )}

                          {canPreview && <TokenPreviewSection key={selectedNode.id} preview={tokenPreview} pending={isCalculatingPreview} provider={previewProvider} />}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Hidden from context checkbox - pinned at bottom of Editor section */}
                  <div className="sticky bottom-0 flex-shrink-0 border-t border-border bg-background p-4 z-10">
                    <div className="flex items-center gap-2">
                      <input
                        id={`hidden-${selectedNode.id}`}
                        type="checkbox"
                        className="h-3.5 w-3.5 nodrag"
                        checked={Boolean(selectedNode.data?.hidden)}
                        onChange={(e) => onNodeUpdate?.(selectedNode.id, { hidden: e.target.checked })}
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        data-nodrag
                      />
                      <Label htmlFor={`hidden-${selectedNode.id}`} className="text-xs">Hidden from context</Label>
                    </div>
                  </div>
                </TabsContent>
                {selectedNode?.type !== 'media' && (
                  <TabsContent value="debug" className="mt-0 flex-1 flex flex-col">
                    <div className="flex-1 overflow-y-auto p-4 max-h-[calc(100vh-200px)] thin-scrollbar">
                      <div className="space-y-6">
                        {/* Request & Response Sections */}
                        <div className="space-y-6">
                          <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              {statusBadgeConfig ? (
                                <span className={`px-3 py-1 text-xs font-semibold rounded-full ${statusBadgeConfig.className}`}>
                                  {statusBadgeConfig.label}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {selectedNode?.data?.status === "idle" ? "Node has not been executed yet" : "Status unavailable"}
                                </span>
                              )}
                              {hasBeenExecuted && <span className="text-xs rounded border px-2 py-1" aria-label="Usage source">{usageLabel}</span>}
                            </div>
                            <div className="grid grid-cols-3 gap-x-4 gap-y-3 text-xs">
                              <div className="flex flex-col">
                                <p className="text-muted-foreground uppercase tracking-wide mb-1.5 h-4 leading-4">Provider</p>
                                <p className="text-sm font-semibold text-foreground min-h-[20px] leading-5">
                                  {debugInfo?.provider ? debugInfo.provider.toUpperCase() : (selectedNode?.type || "—")}
                                </p>
                              </div>
                              <div className="flex flex-col">
                                <p className="text-muted-foreground uppercase tracking-wide mb-1.5 h-4 leading-4">Model</p>
                                <p className="text-sm font-medium text-foreground break-words min-h-[20px] leading-5">
                                  {debugInfo?.model || selectedNode?.data?.modelName || "—"}
                                </p>
                              </div>
                              <div className="flex flex-col">
                                <p className="text-muted-foreground uppercase tracking-wide mb-1.5 h-4 leading-4">Tokens</p>
                                <p className="text-sm font-medium text-foreground min-h-[20px] leading-5">
                                  {tokensUsed || (debugStatus === "pending" ? "Calculating…" : "—")}
                                </p>
                              </div>
                              <div className="flex flex-col">
                                <p className="text-muted-foreground uppercase tracking-wide mb-1.5 h-4 leading-4">Latency</p>
                                <p className="text-sm font-medium text-foreground min-h-[20px] leading-5">
                                  {latencyLabel || (debugStatus === "pending" ? "Pending…" : "—")}
                                </p>
                              </div>
                              <div className="flex flex-col">
                                <p className="text-muted-foreground uppercase tracking-wide mb-1.5 h-4 leading-4">Request Sent</p>
                                <p className="text-sm font-medium text-foreground min-h-[20px] leading-5">
                                  {requestTimestampLabel || (debugStatus === "pending" ? "Preparing request…" : "—")}
                                </p>
                              </div>
                              <div className="flex flex-col">
                                <p className="text-muted-foreground uppercase tracking-wide mb-1.5 h-4 leading-4">Response Received</p>
                                <p className="text-sm font-medium text-foreground min-h-[20px] leading-5">
                                  {responseTimestampLabel || (debugStatus === "pending" ? "Waiting for response…" : "—")}
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <button
                                onClick={() => setIsRequestCollapsed(!isRequestCollapsed)}
                                className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
                              >
                                {isRequestCollapsed ? (
                                  <ChevronRight className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                                {isActualRequest ? "Actual Application Request" : "Request Preview"}
                              </button>
                              <Button
                                onClick={() => copyToClipboard(requestPayloadString, 'request')}
                                variant={requestCopied ? "default" : "outline"}
                                size="sm"
                                disabled={!hasRequestPayload}
                                className={`h-8 transition-all duration-200 ${requestCopied
                                    ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500/60"
                                    : "hover:bg-muted/60"
                                  }`}
                              >
                                {requestCopied ? (
                                  <>
                                    <Check className="h-3 w-3 mr-1" />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3 mr-1" />
                                    Copy
                                  </>
                                )}
                              </Button>
                            </div>
                            {!isRequestCollapsed && (
                              <>
                                {renderCodeBlock(requestPayloadString, {
                                  highlight: true,
                                  emptyLabel: hasRequestPayload ? "Data unavailable" : "Prompt not assembled yet"
                                })}
                                <div className="text-xs text-muted-foreground italic">
                                  {isActualRequest
                                    ? "This is the payload sent from Canvas to the server during the last execution."
                                    : "This is a preview of the request. Run the node to see the actual JSON."}
                                </div>
                              </>
                            )}
                          </div>

                          {hasProviderRequestPayload && (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <button
                                  onClick={() => setIsProviderRequestCollapsed(!isProviderRequestCollapsed)}
                                  className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
                                >
                                  {isProviderRequestCollapsed ? (
                                    <ChevronRight className="h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4" />
                                  )}
                                  Raw Provider Request
                                </button>
                                <Button
                                  onClick={() => copyToClipboard(providerRequestString, 'providerRequest')}
                                  variant={providerRequestCopied ? "default" : "outline"}
                                  size="sm"
                                  disabled={!hasProviderRequestPayload}
                                  className={`h-8 transition-all duration-200 ${providerRequestCopied
                                      ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500/60"
                                      : "hover:bg-muted/60"
                                    }`}
                                >
                                  {providerRequestCopied ? (
                                    <>
                                      <Check className="h-3 w-3 mr-1" />
                                      Copied
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3 mr-1" />
                                      Copy
                                    </>
                                  )}
                                </Button>
                              </div>
                              {!isProviderRequestCollapsed && (
                                <>
                                  {renderCodeBlock(providerRequestString, {
                                    highlight: true,
                                    emptyLabel: "Provider JSON unavailable"
                                  })}
                                  <div className="text-xs text-muted-foreground italic">
                                    Request sent from backend to the selected LLM provider (without API key).
                                  </div>
                                </>
                              )}
                            </div>
                          )}

                          {hasFinalPrompt && (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <button
                                  onClick={() => setIsFinalPromptCollapsed(!isFinalPromptCollapsed)}
                                  className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
                                >
                                  {isFinalPromptCollapsed ? (
                                    <ChevronRight className="h-4 w-4" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4" />
                                  )}
                                  Final Prompt
                                </button>
                                <Button
                                  onClick={() => copyToClipboard(finalPromptText, 'finalPrompt')}
                                  variant={finalPromptCopied ? "default" : "outline"}
                                  size="sm"
                                  className={`h-8 transition-all duration-200 ${finalPromptCopied
                                      ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500/60"
                                      : "hover:bg-muted/60"
                                    }`}
                                >
                                  {finalPromptCopied ? (
                                    <>
                                      <Check className="h-3 w-3 mr-1" />
                                      Copied
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3 mr-1" />
                                      Copy
                                    </>
                                  )}
                                </Button>
                              </div>
                              {!isFinalPromptCollapsed && (
                                <>
                                  <div className="bg-background border border-border rounded-xl overflow-hidden">
                                    <pre className="m-0 p-4 text-sm leading-6 text-foreground whitespace-pre-wrap break-words font-mono">
                                      {finalPromptText}
                                    </pre>
                                  </div>
                                  <div className="text-xs text-muted-foreground italic">
                                    {isActualRequest
                                      ? "Prompt after assembling context and user text."
                                      : "Prompt formed from current data — run the node to send it."}
                                  </div>
                                </>
                              )}
                            </div>
                          )}

                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <button
                                onClick={() => setIsRawResponseCollapsed(!isRawResponseCollapsed)}
                                className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
                              >
                                {isRawResponseCollapsed ? (
                                  <ChevronRight className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                                Raw Provider Response
                              </button>
                              <Button
                                onClick={() => copyToClipboard(rawResponse, 'rawResponse')}
                                variant={rawResponseCopied ? "default" : "outline"}
                                size="sm"
                                disabled={!hasRawResponse}
                                className={`h-8 transition-all duration-200 ${rawResponseCopied
                                    ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500/60"
                                    : "hover:bg-muted/60"
                                  }`}
                              >
                                {rawResponseCopied ? (
                                  <>
                                    <Check className="h-3 w-3 mr-1" />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3 mr-1" />
                                    Copy
                                  </>
                                )}
                              </Button>
                            </div>
                            {!isRawResponseCollapsed && (
                              <>
                                {renderCodeBlock(rawResponse, {
                                  highlight: canHighlightRawResponse,
                                  emptyLabel: "Response not received yet"
                                })}
                                <div className="text-xs text-muted-foreground italic">
                                  Full response returned by the LLM. For streaming models, contains a sequence of JSON chunks.
                                </div>
                              </>
                            )}
                          </div>

                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <button
                                onClick={() => setIsStructuredResponseCollapsed(!isStructuredResponseCollapsed)}
                                className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
                              >
                                {isStructuredResponseCollapsed ? (
                                  <ChevronRight className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                                Structured Response
                              </button>
                              <Button
                                onClick={() => copyToClipboard(structuredResponseString, 'structuredResponse')}
                                variant={structuredResponseCopied ? "default" : "outline"}
                                size="sm"
                                disabled={!hasStructuredResponse}
                                className={`h-8 transition-all duration-200 ${structuredResponseCopied
                                    ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500/60"
                                    : "hover:bg-muted/60"
                                  }`}
                              >
                                {structuredResponseCopied ? (
                                  <>
                                    <Check className="h-3 w-3 mr-1" />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3 mr-1" />
                                    Copy
                                  </>
                                )}
                              </Button>
                            </div>
                            {!isStructuredResponseCollapsed && (
                              <>
                                {renderCodeBlock(structuredResponseString, {
                                  highlight: canHighlightStructuredResponse,
                                  emptyLabel: "Structured response unavailable"
                                })}
                                <div className="text-xs text-muted-foreground italic">
                                  Organized response with execution metadata, parameters, and tokens.
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Node Info Section */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <button
                              onClick={() => setIsNodeInfoCollapsed(!isNodeInfoCollapsed)}
                              className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
                            >
                              {isNodeInfoCollapsed ? (
                                <ChevronRight className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                              Node Information
                            </button>
                          </div>
                          {!isNodeInfoCollapsed && (
                            <div className="bg-muted/20 rounded-lg p-4">
                              {/* Two-column compact layout */}
                              <div className="grid grid-cols-2 gap-6">

                                {/* Left Column */}
                                <div className="space-y-3">
                                  {/* Basic Info */}
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Type</span>
                                      <span className="text-sm font-medium text-foreground capitalize">
                                        {selectedNode.type || "Unknown"}
                                      </span>
                                    </div>

                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</span>
                                      <div className="flex items-center gap-2">
                                        <div
                                          className="w-2 h-2 rounded-full"
                                          style={{ backgroundColor: borderColor }}
                                        />
                                        <span className="text-sm font-medium text-foreground capitalize">
                                          {selectedNode.data?.status || "idle"}
                                        </span>
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Position</span>
                                      <span className="text-sm font-medium text-foreground">
                                        {Math.round(selectedNode.position.x)}, {Math.round(selectedNode.position.y)}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Node Properties */}
                                  <div className="space-y-2 pt-2 border-t border-border/50">
                                    {selectedNode.data?.title && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Title</span>
                                        <span className="text-sm font-medium text-foreground truncate max-w-[120px]">
                                          {selectedNode.data.title}
                                        </span>
                                      </div>
                                    )}

                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Collapsed</span>
                                      <span className="text-sm font-medium text-foreground">
                                        {selectedNode.data?.isCollapsed ? "Yes" : "No"}
                                      </span>
                                    </div>

                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Hidden</span>
                                      <span className="text-sm font-medium text-foreground">
                                        {selectedNode.data?.hidden ? "Yes" : "No"}
                                      </span>
                                    </div>

                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Streaming</span>
                                      <span className="text-sm font-medium text-foreground">
                                        {selectedNode.data?.isStreaming ? "Yes" : "No"}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Model Configuration */}
                                  {selectedNode.data?.modelName && (
                                    <div className="space-y-2 pt-2 border-t border-border/50">
                                      {selectedNode.data?.provider && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Provider</span>
                                          <span className="text-sm font-medium text-foreground capitalize">
                                            {selectedNode.data.provider}
                                          </span>
                                        </div>
                                      )}

                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Model</span>
                                        <span className="text-sm font-medium text-foreground truncate max-w-[120px]">
                                          {selectedNode.data.modelName}
                                        </span>
                                      </div>

                                      {selectedNode.data?.temperature !== undefined && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Temperature</span>
                                          <span className="text-sm font-medium text-foreground">
                                            {selectedNode.data.temperature}
                                          </span>
                                        </div>
                                      )}

                                      {selectedNode.data?.max_tokens !== undefined && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Max Tokens</span>
                                          <span className="text-sm font-medium text-foreground">
                                            {selectedNode.data.max_tokens?.toLocaleString()}
                                          </span>
                                        </div>
                                      )}

                                      {selectedNode.data?.top_p !== undefined && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Top P</span>
                                          <span className="text-sm font-medium text-foreground">
                                            {selectedNode.data.top_p}
                                          </span>
                                        </div>
                                      )}

                                      {selectedNode.data?.seed !== undefined && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Seed</span>
                                          <span className="text-sm font-medium text-foreground">
                                            {selectedNode.data.seed}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Right Column */}
                                <div className="space-y-3">
                                  {/* Execution Metrics */}
                                  {(selectedNode.data?.tokens !== undefined || selectedNode.data?.tokenBreakdown || selectedNode.data?.executionStartTime) && (
                                    <div className="space-y-2">
                                      {selectedNode.data?.tokens !== undefined && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Tokens</span>
                                          <span className="text-sm font-bold text-foreground">
                                            {tokensUsed ?? "—"}
                                          </span>
                                        </div>
                                      )}

                                      {selectedNode.data?.tokenBreakdown && (
                                        <>
                                          {selectedNode.data.tokenBreakdown.inputTokens !== undefined && (
                                            <div className="flex items-center justify-between">
                                              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Input</span>
                                              <span className="text-sm font-medium text-foreground">
                                                {selectedNode.data.tokenBreakdown.inputTokens.toLocaleString()}
                                              </span>
                                            </div>
                                          )}
                                          {selectedNode.data.tokenBreakdown.outputTokens !== undefined && (
                                            <div className="flex items-center justify-between">
                                              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Output</span>
                                              <span className="text-sm font-medium text-foreground">
                                                {selectedNode.data.tokenBreakdown.outputTokens.toLocaleString()}
                                              </span>
                                            </div>
                                          )}
                                          {selectedNode.data.tokenBreakdown.reasoningTokens && (
                                            <div className="flex items-center justify-between">
                                              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reasoning</span>
                                              <span className="text-sm font-medium text-foreground">
                                                {selectedNode.data.tokenBreakdown.reasoningTokens.toLocaleString()}
                                              </span>
                                            </div>
                                          )}
                                        </>
                                      )}

                                      {selectedNode.data?.executionStartTime && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Executed</span>
                                          <span className="text-sm font-medium text-foreground">
                                            {new Date(selectedNode.data.executionStartTime).toLocaleTimeString()}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Summarizer Configuration */}
                                  {selectedNode.type === 'summarizer' && (
                                    <div className="space-y-2 pt-2 border-t border-border/50">
                                      {selectedNode.data?.summaryLength && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Length</span>
                                          <span className="text-sm font-medium text-foreground capitalize">
                                            {selectedNode.data.summaryLength}
                                          </span>
                                        </div>
                                      )}

                                      {selectedNode.data?.summaryStyle && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Style</span>
                                          <span className="text-sm font-medium text-foreground capitalize">
                                            {selectedNode.data.summaryStyle.replace('-', ' ')}
                                          </span>
                                        </div>
                                      )}

                                      {selectedNode.data?.autoStrategy && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Strategy</span>
                                          <span className="text-sm font-medium text-foreground capitalize">
                                            {selectedNode.data.autoStrategy === 'single' ? 'Single' :
                                              selectedNode.data.autoStrategy === 'map-reduce' ? 'Map-Reduce' :
                                                selectedNode.data.autoStrategy}
                                          </span>
                                        </div>
                                      )}

                                      {selectedContextCapacity && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Context</span>
                                          <span className="text-sm font-medium text-foreground">
                                            {selectedContextCapacity.toLocaleString()}
                                          </span>
                                        </div>
                                      )}

                                      {selectedNode.data?.textLength && (
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Text Length</span>
                                          <span className="text-sm font-medium text-foreground">
                                            {selectedNode.data.textLength.toLocaleString()}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Grounding Sources */}
                                  {selectedNode.data?.groundingMetadata?.chunks && selectedNode.data.groundingMetadata.chunks.length > 0 && (
                                    <div className="space-y-2 pt-2 border-t border-border/50">
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sources</span>
                                        <span className="text-sm font-bold text-foreground">
                                          {selectedNode.data.groundingMetadata.chunks.length}
                                        </span>
                                      </div>

                                      <div className="space-y-1 max-h-24 overflow-y-auto thin-scrollbar">
                                        {selectedNode.data.groundingMetadata.chunks.slice(0, 3).map((chunk: any, index: number) => (
                                          <div key={index} className="text-xs bg-muted/50 p-2 rounded border">
                                            {chunk.web?.title && (
                                              <div className="font-medium text-foreground truncate">{chunk.web.title}</div>
                                            )}
                                            {chunk.web?.uri && (
                                              <div className="text-muted-foreground text-xs truncate">{chunk.web.uri}</div>
                                            )}
                                          </div>
                                        ))}
                                        {selectedNode.data.groundingMetadata.chunks.length > 3 && (
                                          <div className="text-xs text-muted-foreground text-center">
                                            +{selectedNode.data.groundingMetadata.chunks.length - 3} more
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Node ID - Compact at bottom */}
                              <div className="pt-3 mt-3 border-t border-border/50">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Node ID</span>
                                  <span className="text-xs font-mono text-foreground bg-muted/50 px-2 py-1 rounded">
                                    {selectedNode.id}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                )}
              </div>
            </Tabs>
          </div>
        )}

        {/* Resize Handle (only if not embedded) */}
        {!embedded && (
          <div
            className="absolute right-0 top-0 bottom-0 w-1 bg-gray-300 cursor-ew-resize hover:bg-gray-400 transition-colors"
            style={{
              background:
                'repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)',
            }}
            onMouseDown={handleMouseDown}
          />
        )}
      </div>

    </>
  )
}
