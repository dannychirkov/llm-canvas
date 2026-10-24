import { useEffect, useCallback } from 'react'
import { Node, Edge } from 'reactflow'

export interface ClipboardData {
  nodes: Node[]
  edges: Edge[]
  timestamp: number
  sourceCanvas: string
}

export interface HotkeyCallbacks {
  onCopy: (nodes: Node[], edges: Edge[]) => void
  onPaste: () => void
  onCut: (nodes: Node[], edges: Edge[]) => void
  onDelete: (nodeIds: string[]) => void
  onDuplicate: (nodes: Node[]) => void
  onToggleHidden: (nodeIds: string[]) => void
  onToggleCollapse: (nodeIds: string[]) => void
  onMoveNodes: (nodeIds: string[], deltaX: number, deltaY: number) => void
  onZoomToSelected: () => void
  onZoomReset: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitView: () => void
  onZoomToLevel: (level: number) => void
  onDeselectAll: () => void
  onSelectAll: () => void
  onSave: () => void
  onRunNodes: (nodeIds: string[]) => void
  onUndo: () => void
  onRedo: () => void
}

export interface UseCanvasHotkeysProps {
  callbacks: HotkeyCallbacks
  selectedNodeIds: string[]
  allNodes: Node[]
  allEdges: Edge[]
  canvasId: string
  enabled?: boolean
}

const CLIPBOARD_KEY = 'llm-canvas-clipboard'

export function useCanvasHotkeys({
  callbacks,
  selectedNodeIds,
  allNodes,
  allEdges,
  canvasId,
  enabled = true
}: UseCanvasHotkeysProps) {
  
  // Platform detection
  const isMac = typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const ctrlKey = isMac ? 'metaKey' : 'ctrlKey'

  // Check if focus is on interactive element
  const isInteractiveElement = useCallback((target: EventTarget | null): boolean => {
    if (!target || !(target instanceof Element)) return false
    
    const interactiveSelectors = [
      'input',
      'textarea', 
      'select',
      '[contenteditable="true"]',
      '[data-nodrag]',
      '.react-flow__node input',
      '.react-flow__node textarea',
      '.react-flow__node select'
    ]
    
    return interactiveSelectors.some(selector => 
      target.matches(selector) || target.closest(selector)
    )
  }, [])

  // Check if target is inside node details window
  const isInsideNodeDetailsWindow = useCallback((target: EventTarget | null): boolean => {
    if (!target || !(target instanceof Element)) return false
    return target.closest('[data-node-details-window]') !== null
  }, [])

  // Copy nodes to clipboard
  const copyToClipboard = useCallback((nodes: Node[], edges: Edge[]) => {
    const clipboardData: ClipboardData = {
      nodes: nodes.map(node => ({ ...node })),
      edges: edges.filter(edge => 
        nodes.some(n => n.id === edge.source) && 
        nodes.some(n => n.id === edge.target)
      ),
      timestamp: Date.now(),
      sourceCanvas: canvasId
    }
    
    try {
      localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(clipboardData))
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }, [canvasId])

  // Paste nodes from clipboard
  const pasteFromClipboard = useCallback((): { nodes: Node[], edges: Edge[] } | null => {
    try {
      const clipboardData = localStorage.getItem(CLIPBOARD_KEY)
      if (!clipboardData) return null
      
      const data: ClipboardData = JSON.parse(clipboardData)
      
      // Generate new IDs for pasted nodes
      const idMap = new Map<string, string>()
      const newNodes = data.nodes.map(node => {
        const newId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        idMap.set(node.id, newId)
        
        // If node is done or edited, convert to idle but preserve prompt and response
        const nodeStatus = node.data?.status
        if (nodeStatus === 'done' || nodeStatus === 'edited') {
          return {
            ...node,
            id: newId,
            position: {
              x: node.position.x + 50, // Offset slightly
              y: node.position.y + 50
            },
            data: {
              ...node.data,
              status: 'idle',
              // Preserve prompt and response
              promptText: node.data?.promptText,
              responseText: node.data?.responseText,
              // Clear token-related fields to exclude from token count
              tokens: undefined,
              tokenBreakdown: undefined,
              // Clear execution-related fields
              lastExecutionState: undefined,
              rawResponse: undefined,
              structuredResponse: undefined,
              executionStartTime: undefined,
              debugInfo: undefined,
              error: undefined,
              isStreaming: false,
              streamingText: undefined
            }
          }
        }
        
        return {
          ...node,
          id: newId,
          position: {
            x: node.position.x + 50, // Offset slightly
            y: node.position.y + 50
          }
        }
      })
      
      // Update edge references with new IDs
      const newEdges = data.edges.map(edge => ({
        ...edge,
        id: `e${idMap.get(edge.source)}-${idMap.get(edge.target)}`,
        source: idMap.get(edge.source) || edge.source,
        target: idMap.get(edge.target) || edge.target
      }))
      
      return { nodes: newNodes, edges: newEdges }
    } catch (error) {
      console.error('Failed to paste from clipboard:', error)
      return null
    }
  }, [])

  // Get selected nodes
  const getSelectedNodes = useCallback((): Node[] => {
    return allNodes.filter(node => selectedNodeIds.includes(node.id))
  }, [allNodes, selectedNodeIds])

  // Get edges connected to selected nodes
  const getSelectedEdges = useCallback((): Edge[] => {
    return allEdges.filter(edge => 
      selectedNodeIds.includes(edge.source) || 
      selectedNodeIds.includes(edge.target)
    )
  }, [allEdges, selectedNodeIds])

  // Keyboard event handler
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled || isInteractiveElement(event.target)) {
      return
    }

    const { key, code, shiftKey, altKey, ctrlKey: ctrl, metaKey } = event
    const isCtrlOrCmd = isMac ? metaKey : ctrl

    // Select All (Ctrl/Cmd + A)
    if (isCtrlOrCmd && code === 'KeyA') {
      event.preventDefault()
      callbacks.onSelectAll()
      return
    }

    // Copy (Ctrl/Cmd + C)
    if (isCtrlOrCmd && code === 'KeyC' && selectedNodeIds.length > 0) {
      // Don't intercept if user is copying text from node details window
      if (isInsideNodeDetailsWindow(event.target)) {
        return
      }
      event.preventDefault()
      const selectedNodes = getSelectedNodes()
      const selectedEdges = getSelectedEdges()
      copyToClipboard(selectedNodes, selectedEdges)
      callbacks.onCopy(selectedNodes, selectedEdges)
      return
    }

    // Paste (Ctrl/Cmd + V)
    if (isCtrlOrCmd && code === 'KeyV') {
      // Don't intercept if user is pasting text in node details window
      if (isInsideNodeDetailsWindow(event.target)) {
        return
      }
      event.preventDefault()
      const clipboardData = pasteFromClipboard()
      if (clipboardData) {
        callbacks.onPaste()
      }
      return
    }

    // Cut (Ctrl/Cmd + X)
    if (isCtrlOrCmd && code === 'KeyX' && selectedNodeIds.length > 0) {
      // Don't intercept if user is cutting text from node details window
      if (isInsideNodeDetailsWindow(event.target)) {
        return
      }
      event.preventDefault()
      const selectedNodes = getSelectedNodes()
      const selectedEdges = getSelectedEdges()
      copyToClipboard(selectedNodes, selectedEdges)
      callbacks.onCut(selectedNodes, selectedEdges)
      return
    }

    // Delete/Backspace
    if ((key === 'Delete' || key === 'Backspace') && selectedNodeIds.length > 0) {
      event.preventDefault()
      callbacks.onDelete(selectedNodeIds)
      return
    }

    // Duplicate (Ctrl/Cmd + D)
    if (isCtrlOrCmd && code === 'KeyD' && selectedNodeIds.length > 0) {
      event.preventDefault()
      const selectedNodes = getSelectedNodes()
      callbacks.onDuplicate(selectedNodes)
      return
    }

    // Toggle Hidden (H)
    if (code === 'KeyH' && selectedNodeIds.length > 0) {
      event.preventDefault()
      callbacks.onToggleHidden(selectedNodeIds)
      return
    }

    // Toggle Collapse (Q)
    if (code === 'KeyQ' && selectedNodeIds.length > 0) {
      event.preventDefault()
      callbacks.onToggleCollapse(selectedNodeIds)
      return
    }

    // Arrow keys for node movement
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key) && selectedNodeIds.length > 0) {
      event.preventDefault()
      const step = shiftKey ? 100 : 20 // 5 grid units or 1 grid unit
      let deltaX = 0
      let deltaY = 0
      
      switch (key) {
        case 'ArrowUp':
          deltaY = -step
          break
        case 'ArrowDown':
          deltaY = step
          break
        case 'ArrowLeft':
          deltaX = -step
          break
        case 'ArrowRight':
          deltaX = step
          break
      }
      
      callbacks.onMoveNodes(selectedNodeIds, deltaX, deltaY)
      return
    }

    // Zoom to selected node (Z) or fit view if no selection
    if (code === 'KeyZ') {
      event.preventDefault()
      if (selectedNodeIds.length > 0) {
        callbacks.onZoomToSelected()
      } else {
        callbacks.onFitView()
      }
      return
    }

    // Zoom controls
    if (isCtrlOrCmd) {
      switch (code) {
        case 'Digit0':
        case 'Numpad0':
          event.preventDefault()
          callbacks.onZoomReset()
          return
        case 'Equal':
        case 'NumpadAdd':
          event.preventDefault()
          callbacks.onZoomIn()
          return
        case 'Minus':
        case 'NumpadSubtract':
          event.preventDefault()
          callbacks.onZoomOut()
          return
      }
    }

    // Fit view (F)
    if (code === 'KeyF') {
      event.preventDefault()
      callbacks.onFitView()
      return
    }

    // Fixed zoom levels (1, 2, 3)
    if (['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].includes(code)) {
      event.preventDefault()
      const levels = { 
        'Digit1': 0.5, 'Numpad1': 0.5,
        'Digit2': 1, 'Numpad2': 1,
        'Digit3': 2, 'Numpad3': 2
      }
      callbacks.onZoomToLevel(levels[code as keyof typeof levels])
      return
    }

    // Save (Ctrl/Cmd + S)
    if (isCtrlOrCmd && code === 'KeyS') {
      event.preventDefault()
      callbacks.onSave()
      return
    }

    // Undo (Ctrl/Cmd + Z) - without Shift
    if (isCtrlOrCmd && code === 'KeyZ' && !shiftKey) {
      event.preventDefault()
      callbacks.onUndo()
      return
    }

    // Redo (Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z)
    if (isCtrlOrCmd && (code === 'KeyY' || (code === 'KeyZ' && shiftKey))) {
      event.preventDefault()
      callbacks.onRedo()
      return
    }

    // Escape - deselect all
    if (key === 'Escape') {
      event.preventDefault()
      callbacks.onDeselectAll()
      return
    }

    // Run selected nodes (Space)
    if ((key === ' ' || code === 'Space') && selectedNodeIds.length > 0) {
      event.preventDefault()
      callbacks.onRunNodes(selectedNodeIds)
      return
    }
  }, [
    enabled,
    isInteractiveElement,
    isInsideNodeDetailsWindow,
    isMac,
    selectedNodeIds,
    getSelectedNodes,
    getSelectedEdges,
    copyToClipboard,
    pasteFromClipboard,
    callbacks
  ])

  // Set up event listener
  useEffect(() => {
    if (!enabled) return

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown, enabled])

  return {
    copyToClipboard,
    pasteFromClipboard
  }
}
