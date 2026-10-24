"use client"

import React, { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Copy, Eye, EyeOff, Trash2, ChevronDown, ChevronUp } from "lucide-react"

interface NodeContextMenuProps {
  open: boolean
  x: number
  y: number
  hidden: boolean
  collapsed: boolean
  selectedCount: number
  onDelete: () => void
  onToggleHidden: () => void
  onToggleCollapse: () => void
  onCopy: () => void
  onClose: () => void
}

export default function NodeContextMenu({ open, x, y, hidden, collapsed, selectedCount, onDelete, onToggleHidden, onToggleCollapse, onCopy, onClose }: NodeContextMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent | TouchEvent | PointerEvent) => {
      const target = e.target as Node | null
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        onClose()
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", onPointerDown, { capture: true })
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("touchstart", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, { capture: true } as any)
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("touchstart", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={containerRef}
      className="fixed z-50 w-56 rounded-lg border bg-popover text-popover-foreground shadow-md"
      style={{ top: y, left: x }}
      role="menu"
    >
      <div className="p-1">
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => {
            onCopy()
            onClose()
          }}
        >
          <Copy className="h-4 w-4 mr-2" />
          {selectedCount > 1 ? `Copy ${selectedCount} nodes` : 'Copy'}
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => {
            onToggleHidden()
            onClose()
          }}
        >
          {hidden ? (
            <>
              <Eye className="h-4 w-4 mr-2" />
              Show in context
            </>
          ) : (
            <>
              <EyeOff className="h-4 w-4 mr-2" />
              Hide from context
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => {
            onToggleCollapse()
            onClose()
          }}
        >
          {collapsed ? (
            <>
              <ChevronDown className="h-4 w-4 mr-2" />
              {selectedCount > 1 ? `Expand ${selectedCount} nodes` : 'Expand'}
            </>
          ) : (
            <>
              <ChevronUp className="h-4 w-4 mr-2" />
              {selectedCount > 1 ? `Collapse ${selectedCount} nodes` : 'Collapse'}
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start text-destructive"
          onClick={() => {
            onDelete()
            onClose()
          }}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          {selectedCount > 1 ? `Delete ${selectedCount} nodes` : 'Delete node'}
        </Button>
      </div>
    </div>
  )
}


