"use client"

import React, { memo, useState, useRef, useEffect, useCallback } from "react"
import { type NodeProps } from "reactflow"
import { NodeResizer } from "@reactflow/node-resizer"
import "@reactflow/node-resizer/dist/style.css"
import MarkdownRenderer from "@/components/MarkdownRenderer"

interface NodeComponentProps<T = any> extends NodeProps<T> {
  onNodeUpdate: (id: string, patch: Record<string, any>) => void
  onNodeSelect?: (id: string) => void
}

export type NotesData = {
  title?: string
  notes?: string
  color?: string
  width?: number
  height?: number
}

const PRESET_COLORS = [
  { name: "gray", hex: "#9ca3af" },
  { name: "red", hex: "#ef4444" },
  { name: "orange", hex: "#f97316" },
  { name: "yellow", hex: "#facc15" },
  { name: "green", hex: "#22c55e" },
  { name: "blue", hex: "#3b82f6" },
]

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const bigint = parseInt(h, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return { r, g, b }
}

function NotesNode(props: NodeComponentProps<NotesData>) {
  const { id, data, selected } = props

  const [isEditing, setIsEditing] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const color = data?.color || "#facc15" // Default to yellow
  const { r, g, b } = hexToRgb(color)
  const tintedBg = `rgba(${r}, ${g}, ${b}, 0.15)`

  // Handle double-click to enter edit mode
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsEditing(true)
  }, [])

  // Handle blur to exit edit mode
  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Check if the new focus target is outside the container
    const relatedTarget = e.relatedTarget as Node | null
    if (!containerRef.current?.contains(relatedTarget)) {
      setIsEditing(false)
    }
  }, [])

  // Also handle click outside for cases when blur doesn't fire (e.g., clicking on canvas)
  useEffect(() => {
    if (!isEditing) return

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsEditing(false)
      }
    }

    // Use capture phase to catch the event before it's handled by other elements
    document.addEventListener('mousedown', handleClickOutside, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
    }
  }, [isEditing])

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      // Move cursor to end
      const len = textareaRef.current.value.length
      textareaRef.current.setSelectionRange(len, len)
    }
  }, [isEditing])

  const handleMouseEnter = useCallback(() => setIsHovered(true), [])
  const handleMouseLeave = useCallback(() => setIsHovered(false), [])

  const handleResize = useCallback((_event: any, params: { width: number; height: number }) => {
    props.onNodeUpdate(id, { width: params.width, height: params.height })
  }, [id, props])

  return (
    <div
      ref={containerRef}
      className="relative rounded-xl overflow-visible text-card-foreground shadow-md cursor-grab active:cursor-grabbing"
      style={{
        backgroundColor: tintedBg,
        minWidth: '200px',
        minHeight: '150px',
        width: data?.width || 280,
        height: data?.height || 200,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Invisible hover extension zone above the note */}
      <div
        className="absolute left-0 right-0 -top-11 h-11"
        onMouseEnter={handleMouseEnter}
      />

      {/* Hover Toolbar - positioned above the note, right-aligned with animation */}
      <div
        className={`absolute -top-11 right-0 flex items-center gap-1.5 bg-white dark:bg-gray-800 px-2.5 py-1.5 rounded-full shadow-lg border border-gray-200 dark:border-gray-700 transition-all duration-200 ease-out ${
          isHovered && !isEditing
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-2 pointer-events-none"
        }`}
        style={{ zIndex: 50 }}
      >
        {PRESET_COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            aria-label={`Set color ${c.name}`}
            className={`h-5 w-5 rounded-full transition-all hover:scale-125 nodrag ${
              c.hex === color ? "ring-2 ring-offset-2 ring-gray-500 scale-110" : ""
            }`}
            style={{
              backgroundColor: c.hex,
              border: "2px solid rgba(255,255,255,0.8)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
            }}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              props.onNodeUpdate(id, { color: c.hex })
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ))}
      </div>
      {/* NodeResizer - invisible handles, only functional */}
      <NodeResizer
        minWidth={200}
        minHeight={150}
        isVisible={selected}
        handleClassName="nodrag !opacity-0"
        lineClassName="!border-transparent"
        handleStyle={{
          width: 12,
          height: 12,
          background: 'transparent',
          border: 'none',
        }}
        onResize={handleResize}
      />

      {/* Body - View or Edit Mode */}
      <div className="h-full flex flex-col">
        {isEditing ? (
          <div className="relative flex-1 p-3 pl-4">
            <textarea
              ref={textareaRef}
              className="w-full h-full rounded-md border-0 bg-white/50 dark:bg-gray-900/50 px-3 py-2 text-sm nodrag resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={data?.notes || ""}
              onChange={(e) => props.onNodeUpdate(id, { notes: e.target.value })}
              placeholder="Type your markdown here..."
              onBlur={handleBlur}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              data-nodrag
              style={{ minHeight: '100px' }}
            />
            {/* Markdown hint in bottom-right */}
            <div className="absolute bottom-4 right-4 text-[10px] text-muted-foreground bg-white/80 dark:bg-gray-800/80 px-1.5 py-0.5 rounded">
              Style with{" "}
              <a
                href="https://www.markdownguide.org/basic-syntax/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                Markdown
              </a>
            </div>
          </div>
        ) : (
          <div
            className="flex-1 p-3 pl-4 overflow-auto"
            onDoubleClick={handleDoubleClick}
          >
            {data?.notes ? (
              <MarkdownRenderer
                content={data.notes}
                className="text-sm [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:text-sm [&_p]:mb-1 [&_ul]:text-sm [&_ol]:text-sm"
              />
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Double-click to edit...
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(NotesNode)
