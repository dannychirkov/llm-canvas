"use client"

import React, { memo } from "react"
import { type NodeProps } from "reactflow"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getHeaderStyleForType } from "./colors"

interface NodeComponentProps<T = any> extends NodeProps<T> {
  onNodeUpdate: (id: string, patch: Record<string, any>) => void
  onNodeSelect?: (id: string) => void
}

type MemoryData = { title?: string; key?: string; value?: string; scope?: string; hidden?: boolean }

function estimateTokenCount(text: string): number {
  if (!text) return 0
  
  // Unify formatting with context - add prefix as in assembleContext
  const formattedText = `Persistent Memory: ${text}`
  
  try {
    const matches = formattedText.match(/\p{L}+|\p{N}+|[^\s\p{L}\p{N}]/gu)
    return matches ? matches.length : Math.ceil(formattedText.length / 4)
  } catch {
    return Math.ceil(formattedText.length / 4)
  }
}

function MemoryNode(props: NodeComponentProps<MemoryData>) {
  const { id, data } = props
  const value = data?.value || ""
  
  // Count tokens with context formatting
  const contextTokenCount = React.useMemo(() => estimateTokenCount(value), [value])
  
  // Count only own tokens (without prefix)
  const ownTokenCount = React.useMemo(() => {
    if (!value) return 0
    try {
      const matches = value.match(/\p{L}+|\p{N}+|[^\s\p{L}\p{N}]/gu)
      return matches ? matches.length : Math.ceil(value.length / 4)
    } catch {
      return Math.ceil(value.length / 4)
    }
  }, [value])
  
  const usedTokenCount = data?.hidden ? 0 : contextTokenCount

  return (
    <div className={`rounded-xl overflow-hidden border-2 border-gray-600/50 dark:border-white/50 bg-clip-padding text-card-foreground shadow-xl w-[320px] max-w-[320px] bg-neutral-200 dark:bg-neutral-600 ${data?.hidden ? 'opacity-50' : ''}`}>
      {/* No handles: Memory node is not connectable */}
      <div className="p-3 border-b rounded-t-xl flex items-center justify-between bg-white/80 dark:bg-white/15" style={{...getHeaderStyleForType('memory'), borderTopLeftRadius: 12, borderTopRightRadius: 12}}>
        <div className="text-sm font-medium flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14,2 14,8 20,8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10,9 9,9 8,9" />
          </svg>
          {data?.title || "Memory"}
        </div>
      </div>
      <div className="p-3 space-y-3 bg-white/70 dark:bg-white/10">
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground flex items-center justify-between">
            <span>Own tokens: {ownTokenCount}</span>
            <span>In context: {usedTokenCount}</span>
          </div>
          <textarea
            id={`value-${id}`}
            className="w-full min-h-[120px] rounded-md border bg-background px-3 py-2 text-sm nodrag"
            value={data?.value || ""}
            onChange={(e) => props.onNodeUpdate(id, { value: e.target.value })}
            placeholder="Enter memory..."
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            data-nodrag
            style={{ pointerEvents: "auto" }}
          />
        </div>
      </div>
      <div className="border-t rounded-b-xl bg-white/60 dark:bg-white/10 px-3 py-1 flex items-center gap-2" style={{borderBottomLeftRadius: 12, borderBottomRightRadius: 12}}>
        <input
          id={`hidden-${id}`}
          type="checkbox"
          className="h-3.5 w-3.5 nodrag"
          checked={Boolean(data?.hidden)}
          onChange={(e) => props.onNodeUpdate(id, { hidden: e.target.checked })}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          data-nodrag
        />
        <Label htmlFor={`hidden-${id}`} className="text-xs">Hidden from context</Label>
      </div>
      {/* No handles: Memory node is not connectable */}
    </div>
  )
}

export default memo(MemoryNode)


