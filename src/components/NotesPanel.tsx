"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { readNotes, saveNotes, type NotesSnapshot } from "@/lib/notesClient"
import { Node } from "reactflow"
import { X, Eye, Edit3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface NotesPanelProps {
  selectedNode: Node | null
  isOpen: boolean
  onClose: () => void
  embedded?: boolean
  canvasId?: string
  onNodeUpdate?: (id: string, patch: Record<string, any>) => void
}

export default function NotesPanel({ selectedNode, isOpen, onClose, embedded = false, canvasId, onNodeUpdate }: NotesPanelProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [draft, setDraft] = useState({ nodeId: selectedNode?.id, text: selectedNode?.data?.notes || "" })
  const localNotes = draft.nodeId === selectedNode?.id ? draft.text : selectedNode?.data?.notes || ""
  const setLocalNotes = (text: string) => setDraft({ nodeId: selectedNode?.id, text })
  const [isEditing, setIsEditing] = useState(true)
  const [saveError, setSaveError] = useState("")
  const [retry, setRetry] = useState(0)
  const snapshot = useRef<NotesSnapshot | null>(null)
  const panelHeight = localNotes.trim() ? "calc(100vh - 2rem)" : "120px"
  
  // Size constraints (only if not embedded)
  const minWidth = Math.floor((typeof window === "undefined" ? 1200 : window.innerWidth) * 0.3)
  const maxWidth = Math.floor((typeof window === "undefined" ? 1200 : window.innerWidth) * 0.6)
  
  // Optimal initial width
  const initialWidth = Math.max(minWidth, Math.floor((typeof window === "undefined" ? 1200 : window.innerWidth) * 0.4))
  
  // Get saved width from localStorage
  const getSavedWidth = () => {
    if (typeof window === 'undefined') return initialWidth
    const saved = localStorage.getItem('notesPanelWidth')
    if (saved) {
      const parsedWidth = parseInt(saved, 10)
      if (parsedWidth >= minWidth && parsedWidth <= maxWidth) {
        return parsedWidth
      }
    }
    return initialWidth
  }
  
  // State for panel resizing (only if not embedded)
  const [panelWidth, setPanelWidth] = useState(getSavedWidth)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [startWidth, setStartWidth] = useState(0)

  // Panel show/hide animation
  useEffect(() => {
    let cleanup: (() => void) | void
    const frame = requestAnimationFrame(() => {
      cleanup = (() => {
    if (isOpen) {
      setIsVisible(true)
    } else {
      const timer = setTimeout(() => setIsVisible(false), 300)
      return () => clearTimeout(timer)
    }

      })()
    })
    return () => { cancelAnimationFrame(frame); cleanup?.() }
  }, [isOpen])


  // Debounced sync notes to parent (like promptText pattern)
  useEffect(() => {
    if (!selectedNode?.id) return
    if (localNotes === (selectedNode?.data?.notes || '')) return

    const timeout = setTimeout(() => {
      onNodeUpdate?.(selectedNode.id, { notes: localNotes })
    }, 300)
    return () => clearTimeout(timeout)
  }, [localNotes, selectedNode?.id, selectedNode?.data?.notes, onNodeUpdate])

  useEffect(() => {
    if (onNodeUpdate || !canvasId || !selectedNode?.id) return
    const controller = new AbortController()
    const nodeId = selectedNode.id
    const initialNotes = selectedNode.data?.notes || ""
    snapshot.current = null
    readNotes(nodeId, canvasId, controller.signal).then(current => {
      snapshot.current = current
      setDraft(previous => previous.nodeId === nodeId && previous.text !== initialNotes ? previous : { nodeId, text: current.notes })
      setSaveError("")
      setRetry(value => value + 1)
    }).catch(() => { if (!controller.signal.aborted) setSaveError("Unable to load notes. Your draft is preserved.") })
    return () => controller.abort()
  }, [canvasId, selectedNode?.id, onNodeUpdate])

  useEffect(() => {
    if (onNodeUpdate || !canvasId || !selectedNode?.id || !snapshot.current || localNotes === snapshot.current.notes) return
    const controller = new AbortController()
    const nodeId = selectedNode.id
    const timeout = setTimeout(() => {
      saveNotes(nodeId, canvasId, localNotes, snapshot.current!, controller.signal).then(current => {
        snapshot.current = current
        setSaveError("")
        window.dispatchEvent(new CustomEvent("canvas-notes-updated", { detail: { canvasId, nodeId, notes: current.notes, baseUpdatedAt: current.baseUpdatedAt, updatedAt: current.updatedAt } }))
      }).catch(error => { if (!controller.signal.aborted) setSaveError(error instanceof Error ? error.message : "Unable to save notes") })
    }, 400)
    return () => { clearTimeout(timeout); controller.abort() }
  }, [localNotes, canvasId, selectedNode?.id, onNodeUpdate, retry])


  // Handlers for panel resizing (only if not embedded)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (embedded) return
      setIsDragging(true)
      setStartX(e.clientX)
      setStartWidth(panelWidth)
    },
    [panelWidth, embedded]
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || embedded) return
      const deltaX = e.clientX - startX
      const newWidth = Math.max(
        minWidth,
        Math.min(maxWidth, startWidth + deltaX)
      )
      setPanelWidth(newWidth)
      localStorage.setItem('notesPanelWidth', newWidth.toString())
    },
    [isDragging, startX, startWidth, minWidth, maxWidth, embedded]
  )

  const handleMouseUp = useCallback(() => {
    if (embedded) return
    setIsDragging(false)
  }, [embedded])

  // Global mouse handlers for resizing
  useEffect(() => {
    if (embedded) return
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = 'none'
    } else {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
    }
  }, [isDragging, handleMouseMove, handleMouseUp, embedded])

  // Handle window resize (only if not embedded)
  useEffect(() => {
    if (embedded) return
    const handleResize = () => {
      const newMinWidth = Math.floor((typeof window === "undefined" ? 1200 : window.innerWidth) * 0.3)
      const newMaxWidth = Math.floor((typeof window === "undefined" ? 1200 : window.innerWidth) * 0.6)
      
      if (panelWidth < newMinWidth) {
        setPanelWidth(newMinWidth)
        localStorage.setItem('notesPanelWidth', newMinWidth.toString())
      } else if (panelWidth > newMaxWidth) {
        setPanelWidth(newMaxWidth)
        localStorage.setItem('notesPanelWidth', newMaxWidth.toString())
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [panelWidth, embedded])

  // Always use gray border for notes panel
  const borderColor = "#9ca3af"

  return (
    <>
      {/* Overlay for background dimming (only if not embedded) */}
      {!embedded && (
        <div
          className={`fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity duration-300 ${
            isOpen && selectedNode && isVisible ? "opacity-100" : "opacity-0"
          }`}
          onClick={onClose}
        />
      )}
      
      {/* Panel */}
      <div
        className={`${embedded ? 'h-full w-full' : 'fixed right-4 top-4'} bg-background border border-border shadow-2xl z-50 transform transition-all duration-300 ease-in-out ${embedded ? '' : 'rounded-xl'} ${
          embedded || (isOpen && selectedNode && isVisible) ? "translate-x-0" : "translate-x-full"
        }`}
        style={{
          ...(embedded ? {} : { width: panelWidth, height: panelHeight }),
          borderColor: embedded ? 'transparent' : borderColor,
          borderWidth: embedded ? "0px" : "2px",
          boxShadow: embedded ? 'none' : `0 0 0 1px ${borderColor}40, 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -2px rgb(0 0 0 / 0.05)`,
          transition: embedded ? 'none' : 'height 0.3s ease-in-out'
        }}
      >
        {/* Header */}
        {selectedNode && (
          <div className="flex items-center justify-between p-3 border-b border-border">
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: borderColor }}
              />
              <h2 className="text-sm font-medium text-foreground">
                Notes
              </h2>
            </div>
            <div className="flex items-center gap-1">
              <Button
                onClick={() => setIsEditing(!isEditing)}
                variant="ghost"
                size="sm"
                className="w-6 h-6 p-0 hover:bg-muted"
                title={isEditing ? "Preview" : "Edit"}
              >
                {isEditing ? <Eye className="h-3 w-3" /> : <Edit3 className="h-3 w-3" />}
              </Button>
              {!embedded && (
                <Button
                  onClick={onClose}
                  variant="ghost"
                  size="sm"
                  className="w-6 h-6 p-0 hover:bg-muted"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        {selectedNode && (
          <div className="flex flex-col h-full">
            {saveError && <div role="alert" className="p-3 text-sm text-destructive">{saveError} <Button variant="ghost" size="sm" onClick={() => setRetry(value => value + 1)}>Retry</Button></div>}
            {/* Notes Content */}
            <div className="flex-1 overflow-hidden p-3 min-h-0">
              {isEditing ? (
                <textarea
                  value={localNotes}
                  onChange={(e) => setLocalNotes(e.target.value)}
                  placeholder="Write your notes here... Use Markdown formatting"
                  className="w-full h-full resize-none border-none outline-none bg-transparent text-foreground placeholder:text-muted-foreground overflow-y-auto text-sm"
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace' }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                />
              ) : (
                <div className="h-full overflow-y-auto prose prose-xs max-w-none dark:prose-invert">
                  {localNotes ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {localNotes}
                    </ReactMarkdown>
                  ) : (
                    <div className="text-muted-foreground italic">
                      No notes yet. Switch to edit mode to add notes.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Resize Handle (only if not embedded) */}
        {!embedded && (
          <div
            className="absolute left-0 top-0 bottom-0 w-1 bg-gray-300 cursor-ew-resize hover:bg-gray-400 transition-colors"
            style={{
              background:
                'repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)',
            }}
            onMouseDown={handleMouseDown}
          />
        )}
      </div>
    </>
  )
}
