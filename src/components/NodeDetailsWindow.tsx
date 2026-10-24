"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { Node, Edge } from "reactflow"
import NodeDetailsPanel from "./NodeDetailsPanel"
import NotesPanel from "./NotesPanel"
import NodeNavigationMap from "./NodeNavigationMap"
import { getPrimaryColor } from "./nodes/colors"

interface NodeDetailsWindowProps {
  selectedNode: Node | null
  isOpen: boolean
  onClose: () => void
  allNodes: Node[]
  allEdges: Edge[]
  onNodeUpdate?: (id: string, patch: Record<string, any>) => void
  onRun?: (id: string) => void
  onRestore?: (id: string) => void
  onNavigateToNode?: (nodeId: string) => void
  onFocusNode?: (nodeId: string) => void
  canvasId?: string
}

export default function NodeDetailsWindow({
  selectedNode,
  isOpen,
  onClose,
  allNodes,
  allEdges,
  onNodeUpdate,
  onRun,
  onRestore,
  onNavigateToNode,
  onFocusNode,
  canvasId
}: NodeDetailsWindowProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [animateIn, setAnimateIn] = useState(false)
  const [isAnimatingOut, setIsAnimatingOut] = useState(false)
  // Switch between nodes without jitter
  const [displayedNode, setDisplayedNode] = useState<Node | null>(selectedNode)
  const [switchPhase, setSwitchPhase] = useState<'idle' | 'out' | 'in'>('idle')
  const [isEntering, setIsEntering] = useState(false)
  
  // Panel dimensions
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    if (typeof window === "undefined") return 600
    const saved = Number(localStorage.getItem("nodeDetailsWindowLeftWidth"))
    return saved >= window.innerWidth * 0.3 && saved <= window.innerWidth * 0.5 ? saved : Math.floor(window.innerWidth * 0.45)
  })
  
  const [rightTopHeight, setRightTopHeight] = useState(() => {
    if (typeof window === 'undefined') return '55%'
    const saved = localStorage.getItem('nodeDetailsWindowRightTopHeight')
    if (saved) {
      const parsed = parseFloat(saved)
      // Check that saved value is within valid range (10% - 55%)
      if (parsed >= 10 && parsed <= 55) {
        return saved
      }
    }
    return '55%'
  })
  
  const [isDraggingVertical, setIsDraggingVertical] = useState(false)
  const [isDraggingHorizontal, setIsDraggingHorizontal] = useState(false)
  const [startX, setStartX] = useState(0)
  const [startY, setStartY] = useState(0)
  const [startLeftWidth, setStartLeftWidth] = useState(0)
  const [startRightTopHeight, setStartRightTopHeight] = useState(0)

  // Show/hide animation
  useEffect(() => {
    let cleanup: (() => void) | void
    const frame = requestAnimationFrame(() => {
      cleanup = (() => {
    if (isOpen) {
      setIsVisible(true)
      setIsAnimatingOut(false)
      // For entrance animation: first off-screen, then enable translate-x-0 in next frame
      setAnimateIn(false)
      if (typeof window !== 'undefined') {
        requestAnimationFrame(() => setAnimateIn(true))
      } else {
        setAnimateIn(true)
      }
    } else {
      setAnimateIn(false)
      setIsAnimatingOut(true)
      // Give time for panels to exit and container fade (250ms + small margin)
      const timer = setTimeout(() => {
        setIsAnimatingOut(false)
        setIsVisible(false)
      }, 280)
      return () => clearTimeout(timer)
    }

      })()
    })
    return () => { cancelAnimationFrame(frame); cleanup?.() }
  }, [isOpen])

  // Synchronized animation when switching nodes (navigation buttons)
  useEffect(() => {
    let cleanup: (() => void) | void
    const frame = requestAnimationFrame(() => {
      cleanup = (() => {
    if (!isVisible) return
    if (!selectedNode) return
    if (!displayedNode) {
      setDisplayedNode(selectedNode)
      return
    }
    // If it's the same node (by id), but data updated (different reference),
    // just sync content without animation
    if (selectedNode.id === displayedNode.id) {
      if (selectedNode !== displayedNode) {
        setDisplayedNode(selectedNode)
      }
      return
    }
    
    // Exit phase of current content
    setSwitchPhase('out')
    const outTimer = setTimeout(() => {
      // Change content to new
      setDisplayedNode(selectedNode)
      // Entrance phase of new content
      setSwitchPhase('in')
      setIsEntering(true)
      // Start smooth entrance from next frame
      if (typeof window !== 'undefined') {
        requestAnimationFrame(() => setIsEntering(false))
      } else {
        setIsEntering(false)
      }
      // Complete animation cycle
      const inTimer = setTimeout(() => {
        setSwitchPhase('idle')
      }, 200)
      return () => clearTimeout(inTimer)
    }, 160)
    return () => clearTimeout(outTimer)

      })()
    })
    return () => { cancelAnimationFrame(frame); cleanup?.() }
  }, [selectedNode, isVisible, displayedNode])

  // Handlers for vertical divider (left/right parts)
  const handleVerticalMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDraggingVertical(true)
    setStartX(e.clientX)
    setStartLeftWidth(leftPanelWidth)
  }, [leftPanelWidth])

  const handleVerticalMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingVertical) return
    const deltaX = e.clientX - startX
    const newWidth = Math.max(
      Math.floor(window.innerWidth * 0.3),
      Math.min(Math.floor(window.innerWidth * 0.5), startLeftWidth + deltaX) // Reduced from 0.55 to 0.5 (50%)
    )
    setLeftPanelWidth(newWidth)
    localStorage.setItem('nodeDetailsWindowLeftWidth', newWidth.toString())
  }, [isDraggingVertical, startX, startLeftWidth])

  const handleVerticalMouseUp = useCallback(() => {
    setIsDraggingVertical(false)
  }, [])

  // Handlers for horizontal divider (notes/map)
  const handleHorizontalMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDraggingHorizontal(true)
    setStartY(e.clientY)
    const container = document.getElementById('node-details-window-right')
    if (container) {
      const rect = container.getBoundingClientRect()
      const currentHeight = ((e.clientY - rect.top) / rect.height) * 100
      setStartRightTopHeight(currentHeight)
    }
  }, [])

  const handleHorizontalMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingHorizontal) return
    const container = document.getElementById('node-details-window-right')
    if (container) {
      const rect = container.getBoundingClientRect()
      const newHeight = ((e.clientY - rect.top) / rect.height) * 100
      // Limit from 10% to 55% (map always takes 45%)
      const clampedHeight = Math.max(10, Math.min(55, newHeight))
      setRightTopHeight(`${clampedHeight}%`)
      localStorage.setItem('nodeDetailsWindowRightTopHeight', `${clampedHeight}%`)
    }
  }, [isDraggingHorizontal])

  const handleHorizontalMouseUp = useCallback(() => {
    setIsDraggingHorizontal(false)
  }, [])

  // Global mouse handlers
  useEffect(() => {
    if (isDraggingVertical) {
      document.addEventListener('mousemove', handleVerticalMouseMove)
      document.addEventListener('mouseup', handleVerticalMouseUp)
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'ew-resize'
    } else if (isDraggingHorizontal) {
      document.addEventListener('mousemove', handleHorizontalMouseMove)
      document.addEventListener('mouseup', handleHorizontalMouseUp)
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'ns-resize'
    } else {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    return () => {
      document.removeEventListener('mousemove', handleVerticalMouseMove)
      document.removeEventListener('mouseup', handleVerticalMouseUp)
      document.removeEventListener('mousemove', handleHorizontalMouseMove)
      document.removeEventListener('mouseup', handleHorizontalMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isDraggingVertical, isDraggingHorizontal, handleVerticalMouseMove, handleVerticalMouseUp, handleHorizontalMouseMove, handleHorizontalMouseUp])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const minWidth = Math.floor(window.innerWidth * 0.3)
      const maxWidth = Math.floor(window.innerWidth * 0.5) // Reduced from 0.55 to 0.5 (50%)
      
      if (leftPanelWidth < minWidth) {
        setLeftPanelWidth(minWidth)
        localStorage.setItem('nodeDetailsWindowLeftWidth', minWidth.toString())
      } else if (leftPanelWidth > maxWidth) {
        setLeftPanelWidth(maxWidth)
        localStorage.setItem('nodeDetailsWindowLeftWidth', maxWidth.toString())
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [leftPanelWidth])

  // Calculate border color for left panel
  const getNodeBorderColor = useMemo(() => {
    if (!selectedNode) return "#9ca3af"
    
    const nodeType = selectedNode.type as any
    const status = selectedNode.data?.status || "idle"
    
    // If status is IDLE, use light gray color
    if (status === "idle") {
      return "#9ca3af" // gray-400
    }
    
    // Base color based on node type
    const baseColor = getPrimaryColor(nodeType)
    
    // Modify color based on status
    switch (status) {
      case "processing":
        return "#f59e0b" // amber-500
      case "done":
        return "#10b981" // emerald-500
      case "error":
        return "#ef4444" // red-500
      case "edited":
        return "#2563eb" // blue-600
      default:
        return baseColor || "#9ca3af"
    }
  }, [selectedNode])

  // Handler for window container click to close when clicking empty space
  const handleContainerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Ignore clicks during dragging
    if (isDraggingVertical || isDraggingHorizontal) return
    
    // Get click coordinates
    const clickX = e.clientX
    const clickY = e.clientY
    
    // Get container bounds
    const container = e.currentTarget
    const containerRect = container.getBoundingClientRect()
    
    // Get left panel bounds
    const leftPanelRight = containerRect.left + leftPanelWidth
    
    // Get right panel
    const rightPanel = document.getElementById('node-details-window-right')
    if (!rightPanel) {
      // If right panel not found, close when clicking to the right of left panel
      if (clickX > leftPanelRight) {
        onClose()
      }
      return
    }
    
    const rightPanelRect = rightPanel.getBoundingClientRect()
    const rightPanelLeft = rightPanelRect.left
    const rightPanelRight = rightPanelRect.right
    const rightPanelTop = rightPanelRect.top
    const rightPanelBottom = rightPanelRect.bottom
    
    // Calculate notes height in pixels
    // rightTopHeight can be a string like "55%" or "10%"
    const notesHeightPercent = parseFloat(rightTopHeight.replace('%', ''))
    const notesHeightPx = (rightPanelRect.height * notesHeightPercent) / 100
    
    // Calculate map height in pixels (45%)
    const mapHeightPx = (rightPanelRect.height * 45) / 100
    
    // Gap between notes and map (gap-2 = 0.5rem = 8px)
    const gap = 8
    
    // Top panel bounds (notes)
    const notesTop = rightPanelTop
    const notesBottom = rightPanelTop + notesHeightPx
    
    // Bottom panel bounds (map)
    const mapTop = rightPanelBottom - mapHeightPx
    const mapBottom = rightPanelBottom
    
    // Check if click is in left panel
    const isInLeftPanel = clickX >= containerRect.left && clickX <= leftPanelRight &&
                          clickY >= containerRect.top && clickY <= containerRect.bottom
    
    // Check if click is in right top panel (notes)
    const isInNotesPanel = clickX >= rightPanelLeft && clickX <= rightPanelRight &&
                           clickY >= notesTop && clickY <= notesBottom
    
    // Check if click is in right bottom panel (map)
    const isInMapPanel = clickX >= rightPanelLeft && clickX <= rightPanelRight &&
                         clickY >= mapTop && clickY <= mapBottom
    
    // If click doesn't hit any block, close panel
    if (!isInLeftPanel && !isInNotesPanel && !isInMapPanel) {
      onClose()
    }
  }, [isDraggingVertical, isDraggingHorizontal, leftPanelWidth, rightTopHeight, onClose])

  // Keep window in DOM during closing animation (isVisible=true for ~300ms)
  if (!selectedNode || !isVisible) {
    return null
  }

  // Right part always takes 45% width
  const rightPanelWidthPercent = 45
  
  // Calculate maximum width of right part accounting for margin
  const rightPanelMaxWidth = `calc(100% - ${leftPanelWidth}px - 8px)`
  
  // Map always takes 45% height of right part
  const mapHeight = '45%'
  // Notes height is adjustable from 10% to 55% of right part height
  const notesHeight = rightTopHeight

  return (
    <>
      {/* Overlay for background dimming */}
      <div
        className={`fixed inset-0 z-40 transition-all backdrop-blur-sm ${
          isAnimatingOut 
            ? "duration-[250ms] ease-[cubic-bezier(0.7,0,0.84,0)]" 
            : "duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
        } ${
          (isOpen && isVisible && !isAnimatingOut)
            ? (animateIn ? "opacity-100 bg-black/20" : "opacity-0 bg-black/0")
            : isAnimatingOut
            ? "opacity-0 bg-black/0"
            : "opacity-0 bg-black/0"
        }`}
        onClick={onClose}
      />
      
      {/* Window with padding and rounded corners */}
      <div
        data-node-details-window
        className={`fixed left-4 top-4 right-4 bottom-4 z-50 transform transition-opacity pointer-events-auto ${
          isAnimatingOut 
            ? "duration-[250ms] ease-[cubic-bezier(0.7,0,0.84,0)]" 
            : "duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
        } ${
          (isOpen && isVisible && !isAnimatingOut) ? "opacity-100" : isAnimatingOut ? "opacity-0" : "opacity-100"
        }`}
        onClick={handleContainerClick}
      >
        <div className="h-full w-full relative">
          {/* Left part - Details panel */}
          <div
            className={`h-full overflow-hidden bg-background border shadow-2xl rounded-xl relative transform transition-transform ${
              isAnimatingOut 
                ? "duration-[250ms] ease-[cubic-bezier(0.7,0,0.84,0)]" 
                : "duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
            } ${
              isOpen ? (animateIn ? 'translate-x-0' : '-translate-x-20') : '-translate-x-20'
            }`}
            style={{ 
              width: leftPanelWidth,
              willChange: 'transform',
              borderWidth: "3px",
              borderColor: getNodeBorderColor,
              boxShadow: `0 0 0 2px ${getNodeBorderColor}20, 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)`
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`h-full w-full transition-all ${
                switchPhase === 'out'
                  ? "duration-[180ms] ease-[cubic-bezier(0.7,0,0.84,0)] opacity-0 -translate-x-6 scale-95"
                  : switchPhase === 'in'
                  ? `duration-[200ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${isEntering ? "opacity-0 -translate-x-6 scale-95" : "opacity-100 translate-x-0 scale-100"}`
                  : "duration-[200ms] ease-[cubic-bezier(0.16,1,0.3,1)] opacity-100 translate-x-0 scale-100"
              }`}
              style={{ willChange: 'transform, opacity' }}
            >
              <NodeDetailsPanel
                selectedNode={displayedNode!}
                isOpen={true}
                onClose={onClose}
                allNodes={allNodes}
                allEdges={allEdges}
                onNodeUpdate={onNodeUpdate}
                onRun={onRun}
                onRestore={onRestore}
                onNavigateToNode={onNavigateToNode}
                embedded={true}
              />
            </div>
            
            {/* Resize Handle for left panel */}
            <div
              className="absolute right-0 top-0 bottom-0 w-1 bg-gray-300 cursor-ew-resize hover:bg-gray-400 transition-colors z-20"
              style={{
                background: 'repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)',
              }}
              onMouseDown={handleVerticalMouseDown}
            />
          </div>

          {/* Right part - Notes and Map (45% width, anchored to right edge with margin) */}
          <div
            id="node-details-window-right"
            className={`h-full flex flex-col gap-2 absolute top-0 transform transition-transform ${
              isAnimatingOut 
                ? "duration-[250ms] ease-[cubic-bezier(0.7,0,0.84,0)]" 
                : "duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
            } ${
              isOpen ? (animateIn ? 'translate-x-0' : 'translate-x-20') : 'translate-x-20'
            }`}
            style={{ 
              width: `${rightPanelWidthPercent}%`,
              maxWidth: rightPanelMaxWidth,
              right: '0',
              left: 'auto', // Explicitly indicate element is anchored to right edge
              willChange: 'transform'
            }}
          >
            {/* Top part - Notes (anchored to top right corner, adjustable 10-55% height) */}
            <div
              className="overflow-hidden bg-background border border-border shadow-2xl rounded-xl relative"
              style={{ 
                height: notesHeight,
                minHeight: '10%',
                maxHeight: '55%',
                borderWidth: "2px",
                flexShrink: 0,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className={`h-full w-full transition-all ${
                  switchPhase === 'out'
                    ? "duration-[180ms] ease-[cubic-bezier(0.7,0,0.84,0)] opacity-0 translate-x-6 scale-95"
                    : switchPhase === 'in'
                    ? `duration-[200ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${isEntering ? "opacity-0 translate-x-6 scale-95" : "opacity-100 translate-x-0 scale-100"}`
                    : "duration-[200ms] ease-[cubic-bezier(0.16,1,0.3,1)] opacity-100 translate-x-0 scale-100"
                }`}
                style={{ willChange: 'transform, opacity' }}
              >
                <NotesPanel
                  selectedNode={displayedNode!}
                  isOpen={true}
                  onClose={onClose}
                  embedded={true}
                  canvasId={canvasId}
                  onNodeUpdate={onNodeUpdate}
                />
              </div>
              
              {/* Resize Handle for notes (from top right corner) */}
              <div
                className="absolute left-0 right-0 bottom-0 h-1 bg-gray-300 cursor-ns-resize hover:bg-gray-400 transition-colors z-20"
                style={{
                  background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)',
                }}
                onMouseDown={handleHorizontalMouseDown}
              />
            </div>

            {/* Spacer to fill space between notes and map */}
            <div className="flex-1 min-h-0" />

            {/* Bottom part - Navigation map (anchored to bottom right corner, fixed 45% height) */}
            <div
              className="navigation-map-container overflow-hidden bg-background border border-border shadow-2xl rounded-xl"
              style={{ 
                height: mapHeight,
                borderWidth: "2px",
                flexShrink: 0,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className={`h-full w-full transition-all ${
                  switchPhase === 'out'
                    ? "duration-[180ms] ease-[cubic-bezier(0.7,0,0.84,0)] opacity-0 translate-x-6 scale-95"
                    : switchPhase === 'in'
                    ? `duration-[200ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${isEntering ? "opacity-0 translate-x-6 scale-95" : "opacity-100 translate-x-0 scale-100"}`
                    : "duration-[200ms] ease-[cubic-bezier(0.16,1,0.3,1)] opacity-100 translate-x-0 scale-100"
                }`}
                style={{ willChange: 'transform, opacity' }}
              >
                <NodeNavigationMap
                  selectedNode={displayedNode!}
                  allNodes={allNodes}
                  allEdges={allEdges}
                  onNavigateToNode={onNavigateToNode}
                  onFocusNode={onFocusNode}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

