"use client"

import React, { useEffect, useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import { getMenuDotStyle, type NodeTypeKey } from "./colors"
import { Clipboard } from "lucide-react"

type _UseImported = NodeTypeKey

const NODE_TYPE_LABELS: { key: NodeTypeKey; label: string }[] = [
  { key: "text", label: "Text Node" },
  { key: "summarizer", label: "Summarizer" },
  { key: "gemini", label: "Gemini" },
  { key: "openai", label: "OpenAI" },
  { key: "custom", label: "Custom endpoint" },
  { key: "openrouter", label: "OpenRouter" },
  { key: "nanobanana", label: "Nano Banana" },
  { key: "media", label: "Media" },
  { key: "memory", label: "Memory" },
  { key: "notes", label: "Notes" },
  { key: "test", label: "Test Node" },
]

interface NodeTypeMenuProps {
  open: boolean
  onSelect: (type: NodeTypeKey) => void
  onClose: () => void
  position?: { x: number; y: number }
  onPaste?: () => void
  hasClipboardData?: boolean
}

export default function NodeTypeMenu({ open, onSelect, onClose, position, onPaste, hasClipboardData }: NodeTypeMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on click outside menu
  useEffect(() => {
    if (!open) return
    const handlePointerDown = (e: MouseEvent | TouchEvent | PointerEvent) => {
      const target = e.target as Node | null
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        onClose()
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, { capture: true })
    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("touchstart", handlePointerDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, { capture: true } as any)
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("touchstart", handlePointerDown)
    }
  }, [open, onClose])

  const { llmItems, utilityItems } = useMemo(() => {
    const labelByKey = new Map(NODE_TYPE_LABELS.map((x) => [x.key, x.label] as const))
    const llmKeys: NodeTypeKey[] = ["openai", "gemini", "openrouter", "custom", "summarizer", "nanobanana"]
    const utilityKeys: NodeTypeKey[] = ["text", "media", "memory", "notes"]
    return {
      llmItems: llmKeys.map((key) => ({ key, label: labelByKey.get(key) || key })),
      utilityItems: utilityKeys.map((key) => ({ key, label: labelByKey.get(key) || key })),
    }
  }, [])

  // Calculate menu position considering screen boundaries
  const getMenuPosition = useMemo(() => {
    if (!position) {
      return { top: '5rem', right: '1rem' }
    }
    
    // Check that we're on client
    if (typeof window === 'undefined') {
      return {
        position: 'fixed' as const,
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 20
      }
    }
    
    const menuWidth = 224 // w-56 = 14rem = 224px
    const menuHeight = 400 // approximate menu height
    const padding = 16 // padding from screen edge
    
    let x = position.x
    let y = position.y
    
    // Check if menu goes beyond right edge of screen
    if (x + menuWidth > window.innerWidth - padding) {
      x = window.innerWidth - menuWidth - padding
    }
    
    // Check if menu goes beyond bottom edge of screen
    if (y + menuHeight > window.innerHeight - padding) {
      y = position.y - menuHeight
    }
    
    // Check if menu goes beyond top edge of screen
    if (y < padding) {
      y = padding
    }
    
    // Check if menu goes beyond left edge of screen
    if (x < padding) {
      x = padding
    }
    
    return {
      position: 'fixed' as const,
      left: `${x}px`,
      top: `${y}px`,
      zIndex: 20
    }
  }, [position])

  if (!open) return null

  return (
    <div 
      ref={containerRef} 
      className="w-56 rounded-lg border bg-popover text-popover-foreground shadow-md"
      style={getMenuPosition}
    >
      <div className="p-2 max-h-[60vh] overflow-auto">
        {/* Paste option if clipboard has data */}
        {hasClipboardData && onPaste && (
          <>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2"
              onClick={() => {
                onPaste()
                onClose()
              }}
            >
              <Clipboard className="h-4 w-4" />
              Paste
            </Button>
            <div className="my-2 border-t" />
          </>
        )}
        
        <div className="px-2 pt-1 pb-2 text-xs font-medium text-muted-foreground">LLM Nodes</div>
        {llmItems.map(({ key, label }) => (
          <Button
            key={key}
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={() => {
              onSelect(key)
              onClose()
            }}
          >
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={getMenuDotStyle(key)} />
            {label}
          </Button>
        ))}

        <div className="mt-2 border-t" />
        <div className="px-2 pt-2 pb-2 text-xs font-medium text-muted-foreground">Utility Nodes</div>
        {utilityItems.map(({ key, label }) => (
          <Button
            key={key}
            variant="ghost"
            className="w-full justify-start gap-2"
            onClick={() => {
              onSelect(key)
              onClose()
            }}
          >
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={getMenuDotStyle(key)} />
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}


