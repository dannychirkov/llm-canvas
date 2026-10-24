"use client"
import type { ProviderId } from "@/lib/providers/registry"
import { providerRegistry } from "@/lib/providers/registry"


import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ChevronRight, ChevronDown } from "lucide-react"
import { useState } from "react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { getPrimaryColor } from "@/components/nodes/colors"
import { getNodeTypeIcon } from "@/components/nodes/NodeTypeIcon"

interface TokenStatistics {
  [operator: string]: {
    total: number
    models: {
      [modelName: string]: {
        total: number
        usageSources?: Record<string, number>
        categories: {
          inputTokens?: number
          outputTokens?: number
          reasoningTokens?: number
          cachedTokens?: number
          audioTokens?: number
          videoTokens?: number
          imageTokens?: number
          otherTools?: number
        }
      }
    }
  }
}

interface TokenStatisticsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  statistics: TokenStatistics
  totalTokens: number
  canvasTotalTokensUsed?: number | null
  canvasId?: string
  onRefreshTotalTokens?: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  inputTokens: "Input",
  outputTokens: "Output",
  reasoningTokens: "Reasoning (may be included in output)",
  cachedTokens: "Cached input (included in input)",
  audioTokens: "Audio",
  videoTokens: "Video",
  imageTokens: "Image",
  otherTools: "Other tools",
}

export default function TokenStatisticsDialog({
  open,
  onOpenChange,
  statistics,
  totalTokens,
  canvasTotalTokensUsed,
  canvasId,
  onRefreshTotalTokens,
}: TokenStatisticsDialogProps) {
  const [expandedOperators, setExpandedOperators] = useState<Set<string>>(new Set())
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set())
  const [showActiveTokens, setShowActiveTokens] = useState(true) // true = active tokens, false = total used on canvas
  const localCanvasTotalTokensUsed = canvasTotalTokensUsed ?? null
  const [dbStatistics, setDbStatistics] = useState<TokenStatistics>({})
  const [loadingDbStatistics, setLoadingDbStatistics] = useState(false)

  // Update local state when prop changes

  // Refresh total tokens when dialog opens
  React.useEffect(() => {
    if (open && canvasId && onRefreshTotalTokens) {
      // Call refresh immediately when dialog opens
      onRefreshTotalTokens()
    }
  }, [open, canvasId, onRefreshTotalTokens])

  // Load database statistics when switching to Total view
  React.useEffect(() => {
    if (!showActiveTokens && canvasId && open) {
      let cancelled = false
      const loading = setTimeout(() => { if (!cancelled) setLoadingDbStatistics(true) }, 0)
      
      fetch(`/api/canvas/${canvasId}/token-statistics`)
        .then(response => {
          if (cancelled) return
          if (response.ok) {
            return response.json()
          }
          throw new Error('Failed to fetch token statistics')
        })
        .then(data => {
          if (cancelled) return
          setDbStatistics(data || {})
        })
        .catch(error => {
          if (cancelled) return
          console.error('Failed to load token statistics from database:', error)
          setDbStatistics({})
        })
        .finally(() => {
          if (!cancelled) setLoadingDbStatistics(false)
        })
      
      return () => { cancelled = true; clearTimeout(loading) }
    }
  }, [showActiveTokens, canvasId, open])

  // Use active statistics (from nodes) or database statistics (from DB)
  const displayStatistics = showActiveTokens ? statistics : dbStatistics

  const toggleOperator = (operator: string) => {
    const newExpanded = new Set(expandedOperators)
    if (newExpanded.has(operator)) {
      newExpanded.delete(operator)
      // Also collapse all models of this operator
      const models = Object.keys(displayStatistics[operator]?.models || {})
      const newExpandedModels = new Set(expandedModels)
      models.forEach(model => {
        const modelKey = `${operator}:${model}`
        newExpandedModels.delete(modelKey)
      })
      setExpandedModels(newExpandedModels)
    } else {
      newExpanded.add(operator)
    }
    setExpandedOperators(newExpanded)
  }

  // Get operator color and icon
  const getOperatorStyle = (operator: string) => {
    // Map operator name to node type for color/icon lookup
    let operatorType: ProviderId | 'summarizer' | 'text'
    if (operator === 'nanobanana' || operator === 'custom') {
      operatorType = operator
    } else if (operator === 'openai' || operator === 'gemini' || operator === 'openrouter') {
      operatorType = operator
    } else {
      // For summarizer or unknown, use summarizer as fallback
      operatorType = 'summarizer'
    }
    
    const color = getPrimaryColor(operatorType)
    const icon = getNodeTypeIcon(operatorType)
    
    // Convert hex to rgba for background
    const hexToRgb = (hex: string) => {
      const h = hex.replace('#', '')
      const bigint = parseInt(h, 16)
      const r = (bigint >> 16) & 255
      const g = (bigint >> 8) & 255
      const b = bigint & 255
      return { r, g, b }
    }
    
    const { r, g, b } = hexToRgb(color)
    const backgroundColor = `rgba(${r}, ${g}, ${b}, 0.1)`
    const borderColor = `rgba(${r}, ${g}, ${b}, 0.3)`
    
    return { color, icon, backgroundColor, borderColor }
  }

  const toggleModel = (operator: string, model: string) => {
    const modelKey = `${operator}:${model}`
    const newExpanded = new Set(expandedModels)
    if (newExpanded.has(modelKey)) {
      newExpanded.delete(modelKey)
    } else {
      newExpanded.add(modelKey)
    }
    setExpandedModels(newExpanded)
  }

  const formatNumber = (num: number) => num.toLocaleString()

  // Define all possible operators
  const allOperators = Object.keys(providerRegistry)
  
  // Get operators from display statistics and merge with all possible operators
  const operatorsWithData = Object.keys(displayStatistics).sort()
  const operators = Array.from(new Set([...allOperators, ...operatorsWithData])).sort()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px]" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Token Statistics</DialogTitle>
          <DialogDescription>
            {showActiveTokens 
              ? "Recorded usage from current completed nodes. Input/output totals and their cached, reasoning and media subsets must not be added twice. Estimates are not billing statements."
              : "Cumulative recorded usage, including reruns and deleted nodes. Provider-reported values, estimates and unreported requests are distinguished; this is not an invoice."
            }
          </DialogDescription>
        </DialogHeader>

        <div className="pr-2">
          <div className="space-y-4">
            {/* iOS-style segmented control */}
            {(localCanvasTotalTokensUsed !== null && localCanvasTotalTokensUsed !== undefined) && (
              <div className="inline-flex items-center rounded-lg bg-muted p-1 w-full">
                <button
                  onClick={() => setShowActiveTokens(true)}
                  className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    showActiveTokens
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Active
                </button>
                <button
                  onClick={() => setShowActiveTokens(false)}
                  className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-all ${
                    !showActiveTokens
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Total
                </button>
              </div>
            )}

            {/* Total summary */}
            <div className={`rounded-lg border p-4 ${
              showActiveTokens 
                ? 'bg-muted/50' 
                : 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <span className={`text-sm font-semibold ${
                    !showActiveTokens ? 'text-blue-900 dark:text-blue-100' : ''
                  }`}>
                    {showActiveTokens ? 'Active Tokens' : 'Total Used on Canvas'}
                  </span>
                  {!showActiveTokens && (
                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                      Cumulative sum of all executed nodes (including deleted)
                    </p>
                  )}
                </div>
                <span className={`text-lg font-bold ${
                  !showActiveTokens ? 'text-blue-900 dark:text-blue-100' : ''
                }`}>
                  {formatNumber(showActiveTokens ? totalTokens : (localCanvasTotalTokensUsed || 0))}
                </span>
              </div>
            </div>

            {/* Statistics by operators */}
            {loadingDbStatistics && !showActiveTokens ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                Loading statistics from database...
              </div>
            ) : operators.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                {showActiveTokens 
                  ? "No token data available. Execute nodes to display statistics."
                  : "No token usage recorded in database yet."
                }
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 items-start">
                {operators.map(operator => {
                  const operatorData = displayStatistics[operator]
                  const isUsed = operatorData && operatorData.total > 0
                  const isOperatorExpanded = expandedOperators.has(operator)
                  const models = operatorData ? Object.keys(operatorData.models).sort() : []
                  const operatorStyle = getOperatorStyle(operator)

                  return (
                    <div 
                      key={operator} 
                      className={`rounded-lg border ${
                        isUsed 
                          ? '' 
                          : 'bg-muted/30 border-dashed opacity-60'
                      }`}
                      style={isUsed ? { 
                        borderColor: operatorStyle.borderColor,
                        backgroundColor: operatorStyle.backgroundColor
                      } : {}}
                    >
                      {/* Operator header */}
                      <button
                        onClick={() => isUsed && toggleOperator(operator)}
                        disabled={!isUsed}
                        className={`w-full flex items-center justify-between p-4 transition-opacity text-left focus:outline-none ${
                          isUsed ? 'hover:opacity-80 cursor-pointer' : 'cursor-not-allowed'
                        }`}
                        style={isUsed ? { backgroundColor: operatorStyle.backgroundColor } : {}}
                      >
                        <div className="flex items-center gap-2">
                          {isUsed && (
                            isOperatorExpanded ? (
                              <ChevronDown className="h-4 w-4" style={{ color: operatorStyle.color }} />
                            ) : (
                              <ChevronRight className="h-4 w-4" style={{ color: operatorStyle.color }} />
                            )
                          )}
                          {!isUsed && <div className="w-4 h-4" />}
                          <div className="flex items-center gap-2">
                            <div className={`flex-shrink-0 flex items-center justify-center ${!isUsed ? 'text-muted-foreground' : ''}`} style={isUsed ? { color: operatorStyle.color } : {}}>
                              <div className="w-5 h-5 flex items-center justify-center">
                                {operatorStyle.icon}
                              </div>
                            </div>
                            <span className={`font-semibold capitalize ${!isUsed ? 'text-muted-foreground' : ''}`} style={isUsed ? { color: operatorStyle.color } : {}}>
                              {operator}
                            </span>
                          </div>
                        </div>
                        <span className={`text-sm font-medium ${!isUsed ? 'text-muted-foreground' : ''}`} style={isUsed ? { color: operatorStyle.color } : {}}>
                          {isUsed ? `${formatNumber(operatorData.total)} tokens` : 'Not used'}
                        </span>
                      </button>

                      {/* Operator models */}
                      {isUsed && isOperatorExpanded && (
                        <div className="border-t" style={{ borderColor: operatorStyle.borderColor }}>
                          {models.map(model => {
                            const modelData = operatorData.models[model]
                            const modelKey = `${operator}:${model}`
                            const isModelExpanded = expandedModels.has(modelKey)
                            const categories = Object.entries(modelData.categories).filter(
                              ([_, value]) => value && value > 0
                            )

                            return (
                              <div key={model} className="border-t first:border-t-0" style={{ borderColor: operatorStyle.borderColor }}>
                                {/* Model header */}
                                <button
                                  onClick={() => toggleModel(operator, model)}
                                  className="w-full flex items-center justify-between p-3 pl-8 hover:opacity-80 transition-opacity text-left focus:outline-none"
                                  style={{ backgroundColor: operatorStyle.backgroundColor }}
                                >
                                  <div className="flex items-center gap-2">
                                    {isModelExpanded ? (
                                      <ChevronDown className="h-4 w-4" style={{ color: operatorStyle.color }} />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" style={{ color: operatorStyle.color }} />
                                    )}
                                    <span className="text-sm font-medium" style={{ color: operatorStyle.color }}>
                                      {model}
                                      {!!modelData.usageSources?.estimated && <span className="ml-2 text-xs text-muted-foreground">Includes estimates</span>}
                                      {!!modelData.usageSources?.unreported && <span className="ml-2 text-xs text-muted-foreground">Some usage not reported</span>}
                                    </span>
                                  </div>
                                  <span className="text-sm" style={{ color: operatorStyle.color }}>
                                    {formatNumber(modelData.total)} tokens
                                  </span>
                                </button>

                              {/* Token categories */}
                              {isModelExpanded && categories.length > 0 && (
                                <div className="border-t bg-background/50" style={{ borderColor: operatorStyle.borderColor }}>
                                  <div className="p-3 pl-12 space-y-2">
                                    {categories
                                      .sort(([a], [b]) => {
                                        // Define display order
                                        const order = ['inputTokens', 'outputTokens', 'reasoningTokens', 'otherTools', 'cachedTokens', 'audioTokens', 'videoTokens', 'imageTokens']
                                        const indexA = order.indexOf(a)
                                        const indexB = order.indexOf(b)
                                        if (indexA === -1 && indexB === -1) return 0
                                        if (indexA === -1) return 1
                                        if (indexB === -1) return -1
                                        return indexA - indexB
                                      })
                                      .map(([category, value]) => (
                                        <div
                                          key={category}
                                          className="flex items-center justify-between text-sm"
                                        >
                                          <span className="text-muted-foreground">
                                            {CATEGORY_LABELS[category] || category}
                                          </span>
                                          <span className="font-medium">
                                            {formatNumber(value || 0)}
                                          </span>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

