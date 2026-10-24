"use client"

import React, { memo, useState } from "react"
import { Position, type NodeProps } from "reactflow"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getHeaderStyleForType } from "./colors"
import { useSettings } from "@/components/providers/SettingsProvider"
import CustomHandle from "./CustomHandle"
import MarkdownRenderer from "@/components/MarkdownRenderer"
import NodeThoughts from "@/components/NodeThoughts"
import { useNodeTokens } from "@/hooks/useNodeTokens"
import { Calculator, Loader2, RotateCcw } from "lucide-react"
import { GroundingMetadata, Node, Edge, OpenRouterData } from "@/types"
import { OpenRouter } from "@lobehub/icons"

interface NodeComponentProps<T = Record<string, unknown>> extends NodeProps<T> {
  onNodeUpdate: (id: string, patch: Record<string, unknown>) => void
  onRun?: (id: string) => void
  onRestore?: (id: string) => void
  onNodeSelect?: (id: string) => void
  allNodes?: Node[]
  allEdges?: Edge[]
}


function OpenRouterNode(props: NodeComponentProps<OpenRouterData>) {
  const { id, data, isConnectable, allNodes = [], allEdges = [] } = props
  const isCollapsed = Boolean(data?.isCollapsed)
  const [showSettings, setShowSettings] = useState(false)
  const [editingResponse, setEditingResponse] = useState(false)
  const status = data?.status || "idle"
  
  // Use the optimized token calculation hook
  const { tokenPreview, isCalculatingTokens } = useNodeTokens({
    nodeId: id,
    promptText: data?.promptText || '',
    allNodes,
    allEdges,
    nodeType: 'openrouter'
  })
  
  
  
  const statusClass = data?.status === 'processing'
    ? 'node-status-processing'
    : data?.status === 'done'
    ? 'node-status-done'
    : data?.status === 'error'
    ? 'node-status-error'
    : data?.status === 'edited'
    ? 'node-status-edited'
    : ''
  const settings = useSettings()
  // Auto-select first model
  React.useEffect(() => {
    const provider = settings.providers.openrouter
    if (provider?.hasKey && provider.activeModels?.length && !data?.modelName) {
      props.onNodeUpdate(id, { modelName: provider.activeModels[0] })
    }
  }, [settings, data?.modelName, id, props])

  return (
    <div 
      className={`rounded-xl border bg-clip-padding bg-card text-card-foreground shadow-lg w-[340px] max-w-[340px] ${data?.hidden ? 'opacity-50' : ''} ${statusClass}`}
    >
      <CustomHandle type="target" position={Position.Top} isConnectable={isConnectable} />
      <div 
        className="p-3 border-b rounded-t-xl flex items-center justify-between bg-clip-padding cursor-pointer" 
        style={{...getHeaderStyleForType('openrouter'), borderTopLeftRadius: 12, borderTopRightRadius: 12}}
      >
        <div className="text-sm font-medium flex items-center gap-2">
          <OpenRouter size={19} />
          {data?.title || "OpenRouter"}
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
            Run
          </Button>
          <button
            className={`h-6 w-6 inline-flex items-center justify-center rounded transition border ${isCollapsed ? 'node-collapse-btn-collapsed' : 'hover:bg-black/5 border-transparent'}`}
            title={isCollapsed ? "Expand" : "Collapse"}
            onClick={() => {
              const newCollapsed = !isCollapsed
              props.onNodeUpdate(id, { isCollapsed: newCollapsed })
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${isCollapsed ? 'rotate-180' : ''} transition-transform`}>
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
            <div className="text-xs text-muted-foreground">Prompt</div>
            <div className="relative rounded-md border bg-background p-2 text-xs whitespace-pre-wrap break-words max-h-12 overflow-hidden">
              {data?.promptText || ""}
              <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-background to-transparent pointer-events-none" />
            </div>
            <div className="text-xs text-muted-foreground">Response</div>
            {data?.status === 'processing' && !data?.responseText ? (
              <NodeThoughts executionStartTime={data?.executionStartTime} />
            ) : (
              <div className="relative rounded-md border bg-background p-2 text-xs max-h-16 overflow-hidden">
                {data?.responseText ? (
                  <MarkdownRenderer content={data.responseText || ""} />
                ) : (
                  <div className="text-muted-foreground italic">Response will appear here after execution...</div>
                )}
                <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-background to-transparent pointer-events-none" />
              </div>
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
          <div className={`p-3 space-y-3 relative`}>
          <div className="space-y-2">
            {(() => {
              const provider = settings.providers.openrouter
              const hasKey = provider?.hasKey
              const models = provider?.activeModels || []
              const disabledReason = !hasKey ? "API key not set" : (models.length === 0 ? "No active models configured" : null)
              const canSelect = !disabledReason
              return (
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm nodrag"
                  value={data?.modelName || ""}
                  onChange={(e) => props.onNodeUpdate(id, { modelName: e.target.value })}
                  disabled={!canSelect}
                  data-nodrag
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
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
          <div className="space-y-2">
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
                    <span className="text-purple-600 dark:text-purple-400 font-medium">
                      {tokenPreview?.totalTokens.openai.toLocaleString()}
                    </span>
                  )}
                </div>
                
                {/* Tooltip - shown only when tokenPreview exists */}
                {tokenPreview && (
                  <div className="absolute bottom-full left-0 right-0 mb-2 p-3 bg-popover border rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
                    <div className="text-xs">
                      <div className="font-medium text-popover-foreground mb-2">This Request</div>
                      <div className="space-y-1">
                        <div className="flex justify-between"><span>Context:</span><span>{tokenPreview.contextTokens.openai.totalTokens.toLocaleString()}</span></div>
                        <div className="flex justify-between"><span>Prompt:</span><span>{tokenPreview.promptTokens.openai.toLocaleString()}</span></div>
                        <div className="flex justify-between font-medium border-t pt-1 mt-1"><span>Total:</span><span>{tokenPreview.totalTokens.openai.toLocaleString()}</span></div>
                      </div>
                      {tokenPreview.executedTokens?.openai > 0 && (
                        <div className="mt-2 pt-2 border-t border-dashed text-muted-foreground">
                          <div className="flex justify-between"><span>Chain history:</span><span>{tokenPreview.executedTokens.openai.toLocaleString()}</span></div>
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
            
            <textarea
              className="w-full min-h-[100px] rounded-md border bg-background px-3 py-2 text-sm nodrag"
              value={data?.promptText || ""}
              onChange={(e) => props.onNodeUpdate(id, { promptText: e.target.value })}
              placeholder="Enter prompt..."
              data-nodrag
              style={{ pointerEvents: "auto" }}
            />
          </div>

          <div className="border rounded-md">
            <button className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/50" onClick={() => setShowSettings(!showSettings)}>
              <span>Advanced Settings</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${showSettings ? 'rotate-180' : ''} transition-transform`}>
                <path d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showSettings && (
              <div className="grid grid-cols-2 gap-3 p-3">
                <div className="space-y-2">
                  <Label>Temperature</Label>
                  <Input type="number" step="0.1" min="0" max="2" value={data?.temperature ?? ""} onChange={(e) => props.onNodeUpdate(id, { temperature: parseFloat(e.target.value || "0") })} className="nodrag" data-nodrag />
                </div>
                <div className="space-y-2">
                  <Label>Max tokens</Label>
                  <Input type="number" min="1" value={data?.max_tokens ?? ""} onChange={(e) => props.onNodeUpdate(id, { max_tokens: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })} className="nodrag" data-nodrag />
                </div>
                <div className="space-y-2">
                  <Label>Top P</Label>
                  <Input type="number" step="0.1" min="0" max="1" value={data?.top_p ?? ""} onChange={(e) => props.onNodeUpdate(id, { top_p: e.target.value === "" ? undefined : parseFloat(e.target.value) })} className="nodrag" data-nodrag />
                </div>
                <div className="space-y-2">
                  <Label>Seed</Label>
                  <Input type="number" min="0" value={data?.seed ?? ""} onChange={(e) => props.onNodeUpdate(id, { seed: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })} className="nodrag" data-nodrag />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Response</Label>
              {!editingResponse ? (
                <button className="text-xs px-2 py-1 rounded border hover:bg-muted/50" onClick={() => setEditingResponse(true)}>Edit</button>
              ) : (
                <div className="flex items-center gap-2">
                  <button className="text-xs px-2 py-1 rounded border bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setEditingResponse(false)}>Save</button>
                  <button className="text-xs px-2 py-1 rounded border hover:bg-muted/50" onClick={() => setEditingResponse(false)}>Cancel</button>
                </div>
              )}
            </div>
            {!editingResponse ? (
              data?.isStreaming && data?.streamingText ? (
                <div className="relative rounded-md border bg-background p-3 text-sm max-h-[512px] overflow-hidden">
                  <MarkdownRenderer content={data.streamingText} />
                  <span className="animate-pulse inline-block ml-0.5">|</span>
                  <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent pointer-events-none" />
                </div>
              ) : data?.status === 'error' ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm whitespace-pre-wrap break-words text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                  <div className="font-medium text-red-900 dark:text-red-100 mb-1">Error:</div>
                  {data.responseText || data.error || "Unknown error occurred"}
                </div>
              ) : data?.responseText ? (
                <div className="relative rounded-md border bg-background p-3 text-sm max-h-[512px] overflow-hidden">
                  <MarkdownRenderer content={data.responseText || ""} />
                  <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent pointer-events-none" />
                </div>
              ) : data?.status === 'processing' ? (
                <NodeThoughts executionStartTime={data?.executionStartTime} />
              ) : (
                <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground italic">Response will appear here after execution...</div>
              )
            ) : (
              <textarea className="w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm nodrag" value={data?.responseText || ""} onChange={(e) => props.onNodeUpdate(id, { responseText: e.target.value })} placeholder="Edit or paste response..." data-nodrag style={{ pointerEvents: "auto" }} />
            )}
          </div>
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
            onChange={(e) => {
              props.onNodeUpdate(id, { hidden: e.target.checked })
            }}
            onMouseDown={(e) => {
              // DON'T stop propagation - use only data-nodrag to prevent dragging
              // Force toggle state only when clicking on input itself
              if (e.target === e.currentTarget) {
                const newValue = !data?.hidden
                props.onNodeUpdate(id, { hidden: newValue })
              }
            }}
            onClick={(e) => {
              // DON'T stop propagation for onClick, so dropdown menus work
              // Force toggle state only when clicking on input itself
              if (e.target === e.currentTarget) {
                const newValue = !data?.hidden
                props.onNodeUpdate(id, { hidden: newValue })
              }
            }}
            data-nodrag
            style={{ pointerEvents: 'auto', zIndex: 1000 }}
          />
          <Label 
            htmlFor={`hidden-${id}`} 
            className="text-xs cursor-pointer"
            onClick={(e) => {
              // DON'T stop propagation for onClick, so dropdown menus work
              // Force click on input
              const input = document.getElementById(`hidden-${id}`) as HTMLInputElement
              if (input) {
                input.checked = !input.checked
                input.dispatchEvent(new Event('change', { bubbles: true }))
              }
            }}
          >
            Hidden from context
          </Label>
        </div>
        <div className="text-xs text-muted-foreground uppercase">{status}</div>
      </div>
      
      
      <CustomHandle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  )
}

export default memo(OpenRouterNode)


