import { useCallback, useRef, useState } from 'react'
import { Node, Edge } from 'reactflow'

interface HistorySnapshot {
  nodes: Array<{
    id: string
    type: string
    data: Node["data"]
    position: { x: number; y: number }
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
    type?: string
  }>
}

interface UseCanvasHistoryOptions {
  maxHistory?: number
  onLimitReached?: () => void
}

interface UseCanvasHistoryReturn {
  pushHistory: (nodes: Node[], edges: Edge[]) => void
  undo: (currentNodes: Node[], currentEdges: Edge[]) => HistorySnapshot | null
  redo: (currentNodes: Node[], currentEdges: Edge[]) => HistorySnapshot | null
  canUndo: boolean
  canRedo: boolean
  captureDragStart: (nodes: Node[], edges: Edge[]) => void
  commitDrag: () => void
  cancelDrag: () => void
}

function extractStructuralData(nodes: Node[], edges: Edge[]): HistorySnapshot {
  return {
    nodes: nodes.map(n => ({
      id: n.id,
      type: n.type || 'default',
      data: n.data,
      position: { x: n.position.x, y: n.position.y }
    })),
    edges: edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: e.type
    }))
  }
}

export function useCanvasHistory({
  maxHistory = 15,
  onLimitReached
}: UseCanvasHistoryOptions = {}): UseCanvasHistoryReturn {
  // Use refs for the actual stacks to avoid re-renders on every push
  const pastRef = useRef<HistorySnapshot[]>([])
  const futureRef = useRef<HistorySnapshot[]>([])
  const dragSnapshotRef = useRef<HistorySnapshot | null>(null)

  // State for reactive canUndo/canRedo
  const [historyState, setHistoryState] = useState({ pastLength: 0, futureLength: 0 })

  const updateHistoryState = useCallback(() => {
    setHistoryState({
      pastLength: pastRef.current.length,
      futureLength: futureRef.current.length
    })
  }, [])

  const pushHistory = useCallback((nodes: Node[], edges: Edge[]) => {
    const snapshot = extractStructuralData(nodes, edges)

    // Check if we're at the limit
    if (pastRef.current.length >= maxHistory) {
      pastRef.current.shift() // Remove oldest
      onLimitReached?.()
    }

    pastRef.current.push(snapshot)
    futureRef.current = [] // Clear redo stack on new action
    updateHistoryState()
  }, [maxHistory, onLimitReached, updateHistoryState])

  const undo = useCallback((currentNodes: Node[], currentEdges: Edge[]): HistorySnapshot | null => {
    if (pastRef.current.length === 0) return null

    const currentSnapshot = extractStructuralData(currentNodes, currentEdges)
    const previous = pastRef.current.pop()!
    futureRef.current.push(currentSnapshot)
    updateHistoryState()
    return previous
  }, [updateHistoryState])

  const redo = useCallback((currentNodes: Node[], currentEdges: Edge[]): HistorySnapshot | null => {
    if (futureRef.current.length === 0) return null

    const currentSnapshot = extractStructuralData(currentNodes, currentEdges)
    const next = futureRef.current.pop()!
    pastRef.current.push(currentSnapshot)
    updateHistoryState()
    return next
  }, [updateHistoryState])

  // Drag handling
  const captureDragStart = useCallback((nodes: Node[], edges: Edge[]) => {
    dragSnapshotRef.current = extractStructuralData(nodes, edges)
  }, [])

  const commitDrag = useCallback(() => {
    if (dragSnapshotRef.current) {
      // Check if we're at the limit
      if (pastRef.current.length >= maxHistory) {
        pastRef.current.shift()
        onLimitReached?.()
      }

      pastRef.current.push(dragSnapshotRef.current)
      futureRef.current = []
      dragSnapshotRef.current = null
      updateHistoryState()
    }
  }, [maxHistory, onLimitReached, updateHistoryState])

  const cancelDrag = useCallback(() => {
    dragSnapshotRef.current = null
  }, [])

  return {
    pushHistory,
    undo,
    redo,
    canUndo: historyState.pastLength > 0,
    canRedo: historyState.futureLength > 0,
    captureDragStart,
    commitDrag,
    cancelDrag
  }
}

export type { HistorySnapshot, UseCanvasHistoryOptions, UseCanvasHistoryReturn }
