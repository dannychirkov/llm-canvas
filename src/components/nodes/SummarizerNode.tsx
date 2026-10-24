"use client"
import type { CredentialProviderId } from "@/lib/providers/registry"


import React, { memo, useState, useEffect } from "react"
import { Position, type NodeProps } from "reactflow"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getHeaderStyleForType } from "./colors"
import CustomHandle from "./CustomHandle"
import MarkdownRenderer from "@/components/MarkdownRenderer"
import NodeThoughts from "@/components/NodeThoughts"
import { Calculator, Loader2, RotateCcw } from "lucide-react"
import { formatTokenPreview } from "@/lib/tokenPreviewCalculator"
import { useNodeTokens } from "@/hooks/useNodeTokens"
import { useSettings } from "@/components/providers/SettingsProvider"
import { SummaryLength, SummaryStyle, SmartSummarizerData } from "@/types"
import { generatePrompt, getContextWindow, determineStrategy, splitTextIntoChunks } from "@/lib/smartSummarizer"
import { customModelContextWindow } from "@/lib/providers/customTypes"

interface NodeComponentProps<T = any> extends NodeProps<T> {
  onNodeUpdate: (id: string, patch: Record<string, any>) => void
  onRun?: (id: string) => void
  onRestore?: (id: string) => void
  onNodeSelect?: (id: string) => void
  allNodes?: any[]
  allEdges?: any[]
}

type SummarizerData = SmartSummarizerData

function SummarizerNode(props: NodeComponentProps<SummarizerData>) {
  const { id, data, isConnectable, allNodes = [], allEdges = [] } = props
  const isCollapsed = Boolean(data?.isCollapsed)
  const [showSettings, setShowSettings] = useState(false)
  const [editingResponse, setEditingResponse] = useState(false)
  const settings = useSettings()
  const status = data?.status || "idle"
  const previewProvider = data?.provider === "gemini" ? "gemini" : "openai"
  
  // Use the optimized token calculation hook
  const { tokenPreview, isCalculatingTokens } = useNodeTokens({
    nodeId: id,
    promptText: '', // Summarizer doesn't use prompt text, it uses context
    allNodes,
    allEdges,
    nodeType: 'summarizer'
  })
  
  // Auto-select provider and model when creating node
  React.useEffect(() => {
    if (!data?.provider && settings.loaded) {
      // Select first available provider with API key
      const availableProviders = Object.entries(settings.providers)
        .filter(([_, provider]) => provider.hasKey && provider.activeModels.length > 0)
        .map(([key, _]) => key)
      
      const custom = settings.customEndpoints.find(endpoint => endpoint.apiType !== "comfyui")
      if (!availableProviders.length && custom) {
        const endpoint = custom
        props.onNodeUpdate(id, { provider: "custom", endpointId: endpoint.id, modelName: endpoint.models[0] || "", summaryLength: "medium", summaryStyle: "key-ideas" })
      }
      if (availableProviders.length > 0) {
        const selectedProvider = availableProviders[0] as CredentialProviderId
        const selectedModel = settings.providers[selectedProvider].activeModels[0]
        
        props.onNodeUpdate(id, { 
          provider: selectedProvider,
          modelName: selectedModel,
          summaryLength: 'medium',
          summaryStyle: 'key-ideas'
        })
      }
    }
  }, [settings, data?.provider, id, props])

  // Determine strategy based on tokens (called when tokens update)
  useEffect(() => {
    const updateStrategy = () => {
      if (!tokenPreview || !data?.provider || !data?.modelName || status === "done" || status === "processing") return
      
      try {
        // Use static context window (as fallback in other places)
        const customEndpoint = settings.customEndpoints.find(endpoint => endpoint.id === data.endpointId)
        const contextWindow = data.provider === "custom" ? customEndpoint ? customModelContextWindow(customEndpoint, data.modelName) : 32000 : getContextWindow(data.provider, data.modelName)
        
        // Get total text size from context
        const totalTextLength = tokenPreview.contextTokens[previewProvider].totalTokens
        
        // Determine automatic strategy
        const strategy = determineStrategy(
          totalTextLength,
          contextWindow,
          data.summaryStyle || 'key-ideas'
        )
        
        // Check if update is needed to avoid infinite loops
        const needsUpdate = 
          data.autoStrategy !== strategy || 
          data.contextWindow !== contextWindow
        
        if (needsUpdate) {
          // Update node with strategy and context window information
          props.onNodeUpdate(id, {
            autoStrategy: strategy,
            contextWindow: contextWindow
          })
        }
        
      } catch (error) {
        console.error('Error updating strategy:', error)
      }
    }

    updateStrategy()
  }, [tokenPreview, data?.provider, data?.modelName, data?.summaryStyle, id, props, previewProvider, settings.customEndpoints, status])
  
  const statusClass = data?.status === 'processing'
    ? 'node-status-processing'
    : data?.status === 'done'
    ? 'node-status-done'
    : data?.status === 'error'
    ? 'node-status-error'
    : data?.status === 'edited'
    ? 'node-status-edited'
    : ''

  return (
    <div className={`rounded-xl overflow-hidden border bg-clip-padding bg-card text-card-foreground shadow-lg w-[360px] max-w-[360px] ${data?.hidden ? 'opacity-50' : ''} ${statusClass}`}>
      <CustomHandle type="target" position={Position.Top} isConnectable={isConnectable} />

      <div className="p-3 border-b rounded-t-xl flex items-center justify-between bg-clip-padding" style={{...getHeaderStyleForType('summarizer'), borderTopLeftRadius: 12, borderTopRightRadius: 12}}>
        <div className="text-sm font-medium flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7h5.5L13 3.5V9z" />
            <path d="M8 12h8v2H8zm0 4h8v2H8z" opacity="0.6" />
          </svg>
          {data?.title || "Summarizer"}
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
            <div className="text-xs text-muted-foreground">Response</div>
            {data?.status === 'processing' && !data?.responseText ? (
              <NodeThoughts executionStartTime={data?.executionStartTime} />
            ) : (
              <div className="rounded-md border bg-background p-2 text-xs max-h-16 overflow-hidden">
                {data?.responseText ? (
                  <MarkdownRenderer content={data.responseText || ""} />
                ) : (
                  <div className="text-muted-foreground italic">Response will appear here after execution...</div>
                )}
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Provider</Label>
              <select
                value={data?.provider === "custom" ? `custom:${data?.endpointId || ""}` : data?.provider || ""}
                onChange={(e) => {
                  if (e.target.value.startsWith("custom:")) {
                    const endpoint = settings.customEndpoints.find(item => item.id === e.target.value.slice(7))
                    props.onNodeUpdate(id, { provider: "custom", endpointId: endpoint?.id, modelName: endpoint?.models[0] || "" })
                    return
                  }
                  const newProvider = e.target.value as CredentialProviderId
                  const providerSettings = settings.providers[newProvider]
                  const newModel = providerSettings?.activeModels?.[0] || ""
                  
                  props.onNodeUpdate(id, { 
                    provider: newProvider,
                    modelName: newModel
                  })
                }}
                className="w-full h-10 px-3 py-2 text-sm border border-input bg-background rounded-md ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 nodrag"
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                data-nodrag
              >
                <option value="">Select provider</option>
                {settings.customEndpoints.filter(endpoint => endpoint.apiType !== "comfyui").map(endpoint => <option key={endpoint.id} value={`custom:${endpoint.id}`}>{endpoint.label}</option>)}
                {settings.providers.openai.hasKey && settings.providers.openai.activeModels.length > 0 && (
                  <option value="openai">OpenAI</option>
                )}
                {settings.providers.gemini.hasKey && settings.providers.gemini.activeModels.length > 0 && (
                  <option value="gemini">Gemini</option>
                )}
                {settings.providers.openrouter.hasKey && settings.providers.openrouter.activeModels.length > 0 && (
                  <option value="openrouter">OpenRouter</option>
                )}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Model</Label>
              {(() => {
                const currentProvider = data?.provider as CredentialProviderId
                const availableModels = data?.provider === "custom" ? settings.customEndpoints.find(endpoint => endpoint.id === data?.endpointId)?.models || [] : currentProvider ? settings.providers[currentProvider]?.activeModels || [] : []
                const hasModels = availableModels.length > 0
                
                return (
                  <select
                    value={data?.modelName || ""}
                    onChange={(e) => props.onNodeUpdate(id, { modelName: e.target.value })}
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

          {/* Brief information about summarizer settings */}
          <div className="bg-muted/30 rounded-md px-3 py-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Summary:</span>
              <span className="font-medium capitalize">
                {data?.summaryLength || 'medium'} • {data?.summaryStyle || 'key-ideas'}
              </span>
            </div>
            {data?.autoStrategy && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-muted-foreground">Strategy:</span>
                <span className="font-medium capitalize">
                  {data.autoStrategy === 'single' ? 'Single Request' : 
                   data.autoStrategy === 'map-reduce' ? 'Map-Reduce' : 'Refine'}
                </span>
              </div>
            )}
          </div>

          <div className="border rounded-md">
            <button className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/50" onClick={() => setShowSettings(!showSettings)}>
              <span>Advanced Settings</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${showSettings ? 'rotate-180' : ''} transition-transform`}>
                <path d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showSettings && (
              <div className="p-3 space-y-4">
                {/* Smart summarizer settings */}
                <div className="space-y-3">
                  <div className="text-sm font-medium text-muted-foreground">Smart Summarizer Settings</div>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>Summary Length</Label>
                      <select
                        value={data?.summaryLength || "medium"}
                        onChange={(e) => props.onNodeUpdate(id, { summaryLength: e.target.value as SummaryLength })}
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
                        value={data?.summaryStyle || "key-ideas"}
                        onChange={(e) => props.onNodeUpdate(id, { summaryStyle: e.target.value as SummaryStyle })}
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
                  {data?.autoStrategy && (
                    <div className="bg-muted/30 rounded-md px-3 py-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Auto Strategy:</span>
                        <span className="font-medium capitalize">
                          {data.autoStrategy === 'single' ? 'Single Request' : 
                           data.autoStrategy === 'map-reduce' ? 'Map-Reduce' : 'Refine'}
                        </span>
                      </div>
                      {data?.contextWindow && (
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-muted-foreground">Context Window:</span>
                          <span className="font-medium">{data.contextWindow.toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Model technical settings */}
                <div className="space-y-3">
                  <div className="text-sm font-medium text-muted-foreground">Model Parameters</div>
                  <div className="grid grid-cols-2 gap-3">
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
                </div>
              </div>
            )}
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
                    <span className={`font-medium ${
                      data?.provider === 'openai' 
                        ? 'text-blue-600 dark:text-blue-400' 
                        : data?.provider === 'gemini' 
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-purple-600 dark:text-purple-400'
                    }`}>
                      {tokenPreview?.totalTokens[previewProvider].toLocaleString()}
                    </span>
                  )}
                </div>
                
                {/* Tooltip - shown only when tokenPreview exists */}
                {tokenPreview && (
                  <div className="absolute bottom-full left-0 right-0 mb-2 p-3 bg-popover border rounded-md shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
                    <div className="text-xs">
                      <div className="font-medium text-popover-foreground mb-2">This Request</div>
                      <div className="space-y-1">
                        <div className="flex justify-between"><span>Context:</span><span>{
                          tokenPreview.contextTokens[previewProvider].totalTokens.toLocaleString()
                        }</span></div>
                        <div className="flex justify-between"><span>Prompt:</span><span>{
                          tokenPreview.promptTokens[previewProvider].toLocaleString()
                        }</span></div>
                        <div className="flex justify-between font-medium border-t pt-1 mt-1"><span>Total:</span><span>{
                          tokenPreview.totalTokens[previewProvider].toLocaleString()
                        }</span></div>
                      </div>
                      {tokenPreview.executedTokens[previewProvider] > 0 && (
                        <div className="mt-2 pt-2 border-t border-dashed text-muted-foreground">
                          <div className="flex justify-between"><span>Chain history:</span><span>{
                            tokenPreview.executedTokens[previewProvider].toLocaleString()
                          }</span></div>
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
                <div className="rounded-md border bg-background p-3 text-sm whitespace-pre-wrap break-words">
                  <div className="relative">
                    {data.streamingText}
                    <span className="animate-pulse">|</span>
                  </div>
                </div>
              ) : data?.status === 'error' ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm whitespace-pre-wrap break-words text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                  <div className="font-medium text-red-900 dark:text-red-100 mb-1">Error:</div>
                  {data.responseText || data.error || "Unknown error occurred"}
                </div>
              ) : data?.responseText ? (
                <div className="rounded-md border bg-background p-3 text-sm">
                  <MarkdownRenderer content={data.responseText || ""} />
                </div>
              ) : data?.status === 'processing' ? (
                <NodeThoughts executionStartTime={data?.executionStartTime} />
              ) : (
                <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground italic">Response will appear here after execution...</div>
              )
            ) : (
              <textarea className="w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm nodrag" value={data?.responseText || ""} onChange={(e) => props.onNodeUpdate(id, { responseText: e.target.value })} placeholder="Edit or paste response..." onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} data-nodrag style={{ pointerEvents: "auto" }} />
            )}
          </div>
          </div>
        </div>
      </div>
      <div className="border-t bg-muted/50 px-3 py-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <input id={`hidden-${id}`} type="checkbox" className="h-3.5 w-3.5 nodrag" checked={Boolean((data as any)?.hidden)} onChange={(e) => props.onNodeUpdate(id, { hidden: e.target.checked })} data-nodrag />
          <Label htmlFor={`hidden-${id}`} className="text-xs">Hidden from context</Label>
        </div>
        <div className="text-xs text-muted-foreground uppercase">{status}</div>
      </div>
      
      
      <CustomHandle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  )
}

export default memo(SummarizerNode)


