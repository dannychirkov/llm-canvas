"use client"

import React, { memo } from "react"
import { Position, type NodeProps } from "reactflow"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getHeaderStyleForType } from "./colors"
import CustomHandle from "./CustomHandle"

interface NodeComponentProps<T = any> extends NodeProps<T> {
  onNodeUpdate: (id: string, patch: Record<string, any>) => void
  onNodeSelect?: (id: string) => void
}

function estimateTokenCount(text: string): number {
  if (!text) return 0
  try {
    const matches = text.match(/\p{L}+|\p{N}+|[^\s\p{L}\p{N}]/gu)
    return matches ? matches.length : Math.ceil(text.length / 4)
  } catch {
    return Math.ceil(text.length / 4)
  }
}

function TextNode(
  props: NodeComponentProps<{
    textContent?: string
    hidden?: boolean
    title?: string
    status?: 'idle' | 'processing' | 'done' | 'error' | 'edited'
  }>
) {
  const { id, data, isConnectable } = props
  const textContent = data?.textContent || ""
  const userTokenCount = React.useMemo(() => estimateTokenCount(textContent), [textContent])
  const usedTokenCount = data?.hidden ? 0 : userTokenCount

  return (
    <div className={`rounded-xl overflow-hidden border-2 border-gray-600/50 dark:border-white/50 bg-clip-padding bg-card text-card-foreground shadow-lg w-[320px] max-w-[320px] ${data?.hidden ? 'opacity-50' : ''}`}>
      <div className="p-3 border-b rounded-t-xl flex items-center justify-between" style={{...getHeaderStyleForType('text'), borderTopLeftRadius: 12, borderTopRightRadius: 12}}>
        <div className="text-sm font-medium flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14,2 14,8 20,8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10,9 9,9 8,9" />
          </svg>
          {data?.title || "Text"}
        </div>
      </div>

      <div className="p-3 space-y-3">
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground flex items-center justify-between">
            <span>Tokens (estimate): {userTokenCount}</span>
            <span>In context: {usedTokenCount}</span>
          </div>
          <textarea
            id={`text-${id}`}
            className="w-full min-h-[120px] rounded-md border bg-background px-3 py-2 text-sm nodrag"
            data-nodrag
            value={data?.textContent || ""}
            onChange={(e) => props.onNodeUpdate(id, { textContent: e.target.value })}
            placeholder="Enter text..."
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          />
        </div>
      </div>

      <div className="border-t rounded-b-xl bg-muted/50 px-3 py-1 flex items-center gap-2" style={{borderBottomLeftRadius: 12, borderBottomRightRadius: 12}}>
        <input
          id={`hidden-${id}`}
          type="checkbox"
          className="h-3.5 w-3.5"
          checked={Boolean(data?.hidden)}
          onChange={(e) => props.onNodeUpdate(id, { hidden: e.target.checked })}
        />
        <Label htmlFor={`hidden-${id}`} className="text-xs">Hidden from context</Label>
      </div>

      <CustomHandle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  )
}

export default memo(TextNode)


