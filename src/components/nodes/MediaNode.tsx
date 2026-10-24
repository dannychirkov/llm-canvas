"use client"

import React, { memo, useState, useRef } from "react"
import { Position, type NodeProps } from "reactflow"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getHeaderStyleForType } from "./colors"
import { Upload, X, FileText, Calculator, Loader2, AlertCircle } from "lucide-react"
import CustomHandle from "./CustomHandle"
import { calculateTokensForBothProviders, formatTokenCount } from "@/lib/tokenCalculator"
import { MediaData } from "@/types"
import { MAX_IMAGE_OR_CSV_SIZE, MAX_VIDEO_SIZE } from "@/lib/storageConstants"
import { videoFrameList } from "@/lib/videoFrameMetadata"

interface NodeComponentProps<T = any> extends NodeProps<T> {
  onNodeUpdate: (id: string, patch: Record<string, any>) => void
  onNodeSelect?: (id: string) => void
}


function MediaNode(props: NodeComponentProps<MediaData>) {
  const { id, data, isConnectable, onNodeUpdate } = props
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  

  const handleFileUpload = async (file: File) => {
    // Support images, videos, and CSV files
    const isCsvFile = file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')
    const isImageFile = file.type.startsWith('image/')
    const isVideoFile = file.type.startsWith('video/')

    if (!isImageFile && !isVideoFile && !isCsvFile) {
      onNodeUpdate(id, {
        status: 'error',
        error: 'Please select an image, video, or CSV file'
      })
      return
    }

    // Validate file size based on file type
    // Images and CSV files: 10MB limit, Videos: 50MB limit
    const maxSize = isVideoFile ? MAX_VIDEO_SIZE : MAX_IMAGE_OR_CSV_SIZE
    const maxSizeMB = maxSize / (1024 * 1024)
    
    if (file.size > maxSize) {
      onNodeUpdate(id, { 
        status: 'error',
        error: `File size exceeds ${maxSizeMB}MB limit for ${isVideoFile ? 'videos' : 'images and CSV files'}` 
      })
      return
    }

    // Show loading state
    onNodeUpdate(id, { 
      status: 'processing',
      loadingMessage: 'Uploading file...' 
    })

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('canvasId', data.canvasId || 'temp')

      const response = await fetch('/api/media/upload', {
        method: 'POST',
        body: formData,
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('Upload failed:', errorText)
        throw new Error(`Upload failed: ${errorText}`)
      }

      const result = await response.json()
      
      // Determine media type based on server mimeType
      const isVideo = result.mimeType?.startsWith('video/') ?? false
      const isImage = result.mimeType?.startsWith('image/') ?? false
      const isCsv = (result.mimeType?.toLowerCase().includes('csv') || result.mimeType === 'text/csv' || result.mimeType === 'application/csv') ?? false

      // Update media node data after successful upload
      // IMPORTANT: This block must be synchronized with NodeDetailsPanel.tsx
      onNodeUpdate(id, {
        // Clear loading state and error
        status: 'done',
        loadingMessage: undefined,
        error: undefined,
        
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
        videoMimeType: isVideo ? result.mimeType : undefined,
        videoFileSize: isVideo ? result.fileSize : undefined,
        
        // Media type flags
        isVideo: isVideo,
        isImage: isImage,
        isCsv: isCsv
        
        // Note: geminiFileUri and geminiUploadedAt are updated separately
        // via synchronization in NodeDetailsPanel or after upload to Gemini
      })
      
      // Force component update for height recalculation
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'))
      }, 100)
    } catch (error) {
      console.error('Upload failed:', error)
      onNodeUpdate(id, { 
        status: 'error',
        error: `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        loadingMessage: undefined
      })
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileUpload(file)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    
    const file = e.dataTransfer.files[0]
    if (file) {
      handleFileUpload(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => {
    setDragOver(false)
  }

  const removeImage = () => {
    onNodeUpdate(id, {
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
      isCollapsed: false,
      geminiFileUri: undefined,
      geminiUploadedAt: undefined
    })
  }

  const hasMediaFile = data?.filePath || data?.url
  const isCSV = data?.mimeType === 'text/csv' || data?.filename?.toLowerCase().endsWith('.csv')
  const isImage = data?.mimeType?.startsWith('image/')
  const isVideo = data?.mimeType?.startsWith('video/')
  const isLoading = data?.status === 'processing'
  const hasError = data?.status === 'error'
  const errorMessage = data?.error
  const loadingMessage = data?.loadingMessage || 'Uploading file...'

  const videoThumbnailUrl = data?.thumbnailPath ? `/api/media/serve${data.thumbnailPath}` : undefined
  const videoSourceUrl = data?.filePath ? `/api/media/serve${data.filePath}` : undefined

  const formatDuration = (ms?: number) => {
    if (!ms || ms <= 0) return null
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // Calculate tokens for both providers
  const calculateTokens = () => {
    const mediaData = {
      text: data?.caption || '',
      images: isImage ? [{
        width: data?.width || 0,
        height: data?.height || 0,
        mimeType: data?.mimeType || ''
      }] : [],
      videoFrames: isVideo ? videoFrameList(data?.videoFrames).map(frame => ({
        width: frame.width,
        height: frame.height,
        mimeType: frame.mimeType
      })) : undefined,
      videoDurationMs: isVideo ? data?.durationMs : undefined,
      csvData: isCSV ? data?.csvData : undefined,
      csvLimitEnabled: data?.csvLimitEnabled,
      csvMaxRows: data?.csvMaxRows
    }
    
    return calculateTokensForBothProviders(mediaData)
  }

  const tokenCalculations = calculateTokens()
  
  // Debug information (only in development mode)
  if (process.env.NODE_ENV === 'development') {
    // Token debug info available in development

  }
  
  // Calculate node height based on image proportions
  const getNodeHeight = () => {
    // In collapsed mode, use auto height
    if (data?.isCollapsed && hasMediaFile) {
      return ''
    }

    if (!hasMediaFile || !data?.width || !data?.height) {
      return 'min-h-[200px]' // Minimum height for empty node
    }

    const aspectRatio = data.width / data.height
    const baseWidth = 320 // Node width
    const maxHeight = 400 // Maximum height
    const minHeight = 200 // Minimum height

    let calculatedHeight = baseWidth / aspectRatio

    // Limit height
    if (calculatedHeight > maxHeight) {
      calculatedHeight = maxHeight
    } else if (calculatedHeight < minHeight) {
      calculatedHeight = minHeight
    }

    return `h-[${Math.round(calculatedHeight)}px]`
  }

  return (
    <div className={`rounded-xl overflow-hidden border-2 border-gray-600/50 dark:border-white/50 bg-card text-card-foreground shadow-lg w-[320px] max-w-[320px] ${getNodeHeight()} ${data?.hidden ? 'opacity-50' : ''}`}>
      <div className="p-3 border-b rounded-t-xl flex items-center justify-between" style={getHeaderStyleForType('media')}>
        <div className="text-sm font-medium flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14,2 14,8 20,8" />
            <circle cx="10" cy="12" r="2" />
            <path d="m16 13-3 3-2-2" />
          </svg>
          {data?.title || "Media"}
        </div>
        {hasMediaFile && (
          <button
            className={`h-6 w-6 inline-flex items-center justify-center rounded transition border ${data?.isCollapsed ? 'node-collapse-btn-collapsed' : 'hover:bg-black/5 border-transparent'}`}
            title={data?.isCollapsed ? "Expand" : "Collapse"}
            onClick={() => onNodeUpdate(id, { isCollapsed: !data?.isCollapsed })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${data?.isCollapsed ? 'rotate-180' : ''} transition-transform`}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        )}
      </div>

      <div className={`${data?.isCollapsed && hasMediaFile ? 'p-2' : 'p-3'} space-y-3 flex-1 flex flex-col`}>
        {/* Loading indicator */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center p-6 space-y-3 border-2 border-dashed border-primary/50 rounded-lg bg-primary/5">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <p className="text-sm font-medium text-primary">{loadingMessage}</p>
          </div>
        )}

        {/* Error display */}
        {hasError && errorMessage && (
          <div className="flex flex-col items-start p-4 space-y-2 border-2 border-red-200 dark:border-red-800 rounded-lg bg-red-50 dark:bg-red-950">
            <div className="flex items-center gap-2 text-red-800 dark:text-red-200">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm font-medium">Upload Error</span>
            </div>
            <p className="text-xs text-red-700 dark:text-red-300">{errorMessage}</p>
          </div>
        )}

        {/* File upload */}
        {!hasMediaFile && !isCSV && !isLoading && !hasError ? (
          <div className="space-y-2">
            <div
              className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-2">
                Drop image, video, or CSV file here or click to browse
              </p>
            </div>
            <div
              className="w-full px-4 py-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground rounded-md text-center cursor-pointer transition-colors"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                // Create temporary input element
                const tempInput = document.createElement('input')
                tempInput.type = 'file'
                tempInput.accept = 'image/*,video/*,.csv'
                tempInput.onchange = (event) => {
                  const file = (event.target as HTMLInputElement).files?.[0]
                  if (file) {
                    handleFileUpload(file)
                  }
                }
                tempInput.click()
              }}
            >
              Select File
            </div>
          </div>
        ) : hasMediaFile && !isLoading && !hasError ? (
          /* File preview */
          <div className="space-y-2 flex-1 flex flex-col">
            {isImage ? (
              /* Image preview */
              <div className="relative flex-1">
                <img
                  src={data.filePath || data.url ? `/api/media/serve${data.filePath || data.url}` : ''}
                  alt={data.caption || 'Uploaded image'}
                  className={`w-full object-cover rounded-lg transition-all duration-200 ${data?.isCollapsed ? 'h-auto max-h-[200px]' : 'h-full'}`}
                />
                <Button
                  variant="destructive"
                  size="sm"
                  className="absolute top-2 right-2 h-6 w-6 p-0"
                  onClick={removeImage}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : isVideo ? (
              <div className="relative">
                {data?.isCollapsed ? (
                  /* Collapsed: show thumbnail only */
                  <img
                    src={videoThumbnailUrl || ''}
                    alt={data.caption || 'Video thumbnail'}
                    className="w-full h-auto max-h-[200px] object-cover rounded-lg"
                  />
                ) : (
                  /* Expanded: show video player */
                  <video
                    controls
                    poster={videoThumbnailUrl}
                    className="w-full rounded-lg"
                    preload="metadata"
                  >
                    {videoSourceUrl && (
                      <source src={videoSourceUrl} type={data.mimeType} />
                    )}
                  </video>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  className="absolute top-2 right-2 h-6 w-6 p-0"
                  onClick={removeImage}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : isCSV ? (
              /* CSV file preview */
              <div className="relative flex-1 bg-muted/20 rounded-lg p-3 border">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{data.filename}</div>
                    <div className="text-xs text-muted-foreground">
                      {data.csvRows} rows, {data.csvColumns} columns
                    </div>
                  </div>
                </div>

                {/* CSV settings and preview - hidden when collapsed */}
                {!data?.isCollapsed && (
                  <>
                    <div className="space-y-2 mt-3 mb-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`csv-limit-${id}`}
                          className="h-3.5 w-3.5 nodrag"
                          checked={Boolean(data.csvLimitEnabled)}
                          onChange={(e) => onNodeUpdate(id, { csvLimitEnabled: e.target.checked })}
                          onPointerDown={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          data-nodrag
                        />
                        <Label htmlFor={`csv-limit-${id}`} className="text-xs">Limit rows</Label>
                      </div>

                      {data.csvLimitEnabled && (
                        <div className="flex items-center gap-2">
                          <Label htmlFor={`csv-max-${id}`} className="text-xs">Max rows:</Label>
                          <Input
                            id={`csv-max-${id}`}
                            type="number"
                            min="1"
                            max={data.csvRows || 1000}
                            value={data.csvMaxRows || 50}
                            onChange={(e) => onNodeUpdate(id, { csvMaxRows: parseInt(e.target.value) || 50 })}
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
                      <div className="bg-background rounded p-2 text-xs font-mono max-h-32 overflow-y-auto">
                        <pre className="whitespace-pre-wrap">
                          {(() => {
                            let displayData = data.csvData

                            // Apply limit for display
                            if (data.csvLimitEnabled && data.csvMaxRows && data.csvMaxRows > 0) {
                              const lines = displayData.split('\n')
                              if (lines.length > data.csvMaxRows) {
                                const truncatedLines = lines.slice(0, data.csvMaxRows)
                                displayData = truncatedLines.join('\n') + '\n... (showing ' + data.csvMaxRows + ' of ' + lines.length + ' rows)'
                              }
                            }

                            // Limit for preview
                            const preview = displayData.substring(0, 500)
                            return preview + (displayData.length > 500 ? '\n... (preview truncated)' : '')
                          })()}
                        </pre>
                      </div>
                    )}
                  </>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  className="absolute top-2 right-2 h-6 w-6 p-0"
                  onClick={removeImage}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : null}

            {/* File information - hidden when collapsed */}
            {!data?.isCollapsed && (
              <div className="text-xs text-muted-foreground mt-2 space-y-1">
                {data.filename && <div>File: {data.filename}</div>}
                {data.fileSize && <div>Size: {(data.fileSize / 1024).toFixed(1)} KB</div>}
                {data.width && data.height && <div>Dimensions: {data.width}×{data.height}</div>}
                {isVideo && data.durationMs && (
                  <div>Duration: {formatDuration(data.durationMs)}</div>
                )}
                {isVideo && typeof data.frameCount === 'number' && (
                  <div>Frames captured: {data.frameCount}</div>
                )}
                {isVideo && data.frameRate && (
                  <div>Source FPS: {data.frameRate.toFixed(2)}</div>
                )}
              </div>
            )}

            {/* Token Calculator - hidden when collapsed */}
            {!data?.isCollapsed && (
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
                    /* For images show both providers */
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
            )}
          </div>
        ) : null}

        {/* Image description - hidden when collapsed */}
        {!data?.isCollapsed && (
          <div className="space-y-2">
            <Input
              value={data?.caption || ""}
              onChange={(e) => onNodeUpdate(id, { caption: e.target.value })}
              placeholder="File description (optional)..."
              className="nodrag"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              data-nodrag
            />
          </div>
        )}
      </div>

      {!data?.isCollapsed && (
      <div className="border-t rounded-b-xl bg-muted/50 px-3 py-1 flex items-center gap-2" style={{borderBottomLeftRadius: 12, borderBottomRightRadius: 12}}>
        <input
          id={`hidden-${id}`}
          type="checkbox"
          className="h-3.5 w-3.5 nodrag"
          checked={Boolean((data as any)?.hidden)}
          onChange={(e) => onNodeUpdate(id, { hidden: e.target.checked })}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          data-nodrag
        />
        <Label htmlFor={`hidden-${id}`} className="text-xs">Hidden from context</Label>
      </div>
      )}

      <CustomHandle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  )
}

export default memo(MediaNode)


