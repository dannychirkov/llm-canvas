"use client"

import React, { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"

interface EdgeContextMenuProps {
  open: boolean
  x: number
  y: number
  onDelete: () => void
  onClose: () => void
}

export default function EdgeContextMenu({ open, x, y, onDelete, onClose }: EdgeContextMenuProps) {
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
      className="fixed z-50 min-w-[160px] rounded-lg border bg-popover text-popover-foreground shadow-md"
      style={{ top: y, left: x }}
      role="menu"
    >
      <div className="p-1">
        <Button
          variant="ghost"
          className="w-full justify-start text-destructive"
          onClick={() => {
            onDelete()
            onClose()
          }}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete connection
        </Button>
      </div>
    </div>
  )
}
