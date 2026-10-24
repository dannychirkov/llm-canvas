"use client"

import React, { memo, useState } from "react"
import { Position, type NodeProps } from "reactflow"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getHeaderStyleForType } from "./colors"
import { useSettings } from "@/components/providers/SettingsProvider"
import { Image as ImageIcon, Info, Calculator, Loader2, RotateCcw } from "lucide-react"
import CustomHandle from "./CustomHandle"
import NodeThoughts from "@/components/NodeThoughts"
import MarkdownRenderer from "@/components/MarkdownRenderer"
import { useNodeTokens } from "@/hooks/useNodeTokens"
import { Node, Edge, NanoBananaData } from "@/types"
import { getNanoAutoMode } from "@/lib/nanoContextMode"

export { getNanoAutoMode } from "@/lib/nanoContextMode"

interface NodeComponentProps<T = Record<string, unknown>> extends NodeProps<T> {
  onNodeUpdate: (id: string, patch: Record<string, unknown>) => void
  onRun?: (id: string) => void
  onNodeSelect?: (id: string) => void
  allNodes?: Node[]
  allEdges?: Edge[]
  onRestore?: (id: string) => void
}

function NanoBananaNode(props: NodeComponentProps<NanoBananaData>) {
  const { id, data, isConnectable, allNodes = [], allEdges = [] } = props
  const isCollapsed = Boolean(data?.isCollapsed)
  const [editingResponse, setEditingResponse] = useState(false)
  const settings = useSettings()
  
  // Use the optimized token calculation hook
  const { tokenPreview, isCalculatingTokens } = useNodeTokens({
    nodeId: id,
    promptText: data?.promptText || '',
    allNodes,
    allEdges,
    nodeType: 'nanobanana'
  })

  const currentMode = getNanoAutoMode(id, allNodes, allEdges)
  
  const status = data?.status || "idle"
  const statusClass = data?.status === 'processing'
    ? 'node-status-processing'
    : data?.status === 'done'
    ? 'node-status-done'
    : data?.status === 'error'
    ? 'node-status-error'
    : data?.status === 'edited'
    ? 'node-status-edited'
    : ''

  const hasGeneratedImage = data?.generatedImage?.url
  const hasIterationHistory = data?.iterationHistory && data.iterationHistory.length > 0

  // Force node size update after image generation
  React.useEffect(() => {
    if (hasGeneratedImage) {
      // Small delay for correct size update
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'))
      }, 100)
    }
  }, [hasGeneratedImage])

  // Automatic mode update when connections change
  React.useEffect(() => {
    if (data?.mode !== currentMode) {
      props.onNodeUpdate(id, { mode: currentMode })
    }
  }, [currentMode, id, props, data?.mode])


  // Calculate minimum node height based on content
  const getNodeHeight = () => {
    if (!hasGeneratedImage || !data?.generatedImage?.width || !data?.generatedImage?.height) {
      return { className: 'min-h-[200px]', style: {} } // Minimum height for empty node
    }
    
    // For node with image use minimum height, but allow expansion
    return { 
      className: 'min-h-[300px]', 
      style: {} 
    }
  }

  const nodeHeight = getNodeHeight()
  
  return (
    <div 
      className={`rounded-xl overflow-hidden border bg-clip-padding bg-card text-card-foreground shadow-lg w-[340px] max-w-[340px] flex flex-col ${nodeHeight.className} ${data?.hidden ? 'opacity-50' : ''} ${statusClass}`}
      style={nodeHeight.style}
    >
      <CustomHandle type="target" position={Position.Top} isConnectable={isConnectable} />
      <div className="p-3 border-b rounded-t-xl flex items-center justify-between bg-clip-padding" style={{...getHeaderStyleForType('nanobanana'), borderTopLeftRadius: 12, borderTopRightRadius: 12}}>
        <div className="text-sm font-medium flex items-center gap-2">
          <ImageIcon className="h-3 w-3" />
          {data?.title || "Nano Banana"}
          <button
            className="h-4 w-4 inline-flex items-center justify-center rounded hover:bg-black/5 transition-colors"
            title="Open prompt guide"
            onClick={() => {
              window.open('https://ai.google.dev/gemini-api/docs/image-generation#prompt-guide', '_blank')
            }}
          >
            <Info className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {data?.status === 'edited' && data?.lastExecutionState && props.onRestore && (
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => props.onRestore?.(id)}
              title="Restore to last execution state"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button size="sm" onClick={async () => {
            props.onRun?.(id)
            // Update settings in background, not blocking UI
            settings.refresh().catch(console.error)
          }}>
            Generate
          </Button>
          <button
            className={`h-6 w-6 inline-flex items-center justify-center rounded transition border ${isCollapsed ? 'node-collapse-btn-collapsed' : 'hover:bg-black/5 border-transparent'}`}
            title={isCollapsed ? "Expand" : "Collapse"}
            onClick={() => {
              const newCollapsed = !isCollapsed
              props.onNodeUpdate(id, { isCollapsed: newCollapsed })
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`${isCollapsed ? 'rotate-180' : ''} transition-transform`}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
      </div>
      <div className="overflow-hidden">
        {/* Collapsed content */}
        <div
          className={`transition-all duration-[250ms] ${
            isCollapsed
              ? 'max-h-[2000px] opacity-100 ease-[cubic-bezier(0.16,1,0.3,1)]'
              : 'max-h-0 opacity-0 ease-[cubic-bezier(0.7,0,0.84,0)] overflow-hidden'
          }`}
        >
          <div className="p-3 space-y-2">
            <div className="text-xs text-muted-foreground">Mode</div>
            <div className="rounded-md border bg-background p-2 text-xs">
              {currentMode}
            </div>
            <div className="text-xs text-muted-foreground">Prompt</div>
            <div className="relative rounded-md border bg-background p-2 text-xs whitespace-pre-wrap break-words max-h-12 overflow-hidden">
              {data?.promptText || ""}
              <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-background to-transparent pointer-events-none" />
            </div>
            {hasGeneratedImage && (
              <>
                <div className="text-xs text-muted-foreground">Generated Image</div>
                <div className="rounded-md border bg-background p-2 text-xs">
                  Image generated ({data.generatedImage?.width}×{data.generatedImage?.height})
                </div>
              </>
            )}
            {data?.status === 'processing' && !data?.responseText && !data?.isStreaming ? (
              <>
                <div className="text-xs text-muted-foreground">AI Response</div>
                <NodeThoughts executionStartTime={data?.executionStartTime} />
              </>
            ) : (data?.responseText || data?.isStreaming) && (
              <>
                <div className="text-xs text-muted-foreground">AI Response</div>
                <div className="relative rounded-md border bg-background p-2 text-xs max-h-16 overflow-hidden">
                  {data?.isStreaming ? (
                    <>
                      <MarkdownRenderer content={data.streamingText || ""} />
                      <span className="animate-pulse inline-block ml-0.5">|</span>
                    </>
                  ) : (
                    <MarkdownRenderer content={data.responseText || ""} />
                  )}
                  <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-background to-transparent pointer-events-none" />
                </div>
              </>
            )}
          </div>
        </div>
        {/* Expanded content */}
        <div
          className={`transition-all duration-[250ms] ${
            !isCollapsed
              ? 'max-h-[2000px] opacity-100 ease-[cubic-bezier(0.16,1,0.3,1)]'
              : 'max-h-0 opacity-0 ease-[cubic-bezier(0.7,0,0.84,0)] overflow-hidden'
          }`}
        >
          <div className={`p-3 space-y-3 relative flex-1 flex flex-col`}>
          {/* Mode Indicator */}
          <div className="space-y-2">
            <div className="flex items-center justify-center">
              <div className="px-3 py-2 text-xs rounded-md border bg-primary/10 text-primary border-primary/20">
                {currentMode === 'text-to-image' && 'Text → Image'}
                {currentMode === 'image-edit' && 'Edit Image'}
                {currentMode === 'composition' && 'Compose'}
                {currentMode === 'iterative' && 'Iterative'}
              </div>
            </div>
          </div>

          {/* Token Display - Est tokens or Tokens used depending on status */}
          {(tokenPreview || isCalculatingTokens) && data?.status !== 'done' && (
            <div className="bg-muted/30 rounded-md px-3 py-1.5 text-xs flex items-center justify-between group relative">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Calculator className="h-3 w-3" />
                <span>Est tokens:</span>
              </div>
              <div className="flex items-center">
                {isCalculatingTokens ? (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                ) : (
                  <span className="text-green-600 dark:text-green-400 font-medium">
                    {tokenPreview?.totalTokens.gemini.toLocaleString()}
                  </span>
                )}
              </div>
              
              {/* Tooltip - shown only when tokenPreview exists */}
              {tokenPreview && (
                <div className="absolute bottom-full left-0 right-0 mb-2 p-3 bg-popover border rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
                  <div className="text-xs">
                    <div className="font-medium text-popover-foreground mb-2">This Request</div>
                    <div className="space-y-1">
                      <div className="flex justify-between"><span>Context:</span><span>{tokenPreview.contextTokens.gemini.totalTokens.toLocaleString()}</span></div>
                      <div className="flex justify-between"><span>Prompt:</span><span>{tokenPreview.promptTokens.gemini.toLocaleString()}</span></div>
                      <div className="flex justify-between font-medium border-t pt-1 mt-1"><span>Total:</span><span>{tokenPreview.totalTokens.gemini.toLocaleString()}</span></div>
                    </div>
                    {tokenPreview.executedTokens?.gemini > 0 && (
                      <div className="mt-2 pt-2 border-t border-dashed text-muted-foreground">
                        <div className="flex justify-between"><span>Chain history:</span><span>{tokenPreview.executedTokens.gemini.toLocaleString()}</span></div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Real Token Usage Display - shown when status is DONE */}
          {typeof data?.tokens === 'number' && data?.status === 'done' && (
            <div className="bg-green-50 dark:bg-green-950/30 rounded-md px-3 py-1.5 text-xs flex items-center justify-between">
              <div className="flex items-center gap-1 text-green-700 dark:text-green-300">
                <Calculator className="h-3 w-3" />
                <span>{data.usageSource === "estimated" ? "Estimated tokens:" : data.usageSource === "unreported" ? "Usage not reported:" : "Recorded tokens:"}</span>
              </div>
              <div className="flex items-center">
                <span className="text-green-600 dark:text-green-400 font-medium">
                  {data.usageSource === "unreported" ? "—" : data.tokens.toLocaleString()}
                </span>
              </div>
            </div>
          )}

          {/* Prompt Input */}
          <div className="space-y-2">
            <textarea
              className="w-full min-h-[100px] rounded-md border bg-background px-3 py-2 text-sm nodrag"
              value={data?.promptText || ""}
              onChange={(e) => props.onNodeUpdate(id, { promptText: e.target.value })}
              placeholder="Describe the image you want to generate..."
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              data-nodrag
              style={{ pointerEvents: "auto" }}
            />
          </div>

          {/* AI Response */}
          {(data?.responseText || data?.isStreaming) && (
            <div className="space-y-2">
              <div className="relative rounded-md border bg-background p-3 text-sm max-h-[512px] overflow-hidden">
                <div className="text-xs text-muted-foreground mb-2">AI Response:</div>
                {data?.isStreaming ? (
                  <>
                    <MarkdownRenderer content={data.streamingText || ""} />
                    <span className="animate-pulse inline-block ml-0.5">|</span>
                  </>
                ) : (
                  <MarkdownRenderer content={data.responseText || ""} />
                )}
                <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent pointer-events-none" />
              </div>
            </div>
          )}

          {/* Generated Image Preview */}
          {hasGeneratedImage && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Generated Image</Label>
                <button
                  className="text-xs px-2 py-1 rounded border hover:bg-muted/50"
                  onClick={() => {
                    window.open(`/api/media/serve${data.generatedImage?.url}`, '_blank')
                  }}
                >
                  View Full
                </button>
              </div>
              <div className="relative">
                <img
                  src={data.generatedImage?.url ? `/api/media/serve${data.generatedImage.url}` : ''}
                  alt="Generated image"
                  className="w-full object-contain rounded-md border"
                  style={{
                    height: 'auto',
                    aspectRatio: data.generatedImage ? `${data.generatedImage.width} / ${data.generatedImage.height}` : 'auto'
                  }}
                />
                <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
                  {data.generatedImage?.width}×{data.generatedImage?.height}
                </div>
              </div>
            </div>
          )}

          {/* Iteration History */}
          {hasIterationHistory && (
            <div className="space-y-2">
              <Label>Iteration History</Label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {data.iterationHistory?.map((iteration, index) => (
                  <div key={index} className="flex items-center gap-2 p-2 border rounded-md">
                    <img
                      src={`/api/media/serve${iteration.url}`}
                      alt={`Iteration ${index + 1}`}
                      className="w-8 h-8 object-cover rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-muted-foreground truncate">
                        {iteration.prompt}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(iteration.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Response/Error Display */}
          {(data?.status === 'error' || data?.status === 'processing') && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                {!editingResponse && data?.status === 'error' && (
                  <button
                    className="text-xs px-2 py-1 rounded border hover:bg-muted/50"
                    onClick={() => setEditingResponse(true)}
                  >
                    Edit
                  </button>
                )}
              </div>
              {data?.status === 'error' ? (
                <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                  {data.responseText || "Generation failed"}
                </div>
              ) : data?.status === 'processing' ? (
                <NodeThoughts executionStartTime={data?.executionStartTime} />
              ) : null}
            </div>
          )}
          </div>
        </div>
      </div>
      <div className="border-t rounded-b-xl bg-muted/50 px-3 py-1 flex items-center justify-between gap-2 bg-clip-padding" style={{borderBottomLeftRadius: 12, borderBottomRightRadius: 12}}>
        <div className="flex items-center gap-2">
          <input
            id={`hidden-${id}`}
            type="checkbox"
            className="h-3.5 w-3.5 nodrag"
            checked={Boolean((data as any)?.hidden)}
            onChange={(e) => props.onNodeUpdate(id, { hidden: e.target.checked })}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            data-nodrag
          />
          <Label htmlFor={`hidden-${id}`} className="text-xs">Hidden from context</Label>
        </div>
        <div className="text-xs text-muted-foreground uppercase">{status}</div>
      </div>
      <CustomHandle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  )
}

export default memo(NanoBananaNode)
