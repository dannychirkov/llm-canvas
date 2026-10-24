"use client"

import { aggregateNodeUsage, nodeOperator, usageTotal } from "@/lib/tokenUsage"
import { compactCanvasDocument, debugPreview } from "@/lib/debugPayload"
import { patchExecutionNode } from "@/lib/nodeExecutionState"
import { runSelectedGraph, type ExecutionGraph } from "@/lib/selectedExecution"
import { getNanoAutoMode } from "@/lib/nanoContextMode"
import { persistentCanvasEdges } from "@/lib/canvasConnections"
import type { ProviderId, CredentialProviderId } from "@/lib/providers/registry"


import { useState, useCallback, useRef, useMemo, useEffect } from "react"
import { flushSync } from "react-dom"
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  Connection,
  type OnConnectStart,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  MiniMap,
  ReactFlowProvider,
  ReactFlowInstance,
  useReactFlow,
} from "reactflow"
import "reactflow/dist/style.css"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Save, Plus, ArrowLeft, LayoutGrid, Search, Layers, Activity, Upload } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { useRouter } from "next/navigation"
import CanvasLoading from "./CanvasLoading"
// Node components are imported via createNodeTypes
import { canvasNodeTypes, CanvasNodeActionsContext } from "./nodeTypes"
import NodeTypeMenu from "./nodes/NodeTypeMenu"
import NodeContextMenu from "./nodes/NodeContextMenu"
import EdgeContextMenu from "./edges/EdgeContextMenu"
import NodeDetailsPanel from "./NodeDetailsPanel"
import NotesPanel from "./NotesPanel"
import NodeDetailsWindow from "./NodeDetailsWindow"
import { useSettings } from "@/components/providers/SettingsProvider"
import RemovableEdge from "./edges/RemovableEdge"
import { Toast } from "@/components/ui/toast"
import { useCanvasHotkeys, type HotkeyCallbacks } from "@/hooks/useCanvasHotkeys"
import HotkeysPanel from "./HotkeysPanel"
import UnsavedChangesDialog from "./UnsavedChangesDialog"
import { getPrimaryColor } from "./nodes/colors"
import { getNodeTypeIcon } from "./nodes/NodeTypeIcon"
import { autoLayoutNodes } from "@/lib/layoutUtils"
import CanvasSearchModal from "./CanvasSearchModal"
import { useCanvasSearch } from "@/hooks/useCanvasSearch"
import SelectionBox from "./SelectionBox"
import { trackNodeAdded, trackNodeDeleted, trackNodeEdited } from "@/lib/analytics"
import TokenStatisticsDialog from "./TokenStatisticsDialog"
import type { LLMNodeData, NanoBananaData } from "@/types"
import { MAX_IMAGE_OR_CSV_SIZE, MAX_VIDEO_SIZE } from "@/lib/storageConstants"
import { useCanvasHistory } from "@/hooks/useCanvasHistory"
import { Undo2, Redo2 } from "lucide-react"

// Constants for snap grid
const GRID_SIZE = 20
const SNAP_GRID = [GRID_SIZE, GRID_SIZE]

interface CanvasEditorProps {
  canvasId: string
  canvasTitle: string
  initialUpdatedAt: string
  initialData?: {
    nodes?: Node[]
    edges?: Edge[]
  } | null
}

function CanvasEditorComponent({ canvasId, canvasTitle, initialData, initialUpdatedAt }: CanvasEditorProps) {
  const router = useRouter()
  const settings = useSettings()
  const [isInitializing, setIsInitializing] = useState(true)
  
  // Memoize initial nodes (collapsed state comes from DB)
  const initialNodes = useMemo(() => {
    const nodes = initialData?.nodes || [
      {
        id: "1",
        type: "default",
        position: { x: 250, y: 25 },
        data: { label: "Welcome to your canvas!" },
      },
    ]

    // Add canvasId to MediaNodes and zIndex to NotesNodes
    return nodes.map(node => {
      if (node.type === 'media') {
        return {
          ...node,
          data: {
            ...node.data,
            canvasId: canvasId
          }
        }
      }
      if (node.type === 'notes') {
        return {
          ...node,
          zIndex: -1,
        }
      }
      return node
    })
  }, [initialData?.nodes, canvasId])

  // Extract metadata from initialData and save to localStorage as fallback
  useEffect(() => {
    if (initialData && typeof initialData === 'object' && 'metadata' in initialData) {
      const metadata = (initialData as any).metadata
      if (metadata?.lastUsedModels) {
        try {
          const key = `lastUsedModels_${canvasId}`
          // Update localStorage only if no data exists (localStorage has priority for incomplete sessions)
          const existing = localStorage.getItem(key)
          if (!existing) {
            localStorage.setItem(key, JSON.stringify(metadata.lastUsedModels))
          } else {
            // Merge data, priority to existing in localStorage
            const existingData = JSON.parse(existing)
            const merged = { ...metadata.lastUsedModels, ...existingData }
            localStorage.setItem(key, JSON.stringify(merged))
          }
        } catch (error) {
          console.warn('Failed to sync metadata to localStorage:', error)
        }
      }
    }
  }, [initialData, canvasId])
  
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const initialEdges = useMemo(() => persistentCanvasEdges(initialNodes, initialData?.edges || []), [initialNodes, initialData?.edges])
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Undo/Redo history management
  const isDraggingRef = useRef(false)
  const historyLimitReachedRef = useRef(false)
  const {
    pushHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    captureDragStart,
    commitDrag,
    cancelDrag
  } = useCanvasHistory({
    maxHistory: 15,
    onLimitReached: () => { historyLimitReachedRef.current = true }
  })

  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  
  // ReactFlow hook for programmatic control
  const { fitBounds, setCenter, zoomIn, zoomOut, zoomTo, getViewport } = useReactFlow()
  const [isAddNodeMenuOpen, setIsAddNodeMenuOpen] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const lastSavedSnapshotRef = useRef<string>("")
  const revisionRef = useRef(initialUpdatedAt)
  const savingRef = useRef(false)
  const isInitializedRef = useRef<boolean>(false)
  const nodesRef = useRef<Node[]>(initialNodes)
  const edgesRef = useRef<Edge[]>(initialData?.edges || [])

  useEffect(() => {
    const handleNotesSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ canvasId: string; nodeId: string; notes: string; updatedAt: string; baseUpdatedAt: string }>).detail
      if (!detail || detail.canvasId !== canvasId || detail.baseUpdatedAt !== revisionRef.current || savingRef.current) return
      const saved = lastSavedSnapshotRef.current ? JSON.parse(lastSavedSnapshotRef.current) as { nodes: Node[]; edges: Edge[] } : null
      const original = saved?.nodes.find(node => node.id === detail.nodeId)
      const current = nodesRef.current.find(node => node.id === detail.nodeId)
      if (!current || current.data?.notes !== original?.data?.notes) return
      revisionRef.current = detail.updatedAt
      if (saved) {
        saved.nodes = saved.nodes.map(node => node.id === detail.nodeId ? { ...node, data: { ...node.data, notes: detail.notes } } : node)
        lastSavedSnapshotRef.current = JSON.stringify(saved)
      }
      setNodes(previous => previous.map(node => node.id === detail.nodeId ? { ...node, data: { ...node.data, notes: detail.notes } } : node))
    }
    window.addEventListener("canvas-notes-updated", handleNotesSaved)
    return () => window.removeEventListener("canvas-notes-updated", handleNotesSaved)
  }, [canvasId, setNodes])
  
  // Unsaved changes dialog state
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null)

  // Node context menu state
  const [ctxOpen, setCtxOpen] = useState(false)
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [ctxNodeId, setCtxNodeId] = useState<string | null>(null)

  // Canvas context menu state
  const [canvasCtxOpen, setCanvasCtxOpen] = useState(false)
  const [canvasCtxPos, setCanvasCtxPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [canvasCtxClickPos, setCanvasCtxClickPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  // Edge context menu state
  const [edgeCtxOpen, setEdgeCtxOpen] = useState(false)
  const [edgeCtxPos, setEdgeCtxPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [edgeCtxEdgeId, setEdgeCtxEdgeId] = useState<string | null>(null)

  // Canvas search state
  const [searchModalOpen, setSearchModalOpen] = useState(false)
  const [tokenStatsOpen, setTokenStatsOpen] = useState(false)
  const [canvasTotalTokensUsed, setCanvasTotalTokensUsed] = useState<number | null>(null)
  
  // File drag and drop state
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [dragFilePosition, setDragFilePosition] = useState<{ x: number; y: number } | null>(null)
  
  // Handle drag context menu state
  const [handleMenuOpen, setHandleMenuOpen] = useState(false)
  const [handleMenuPos, setHandleMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [handleMenuEndPos, setHandleMenuEndPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [handleMenuSourceNode, setHandleMenuSourceNode] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [temporaryEdge, setTemporaryEdge] = useState<Edge | null>(null)
  const [connectionSuccessful, setConnectionSuccessful] = useState(false)
  const connectionSuccessfulRef = useRef(false)

  // Ref for storing current viewport animation ID
  const animationFrameRef = useRef<number | null>(null)

  // Cleanup: cancel pending animation on component unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [])

  // Node details panel state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isNodeDetailsOpen, setIsNodeDetailsOpen] = useState(false)
  
  // Get current node by ID
  const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null
  
  // Notes panel state
  const [notesNodeId, setNotesNodeId] = useState<string | null>(null)
  const [isNotesPanelOpen, setIsNotesPanelOpen] = useState(false)
  
  // Get current notes node by ID
  const notesNode = notesNodeId ? nodes.find(n => n.id === notesNodeId) : null
  
  // Selected nodes state for visual highlighting
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])

  // Initial selection before drag (for proper rollback when moving mouse back)
  const [initialSelectionBeforeDrag, setInitialSelectionBeforeDrag] = useState<string[]>([])

  // Mouse position state for insertion
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null)
  
  // Selection box state
  const [selectionBox, setSelectionBox] = useState<{
    startX: number
    startY: number
    currentX: number
    currentY: number
    isActive: boolean
  } | null>(null)
  
  // Flag to track drag selection completion
  const [justFinishedDragSelection, setJustFinishedDragSelection] = useState(false)
  
  // Toast notification state
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  // Function to show toast notification
  const showToast = useCallback((message: string) => {
    setToastMessage(message)
  }, [])

  // Default dimensions by node type for selection accuracy
  const getDefaultDimensionsForType = useCallback((nodeType: string | undefined): { width: number; height: number } => {
    const defaults: Record<string, { width: number; height: number }> = {
      memory: { width: 320, height: 200 },
      text: { width: 320, height: 150 },
      notes: { width: 300, height: 150 },
      summarizer: { width: 360, height: 200 },
      gemini: { width: 340, height: 200 },
      openai: { width: 340, height: 200 },
      openrouter: { width: 340, height: 200 },
      nanobanana: { width: 340, height: 200 },
      media: { width: 320, height: 200 },
    }
    return defaults[nodeType || ''] || { width: 400, height: 300 }
  }, [])

  // Selection box logic with prioritized dimension sources for accuracy at different zoom levels
  const isNodeInSelectionBox = useCallback((
    node: Node,
    box: { startX: number; startY: number; currentX: number; currentY: number }
  ) => {
    const left = Math.min(box.startX, box.currentX)
    const top = Math.min(box.startY, box.currentY)
    const right = Math.max(box.startX, box.currentX)
    const bottom = Math.max(box.startY, box.currentY)

    // Priority 1: Use React Flow measured dimensions (already in flow coordinates)
    // These are set automatically by React Flow after node renders
    let nodeWidth = node.width
    let nodeHeight = node.height

    // Priority 2: Check node.data for stored dimensions (NotesNode stores width/height there)
    if (!nodeWidth || !nodeHeight) {
      nodeWidth = nodeWidth || node.data?.width
      nodeHeight = nodeHeight || node.data?.height
    }

    // Priority 3: Fall back to DOM measurement with zoom correction
    if (!nodeWidth || !nodeHeight) {
      const nodeElement = document.querySelector(`[data-id="${node.id}"]`)
      if (nodeElement && reactFlowInstance) {
        const rect = nodeElement.getBoundingClientRect()
        const viewport = reactFlowInstance.getViewport()
        nodeWidth = nodeWidth || rect.width / viewport.zoom
        nodeHeight = nodeHeight || rect.height / viewport.zoom
      }
    }

    // Priority 4: Use type-based defaults
    if (!nodeWidth || !nodeHeight) {
      const defaults = getDefaultDimensionsForType(node.type)
      nodeWidth = nodeWidth || defaults.width
      nodeHeight = nodeHeight || defaults.height
    }

    const nodeLeft = node.position.x
    const nodeTop = node.position.y
    const nodeRight = nodeLeft + nodeWidth
    const nodeBottom = nodeTop + nodeHeight

    // Always use intersection mode (node intersects with selection box)
    return !(nodeRight < left || nodeLeft > right || nodeBottom < top || nodeTop > bottom)
  }, [reactFlowInstance, getDefaultDimensionsForType])

  const updateSelectionFromBox = useCallback((box: typeof selectionBox, isCtrlSelection = false) => {
    if (!box || !box.isActive) return

    // Get IDs of nodes currently inside the selection box
    const nodesInBox = nodes
      .filter(node => isNodeInSelectionBox(node, box))
      .map(node => node.id)

    if (isCtrlSelection) {
      // Additive mode with proper rollback:
      // Final selection = initial selection (before drag) + nodes currently in box
      // This allows proper deselection when moving mouse backwards
      const initialSet = new Set(initialSelectionBeforeDrag)
      const inBoxSet = new Set(nodesInBox)

      // Combine: keep initial selection + add nodes in current box
      const combined = new Set([...initialSelectionBeforeDrag, ...nodesInBox])
      setSelectedNodeIds(Array.from(combined))
    } else {
      // Replace mode: only nodes in current box are selected
      setSelectedNodeIds(nodesInBox)
    }
  }, [nodes, isNodeInSelectionBox, initialSelectionBeforeDrag])

  // Memoize defaultViewport
  const defaultViewport = useMemo(() => ({ x: 0, y: 0, zoom: 1 }), [])

  const totalTokens = useMemo(() => nodes.reduce((sum, node) => node.data?.status === "done" ? sum + usageTotal(node.data.tokens, node.data.tokenBreakdown, nodeOperator(node) ?? undefined) : sum, 0), [nodes])

  const aggregateTokenStatistics = useMemo(() => aggregateNodeUsage(nodes), [nodes])

  // Capture initial graph snapshot after initialization completes
  // Set initial snapshot only once, after initialization completes
  useEffect(() => {
    // Wait for initialization to complete and ensure we have valid data
    if (!isInitializing && !isInitializedRef.current) {
      // Use a small delay to allow React Flow to fully initialize
      // Increased delay for Docker environments where rendering might be slower
      const timer = setTimeout(() => {
        // Ensure we capture snapshot even if nodes/edges arrays are empty
        const initialSnapshot = JSON.stringify({ nodes, edges })
        lastSavedSnapshotRef.current = initialSnapshot
        isInitializedRef.current = true
        setIsDirty(false)
      }, 500) // Increased from 200ms to 500ms for Docker compatibility
      
      return () => clearTimeout(timer)
    }
  }, [isInitializing, nodes, edges])

  // Initialize editor and refresh settings on mount
  useEffect(() => {
    let isMounted = true
    let initTimer: NodeJS.Timeout | null = null
    let fallbackTimer: NodeJS.Timeout | null = null
    
    const initializeEditor = async () => {
      try {
        // Refresh settings when opening canvas (non-blocking)
        // Don't wait for settings to load - we can initialize the editor independently
        if (settings.loaded) {
          settings.refresh().catch((error) => {
            console.error('Failed to refresh settings:', error)
          })
        }
      } catch (error) {
        console.error('Error initializing editor:', error)
      } finally {
        // Initialize the editor after a short delay to show loading state
        // Use a longer delay in Docker environments where things might be slower
        if (isMounted) {
          initTimer = setTimeout(() => {
            if (isMounted) {
              setIsInitializing(false)
            }
          }, 500) // Increased from 300ms to 500ms for Docker compatibility
        }
        
        // Fallback: Force initialization after 3 seconds maximum to prevent infinite loading
        // This ensures the editor always loads even if something goes wrong
        if (isMounted) {
          fallbackTimer = setTimeout(() => {
            if (isMounted) {
              console.warn('CanvasEditor: Force completing initialization after timeout')
              setIsInitializing(false)
            }
          }, 3000)
        }
      }
    }
    
    initializeEditor()
    
    return () => {
      isMounted = false
      if (initTimer) {
        clearTimeout(initTimer)
      }
      if (fallbackTimer) {
        clearTimeout(fallbackTimer)
      }
    }
  }, []) // Remove settings dependency - initialize once on mount

  // Load total tokens used on canvas
  useEffect(() => {
    const abortController = new AbortController()
    let timeoutId: NodeJS.Timeout | null = null

    const loadCanvasTotalTokens = async () => {
      try {
        // Set a timeout for the fetch request (10 seconds)
        const fetchPromise = fetch(`/api/canvases/${canvasId}`, {
          signal: abortController.signal
        })
        
        timeoutId = setTimeout(() => {
          abortController.abort()
          console.warn('Canvas tokens fetch timeout after 10s')
        }, 10000)
        
        const response = await fetchPromise
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        
        if (response.ok) {
          const data = await response.json()
          setCanvasTotalTokensUsed(data.totalTokensUsed ?? null)
        }
      } catch (error) {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Failed to load canvas total tokens:', error)
        }
        // Don't block initialization if this fails
      }
    }
    loadCanvasTotalTokens()

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      abortController.abort()
    }
  }, [canvasId])

  // Subscribe to settings changes
  useEffect(() => {
    const handleSettingsUpdate = () => {
      if (settings.loaded) {
        settings.refresh().catch(console.error)
      }
    }

    window.addEventListener('settingsUpdated', handleSettingsUpdate)
    return () => window.removeEventListener('settingsUpdated', handleSettingsUpdate)
  }, [settings])

  // Update unsaved changes flag on any graph change
  // BUT only if initial snapshot has been set
  useEffect(() => {
    // Skip check if initialization is not yet complete
    if (!isInitializedRef.current || lastSavedSnapshotRef.current === "") return
    
    const currentSnapshot = JSON.stringify({ nodes, edges })
    const dirty = currentSnapshot !== lastSavedSnapshotRef.current
    setIsDirty(dirty)
    if (dirty && isSaved) {
      setIsSaved(false)
    }
    // Keep current reference to nodes and edges for stable runNode
    nodesRef.current = nodes
    edgesRef.current = edges
  }, [nodes, edges, isSaved])

  // Browser navigation protection
  useEffect(() => {
    if (!isDirty) return
    
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  // Update node data by id
  const onNodeUpdate = useCallback((nodeId: string, patch: Record<string, unknown>) => {
    // Track node editing (but not for status updates or streaming)
    const isContentUpdate = patch.title || patch.value || patch.promptText || patch.content
    if (isContentUpdate) {
      const node = nodes.find(n => n.id === nodeId)
      if (node) {
        trackNodeEdited({
          node_id: nodeId,
          node_type: node.type,
          canvas_id: canvasId
        })
      }
    }
    
    setNodes((prev) => prev.map((n) => {
      if (n.id !== nodeId) return n
      return patchExecutionNode(n, patch)
    }))
  }, [setNodes, nodes, canvasId])

  // Stable reference to onNodeUpdate for use in uploadFileToMediaNode
  // This breaks the dependency chain and prevents frequent recreations
  const onNodeUpdateRef = useRef(onNodeUpdate)
  useEffect(() => {
    onNodeUpdateRef.current = onNodeUpdate
  }, [onNodeUpdate])

  // Restore node to last execution state
  const onRestore = useCallback((nodeId: string) => {
    setNodes((prev) => prev.map((n) => {
      if (n.id !== nodeId) return n
      const prevData = n.data || {}
      const snap = prevData.lastExecutionState || null
      
      if (!snap) return n // No snapshot to restore from
      
      // Restore all fields from lastExecutionState and explicitly clear error/streaming fields
      const restored: Record<string, unknown> = {
        ...prevData,
        promptText: snap.promptText ?? prevData.promptText,
        summaryText: snap.summaryText ?? prevData.summaryText,
        textContent: snap.textContent ?? prevData.textContent,
        modelName: snap.modelName ?? prevData.modelName,
        provider: snap.provider ?? prevData.provider,
        endpointId: snap.endpointId ?? prevData.endpointId,
        mode: snap.mode ?? prevData.mode,
        imageResponseFormat: snap.imageResponseFormat ?? prevData.imageResponseFormat,
        temperature: snap.temperature,
        max_tokens: snap.max_tokens,
        top_p: snap.top_p,
        seed: snap.seed,
        responseText: snap.responseText ?? prevData.responseText,
        generatedImage: snap.generatedImage,
        tokens: snap.tokens ?? prevData.tokens,
        tokenBreakdown: snap.tokenBreakdown ?? prevData.tokenBreakdown,
        usageSource: snap.usageSource ?? prevData.usageSource,
        summaryLength: snap.summaryLength ?? prevData.summaryLength,
        summaryStyle: snap.summaryStyle ?? prevData.summaryStyle,
        autoStrategy: snap.autoStrategy ?? prevData.autoStrategy,
        contextWindow: snap.contextWindow ?? prevData.contextWindow,
        textLength: snap.textLength ?? prevData.textLength,
        status: "done", // Restore to done status
        // Explicitly clear error and streaming-related fields
        error: undefined,
        isStreaming: false,
        streamingText: undefined
      }
      
      return { ...n, data: restored }
    }))
  }, [setNodes])

  // Update nodes with selection state based on selectedNodeIds
  const nodesWithSelection = useMemo(() => {
    return nodes.map(node => ({
      ...node,
      selected: selectedNodeIds.includes(node.id)
    }))
  }, [nodes, selectedNodeIds])

  // Remove global event handlers - they conflict with normal node operation
  // ReactFlow handles events itself through data-nodrag attributes

  // Function to save last used model
  const saveLastUsedModel = useCallback((provider: CredentialProviderId, modelName: string) => {
    try {
      const key = `lastUsedModels_${canvasId}`
      const stored = localStorage.getItem(key)
      const lastUsedModels = stored ? JSON.parse(stored) : {}
      lastUsedModels[provider] = modelName
      localStorage.setItem(key, JSON.stringify(lastUsedModels))
    } catch (error) {
      console.warn('Failed to save last used model:', error)
    }
  }, [canvasId])

  // Function to get last used model
  const getLastUsedModel = useCallback((provider: CredentialProviderId): string | null => {
    try {
      // Priority 1: localStorage (for session updates)
      const key = `lastUsedModels_${canvasId}`
      const stored = localStorage.getItem(key)
      if (stored) {
        const lastUsedModels = JSON.parse(stored)
        if (lastUsedModels[provider]) {
          return lastUsedModels[provider]
        }
      }
      
      // Priority 2: content.metadata.lastUsedModels (if canvas loaded from DB)
      if (initialData && typeof initialData === 'object') {
        const data = initialData as any
        if (data.metadata?.lastUsedModels?.[provider]) {
          return data.metadata.lastUsedModels[provider]
        }
      }
    } catch (error) {
      console.warn('Failed to get last used model:', error)
      return null
    }
    return null
  }, [canvasId, initialData])

  // Initialize node data by type (UI-only)
  // Defined before onDrop to be available in dependencies
  const getInitialData = useCallback((t: string) => {
    const getModelForProvider = (provider: CredentialProviderId) => {
      // Priority 1: last used model on this canvas
      const lastUsed = getLastUsedModel(provider)
      if (lastUsed) {
        const p = settings.providers[provider]
        // Check that model is still available
        if (p?.activeModels?.includes(lastUsed)) {
          return lastUsed
        }
      }
      
      // Priority 2: first available model
      const p = settings.providers[provider]
      return p?.hasKey && p?.activeModels?.length ? p.activeModels[0] : ""
    }
    switch (t) {
      case "text":
        return { title: "Text", textContent: "", isCollapsed: false }
      case "summarizer":
        return { title: "Summarizer", provider: "", modelName: "", isCollapsed: false }
      case "gemini":
        return { title: "Gemini", modelName: getModelForProvider("gemini"), promptText: "", isCollapsed: false }
      case "custom":
        return { title: "Custom endpoint", endpointId: settings.customEndpoints[0]?.id || "", modelName: settings.customEndpoints[0]?.models[0] || "", mode: settings.customEndpoints[0]?.apiType === "comfyui" ? "image-generation" : "chat", promptText: "", isCollapsed: false }
      case "openai":
        return { title: "OpenAI", modelName: getModelForProvider("openai"), promptText: "", isCollapsed: false }
      case "openrouter":
        return { title: "OpenRouter", modelName: getModelForProvider("openrouter"), promptText: "", isCollapsed: false }
      case "nanobanana":
        return { title: "Nano Banana", mode: "text-to-image", promptText: "", isCollapsed: false }
      case "media":
        return { title: "Media", url: "", caption: "", canvasId: canvasId, isCollapsed: false }
      case "memory":
        return { title: "Memory", key: "", value: "", scope: "", isCollapsed: false }
      case "notes":
        return { title: "Notes", notes: "", color: "#fef3c7", collapsed: false, isCollapsed: false }
      default:
        return { title: "Text", textContent: "", isCollapsed: false }
    }
  }, [settings, getLastUsedModel, canvasId])

  const activeRunsRef = useRef(new Set<string>())

  // Execute using live context, or the coherent private graph of a selected batch.
  const runNode = useCallback(async (nodeId: string, graph?: ExecutionGraph) => {
    const readNodes = () => graph?.nodes ?? nodesRef.current
    const readEdges = () => graph?.edges ?? edgesRef.current
    const updateNode = (id: string, patch: Record<string, unknown>) => {
      if (graph) graph.nodes = graph.nodes.map(n => n.id === id ? patchExecutionNode(n, patch) : n)
      onNodeUpdate(id, patch)
    }
    const source = readNodes().find((n) => n.id === nodeId)
    if (!source) return
    if (activeRunsRef.current.has(nodeId)) {
      if (graph) graph.nodes = graph.nodes.map(n => n.id === nodeId ? patchExecutionNode(n, { status: "error" }) : n)
      showToast("This node is already running. Wait for it to finish before running it again.")
      return
    }
    const node = source.type === "nanobanana"
      ? { ...source, data: { ...source.data, mode: getNanoAutoMode(nodeId, readNodes(), readEdges()) } }
      : source

    // Clear previous responseText and error BEFORE context assembly
    // so old response or error don't get into new request
    const executionStartTime = Date.now()
    let partialResponse = ""
    updateNode(nodeId, {
      ...(node.type === "nanobanana" ? { mode: node.data.mode } : {}),
      status: "processing", 
      executionStartTime,
      responseText: "",
      error: undefined,
      isStreaming: false,
      streamingText: "",
    })

    // Determine provider by node type
    const typeToProvider: Record<string, ProviderId | undefined> = {
      openai: "openai",
      gemini: "gemini",
      openrouter: "openrouter",
      nanobanana: "nanobanana",
      custom: "custom",
    }
    let provider: ProviderId | undefined = typeToProvider[node.type || ""]
    // For generic nodes like summarizer, provider can be set in data.provider
    if (!provider && (node.data as LLMNodeData)?.provider) {
      const p = String((node.data as LLMNodeData).provider).toLowerCase()
      if (p === "openai" || p === "gemini" || p === "openrouter" || p === "custom") provider = p
    }

    activeRunsRef.current.add(nodeId)
    try {
      if (!provider) {
        throw new Error("Provider is not specified for this node")
      }

      // For Nano Banana use Gemini API key
      const actualProvider = provider === "nanobanana" ? "gemini" : provider
      
      // Special logic for summarizer
      if (node.type === "summarizer") {
        // Assemble context for summarizer
        // Create temporary copy of nodes with cleared responseText for target node,
        // so old response doesn't get into context
        const nodesForContext = readNodes().map(n =>
          n.id === nodeId 
            ? { ...n, data: { ...n.data, responseText: "", error: undefined } }
            : n
        )
        const { assembleContextWithMedia } = await import("@/lib/contextService")
        
        const contextResult = await assembleContextWithMedia(nodeId, nodesForContext, readEdges())
        
        if (!contextResult.text?.trim()) {
          throw new Error("No text found to summarize")
        }

        // Use new API for smart summarizer
        const smartSummarizerPayload = {
          provider: actualProvider,
          canvasId,
          endpointId: node.data?.endpointId,
          modelName: node.data?.modelName,
          text: contextResult.text,
          summaryLength: node.data?.summaryLength || "medium",
          summaryStyle: node.data?.summaryStyle || "key-ideas",
          temperature: node.data?.temperature,
          top_p: node.data?.top_p,
          max_tokens: node.data?.max_tokens,
          seed: node.data?.seed,
        }

        // Create request payload for debug (without API key)
        const requestPayloadForDebug = debugPreview(smartSummarizerPayload)
        const requestTimestamp = Date.now()

        // Start streaming (responseText already cleared above)
        updateNode(nodeId, {
          status: "processing",
          isStreaming: true,
          streamingText: "",
          rawResponse: undefined,
          structuredResponse: undefined,
          debugInfo: {
            provider: actualProvider,
            model: node.data?.modelName,
            requestPayload: requestPayloadForDebug,
            requestTimestamp,
            status: "pending",
          },
        })

        const res = await fetch(`/api/canvas/smart-summarizer-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(smartSummarizerPayload),
        })

        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          throw new Error(errText || "Smart summarizer execution failed")
        }

        const reader = res.body?.getReader()
        if (!reader) {
          throw new Error("No response body")
        }

        let fullResponse = ""
        let tokens = 0
        let strategy = ""
        let contextWindow = 0
        let textLength = 0
        let receivedDone = false

        try {
          const decoder = new TextDecoder('utf-8')
          let buffer = ""

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ""

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6)
                try {
                  const parsed = JSON.parse(data)
                  
                  if (parsed.error) {
                    if (typeof parsed.canvasTotalTokensUsed === "number") setCanvasTotalTokensUsed(previous => Math.max(previous ?? 0, parsed.canvasTotalTokensUsed))
                    updateNode(nodeId, { tokens: parsed.partialUsageTokens, tokenBreakdown: parsed.tokenBreakdown, usageSource: parsed.usageSource })
                    updateNode(nodeId, {
                      status: "error",
                      isStreaming: false,
                      streamingText: "",
                      responseText: parsed.error,
                      error: parsed.error
                    })
                    throw new Error(parsed.error)
                  }

                  if (parsed.type === 'strategy') {
                    strategy = parsed.strategy
                    contextWindow = parsed.contextWindow
                    textLength = parsed.textLength
                    
                    updateNode(nodeId, {
                      autoStrategy: strategy,
                      contextWindow: contextWindow,
                      textLength: textLength
                    })
                  }

                  if (parsed.type === 'progress') {
                    // Update progress (can add progress indicator)
                  }

                  if (parsed.type === 'content') {
                    fullResponse += parsed.content
                    partialResponse = fullResponse
                    
                    updateNode(nodeId, {
                      isStreaming: true,
                      streamingText: fullResponse,
                    })
                  }

                  if (parsed.type === 'done') {
                    if (typeof parsed.responseText === "string") fullResponse = parsed.responseText
                    partialResponse = fullResponse
                    receivedDone = true
                    tokens = parsed.tokens ?? tokens
                    strategy = parsed.strategy || strategy
                    contextWindow = parsed.contextWindow || contextWindow
                    textLength = parsed.textLength || textLength

                    // Capture snapshot of inputs used for execution
                    const current = readNodes().find((n) => n.id === nodeId)
                    const d = current?.data || {}
                    const lastExecutionState = {
                      tokens: parsed.tokens,
                      tokenBreakdown: parsed.tokenBreakdown,
                      usageSource: parsed.usageSource,
                      summaryLength: node.data?.summaryLength,
                      summaryStyle: node.data?.summaryStyle,
                      modelName: node.data?.modelName,
                      endpointId: node.data?.endpointId,
                      provider: node.data?.provider,
                      temperature: node.data?.temperature,
                      max_tokens: node.data?.max_tokens,
                      top_p: node.data?.top_p,
                      seed: node.data?.seed,
                      responseText: fullResponse, // Save responseText to track changes
                      autoStrategy: strategy,
                      contextWindow: contextWindow,
                      textLength: textLength
                    }

                    // Save last used model
                    if (actualProvider && node.data?.modelName && (actualProvider === "openai" || actualProvider === "gemini" || actualProvider === "openrouter")) {
                      saveLastUsedModel(actualProvider, node.data?.modelName as string)
                    }

                    // Create structured response for Debug panel
                    const responseTimestamp = Date.now()
                    const requestStartedAt =
                      (d.debugInfo && typeof d.debugInfo.requestTimestamp === "number"
                        ? d.debugInfo.requestTimestamp
                        : d.executionStartTime) || responseTimestamp
                    const latencyMs = responseTimestamp - requestStartedAt

                    const structuredResponse = {
                      execution: {
                        provider: actualProvider,
                        model: node.data?.modelName,
                        timestamp: new Date().toISOString(),
                        executionTime: latencyMs,
                        strategy: strategy
                      },
                      parameters: {
                        summaryLength: node.data?.summaryLength,
                        summaryStyle: node.data?.summaryStyle,
                        temperature: node.data?.temperature,
                        max_tokens: node.data?.max_tokens,
                        top_p: node.data?.top_p,
                        seed: node.data?.seed
                      },
                      input: {
                        textLength: textLength,
                        contextWindow: contextWindow
                      },
                      output: {
                        response: fullResponse,
                        tokens: tokens,
                        responseLength: fullResponse.length
                      }
                    }

                    updateNode(nodeId, {
                      status: "done",
                      isStreaming: false,
                      streamingText: "",
                      responseText: fullResponse,
                      tokens,
                      summaryText: undefined,
                      tokenBreakdown: parsed.tokenBreakdown,
                      usageSource: parsed.usageSource,
                      executionId: parsed.executionId,
                      autoStrategy: strategy,
                      contextWindow: contextWindow,
                      textLength: textLength,
                      lastExecutionState,
                      rawResponse: JSON.stringify(parsed, null, 2),
                      structuredResponse: JSON.stringify(structuredResponse, null, 2),
                      debugInfo: {
                        provider: actualProvider,
                        model: node.data?.modelName,
                        requestPayload: d.debugInfo?.requestPayload || requestPayloadForDebug,
                        requestTimestamp: requestStartedAt,
                        responseTimestamp,
                        latencyMs,
                        status: "success",
                      },
                    })

                    if (typeof parsed.canvasTotalTokensUsed === "number") setCanvasTotalTokensUsed(previous => Math.max(previous ?? 0, parsed.canvasTotalTokensUsed))

                  }
                } catch (parseError) {
                  if (!(parseError instanceof SyntaxError)) throw parseError
                }
              }
            }
          }
        } finally {
          reader.releaseLock()

          if (!receivedDone) updateNode(nodeId, { status: "error", isStreaming: false, streamingText: "", responseText: fullResponse, error: "Provider stream ended before completion; partial output was not counted as a completed run" })

        }

        return // Finish execution for summarizer
      }

      // Assemble context on frontend with multimodal support
      // Create temporary copy of nodes with cleared responseText for target node,
      // so old response doesn't get into context
      const nodesForContext = readNodes().map(n =>
        n.id === nodeId 
          ? { ...n, data: { ...n.data, responseText: "", error: undefined } }
          : n
      )
      const { assembleContextWithMedia } = await import("@/lib/contextService")
      
      // Use nodesForContext with cleared responseText for target node
      const contextResult = await assembleContextWithMedia(nodeId, nodesForContext, readEdges())
      const promptText = node.data?.promptText || ""
      
      // Target node is never included in context (responseText cleared above)
      // Always add target node's promptText to context of previous nodes  
      // Form final prompt: context of previous nodes + target node's promptText
      const finalPrompt = contextResult.text 
        ? `${contextResult.text}\n\n${promptText}` 
        : promptText

      // Prepare simplified payload with ready prompt, images and CSV data
      const payload = {
        provider,
        endpointId: node.data?.endpointId,
        finalPrompt,
        images: contextResult.images, // Add images
        csvFiles: contextResult.csvFiles, // Add CSV files
        videos: contextResult.videos,
        modelName: node.data?.modelName,
        temperature: node.data?.temperature,
        max_tokens: node.data?.max_tokens,
        top_p: node.data?.top_p,
        seed: node.data?.seed,
        // Nano Banana specific fields
        mode: node.data?.mode,
        imageResponseFormat: node.data?.imageResponseFormat,
        canvasId: canvasId,
        // Gemini specific fields
        useTools: node.data?.useTools,
      }
      const requestPayloadForDebug = debugPreview(payload)
      const requestTimestamp = Date.now()



      // Start streaming (responseText already cleared above)
      updateNode(nodeId, {
        status: "processing",
        isStreaming: true,
        streamingText: "",
        rawResponse: undefined,
        structuredResponse: undefined,
        debugInfo: {
          provider: actualProvider,
          model: node.data?.modelName,
          requestPayload: requestPayloadForDebug,
          requestTimestamp,
          status: "pending",
        },
      })

      const res = await fetch(`/api/canvas/execute-node-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => "")
        throw new Error(errText || "Execution failed")
      }

      const reader = res.body?.getReader()
      if (!reader) {
        throw new Error("No response body")
      }

      let fullResponse = ""
      let tokens = 0
      let generatedImage: { url: string; mediaId: string; width: number; height: number } | null = null

      try {
        // Create TextDecoder once for entire stream with explicit UTF-8 specification
        const decoder = new TextDecoder('utf-8')
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          // Use the same decoder for entire stream
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              try {
                const parsed = JSON.parse(data)
                
                if (parsed.error) {
                  if (typeof parsed.canvasTotalTokensUsed === "number") setCanvasTotalTokensUsed(previous => Math.max(previous ?? 0, parsed.canvasTotalTokensUsed))
                  updateNode(nodeId, { tokens: parsed.partialUsageTokens, tokenBreakdown: parsed.tokenBreakdown, usageSource: parsed.usageSource })
                  // Update node with error
                  const current = readNodes().find((n) => n.id === nodeId)
                  const existingDebugInfo = current?.data?.debugInfo || {}
                  const errorTimestamp = Date.now()
                  updateNode(nodeId, {
                    status: "error",
                    isStreaming: false,
                    streamingText: "",
                    responseText: parsed.error,
                    error: parsed.error,
                    debugInfo: {
                      ...existingDebugInfo,
                      status: "error",
                      responseTimestamp: errorTimestamp,
                      latencyMs: typeof existingDebugInfo.requestTimestamp === "number"
                        ? errorTimestamp - existingDebugInfo.requestTimestamp
                        : existingDebugInfo.latencyMs,
                    },
                  })
                  throw new Error(parsed.error)
                }

                if (parsed.content) {
                  fullResponse += parsed.content
                  partialResponse = fullResponse
                  // Don't update tokens from intermediate chunks, only from final response
                  // tokens is only used for progress display, final value will come in parsed.done
                  
                  updateNode(nodeId, {
                    isStreaming: true,
                    streamingText: fullResponse,
                    // Don't pass tokens here to avoid overwriting with intermediate values
                  })
                }

                if (parsed.done) {
                  if (typeof parsed.fullResponse === "string") fullResponse = parsed.fullResponse
                  else if (typeof parsed.responseText === "string") fullResponse = parsed.responseText
                  partialResponse = fullResponse
                  // Capture snapshot of inputs used for execution to support EDITED detection
                  const current = readNodes().find((n) => n.id === nodeId)
                  const d = current?.data || {}
                  const lastExecutionState = {
                    tokens: usageTotal(parsed.tokens, parsed.tokenBreakdown, provider),
                    tokenBreakdown: parsed.tokenBreakdown,
                    usageSource: parsed.usageSource,
                    generatedImage: parsed.generatedImages?.[0] ?? parsed.generatedImage,
                    imageResponseFormat: provider === "custom" || provider === "nanobanana" ? node.data?.imageResponseFormat ?? "auto" : node.data?.imageResponseFormat,
                    promptText: node.data?.promptText,
                    modelName: node.data?.modelName,
                    endpointId: node.data?.endpointId,
                    mode: provider === "custom" ? node.data?.mode ?? "chat" : provider === "nanobanana" ? node.data?.mode ?? "text-to-image" : node.data?.mode,
                    temperature: node.data?.temperature,
                    max_tokens: node.data?.max_tokens,
                    top_p: node.data?.top_p,
                    seed: node.data?.seed,
                    responseText: fullResponse, // Save responseText to track changes
                    finalPrompt, // Save assembled finalPrompt for Debug Inspector
                    requestPayload: d.debugInfo?.requestPayload || requestPayloadForDebug,
                  }

                  // Calculate final token usage: priority parsed.tokens (total) > sum of all tokenBreakdown fields
                  // Use total tokens (including cached) for consistency
                  const finalTokens = usageTotal(parsed.tokens, parsed.tokenBreakdown, actualProvider)

                  // Create structured final response for Debug panel
                  const structuredResponse = {
                    execution: {
                      provider: actualProvider,
                      model: d.modelName,
                      timestamp: new Date().toISOString(),
                      executionTime: Date.now() - (d.executionStartTime || Date.now())
                    },
                    parameters: {
                      temperature: d.temperature,
                      max_tokens: d.max_tokens,
                      top_p: d.top_p,
                      seed: d.seed
                    },
                    input: {
                      finalPrompt: finalPrompt,
                      promptLength: finalPrompt.length,
                      contextNodes: 0, // contextResult doesn't have nodes property
                      hasImages: contextResult.images?.length > 0,
                      hasCsvFiles: contextResult.csvFiles?.length > 0
                    },
                    output: {
                      response: fullResponse,
                      tokens: finalTokens,
                      responseLength: fullResponse.length
                    },
                    rawApiResponse: parsed.rawResponse || ""
                  }

                  const rawApiResponse =
                    typeof parsed.rawResponse === "string"
                      ? parsed.rawResponse
                      : parsed.rawResponse
                      ? JSON.stringify(parsed.rawResponse)
                      : ""
                  const responseTimestamp = Date.now()
                  const requestStartedAt =
                    (d.debugInfo && typeof d.debugInfo.requestTimestamp === "number"
                      ? d.debugInfo.requestTimestamp
                      : d.executionStartTime) || responseTimestamp
                  const latencyMs = responseTimestamp - requestStartedAt

                  // Save last used model
                  if (actualProvider && d.modelName && (actualProvider === "openai" || actualProvider === "gemini" || actualProvider === "openrouter")) {
                    saveLastUsedModel(actualProvider, d.modelName as string)
                  }

                  // Update total tokens used on canvas (cumulative)
                  if (typeof parsed.canvasTotalTokensUsed === "number") setCanvasTotalTokensUsed(previous => Math.max(previous ?? 0, parsed.canvasTotalTokensUsed))

                  const updateData: Record<string, unknown> = {
                    generatedImage: undefined,
                    responseText: fullResponse,
                    tokens: finalTokens,
                    tokenBreakdown: parsed.tokenBreakdown,
                    usageSource: parsed.usageSource,
                    executionId: parsed.executionId,
                    groundingMetadata: parsed.groundingMetadata,
                    rawResponse: rawApiResponse,
                    structuredResponse: JSON.stringify(structuredResponse, null, 2),
                    status: "done",
                    isStreaming: false,
                    streamingText: "",
                    lastExecutionState,
                    debugInfo: {
                      provider: actualProvider,
                      model: d.modelName,
                      requestPayload: d.debugInfo?.requestPayload || requestPayloadForDebug,
                      providerRequestPayload: parsed.providerRequestPayload || d.debugInfo?.providerRequestPayload,
                      requestTimestamp: requestStartedAt,
                      responseTimestamp,
                      latencyMs,
                      status: "success",
                    },
                  }

                  // Handle both old single image format and new multiple images format
                  if (parsed.generatedImages && Array.isArray(parsed.generatedImages)) {
                    // New format: multiple images array
                    generatedImage = parsed.generatedImages[0] // Use first image for now
                    updateData.generatedImage = generatedImage
                  } else if (parsed.generatedImage) {
                    // Old format: single image (backward compatibility)
                    generatedImage = parsed.generatedImage
                    updateData.generatedImage = generatedImage
                  }
                  
                  // Add to iteration history for iterative mode (works for both formats)
                  if (generatedImage && d.mode === "iterative") {
                    const newIteration = {
                      url: generatedImage.url,
                      mediaId: generatedImage.mediaId,
                      prompt: finalPrompt,
                      timestamp: Date.now()
                    }
                    updateData.iterationHistory = [...(d.iterationHistory || []), newIteration]
                  }

                  updateNode(nodeId, updateData)
                  return
                }
              } catch (e) {
                // Ignore invalid JSON
                if (!(e instanceof SyntaxError)) throw e
              }
            }
          }
        }
        
        throw new Error("Provider stream ended before completion")
      } finally {
        reader.releaseLock()
      }
    } catch (e: unknown) {
      const current = readNodes().find((n) => n.id === nodeId)
      const existingDebugInfo = current?.data?.debugInfo || {}
      const errorTimestamp = Date.now()
      updateNode(nodeId, {
        status: "error",
        isStreaming: false,
        responseText: partialResponse,
        error: e instanceof Error ? e.message : "Execution failed",
        debugInfo: {
          ...existingDebugInfo,
          status: "error",
          responseTimestamp: errorTimestamp,
          latencyMs: typeof existingDebugInfo.requestTimestamp === "number"
            ? errorTimestamp - existingDebugInfo.requestTimestamp
            : existingDebugInfo.latencyMs,
        },
      })
    } finally {
      activeRunsRef.current.delete(nodeId)
    }
  }, [onNodeUpdate, saveLastUsedModel, showToast])

  const onNodeSelect = useCallback((nodeId: string) => setSelectedNodeIds([nodeId]), [])
  const nodeActions = useMemo(() => ({ onNodeUpdate, runNode, onRestore, onNodeSelect }), [onNodeUpdate, runNode, onRestore, onNodeSelect])

  const onConnect = useCallback(
    (params: Connection) => {
      pushHistory(nodes, persistentCanvasEdges(nodes, edges))
      setEdges((eds) => addEdge({ ...params, type: 'removable' } as Connection, persistentCanvasEdges(nodes, eds)))
      setTemporaryEdge(null)
      setConnectionSuccessful(true)
      connectionSuccessfulRef.current = true
    },
    [setEdges, nodes, edges, pushHistory]
  )

  // Context menu on right click on node
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault()
    setCtxNodeId(node.id)
    setCtxPos({ x: event.clientX, y: event.clientY })
    setCtxOpen(true)
  }, [])

  // Context menu on right click on edge
  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault()
    setEdgeCtxEdgeId(edge.id)
    setEdgeCtxPos({ x: event.clientX, y: event.clientY })
    setEdgeCtxOpen(true)
  }, [])

  // Handle single click on node for visual selection
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    // Check that click is not on interactive element inside node
    const target = event.target as Element
    const isInteractive = target.closest('select, textarea, input, button, [data-nodrag]')
    
    if (isInteractive) {
      // Don't handle click on interactive elements
      return
    }
    
    // Use built-in ReactFlow logic for selection
    setSelectedNodeIds([node.id])
  }, [])

  // Handle click on empty space to clear selection
  const onPaneClick = useCallback((event: React.MouseEvent) => {
    // Check that click is actually on empty space, not on node
    const target = event.target as Element
    const isNode = target.closest('.react-flow__node')
    const isUIElement = target.closest('button, .floating-action-panel, .react-flow__controls')
    
    // Don't clear selection if we just finished a drag selection
    if (justFinishedDragSelection) {
      return
    }
    
    if (!isNode && !isUIElement) {
      setSelectedNodeIds([])
    }
  }, [justFinishedDragSelection])

  // Selection box mouse handlers
  const onPaneMouseDown = useCallback((event: React.MouseEvent) => {
    // Only start selection box on left mouse button
    if (event.button !== 0) return
    
    // Don't start new selection if we just finished one
    if (justFinishedDragSelection) return
    
    // Check if clicking on empty space (not on node or UI element)
    const target = event.target as Element
    const isNode = target.closest('.react-flow__node')
    const isUIElement = target.closest('button, .floating-action-panel, .react-flow__controls')
    
    if (isNode || isUIElement) return
    
    // Don't start selection if we're connecting edges
    if (isConnecting) return
    
    if (!reactFlowInstance || !reactFlowWrapper.current) return
    
    const bounds = reactFlowWrapper.current.getBoundingClientRect()
    const position = reactFlowInstance.screenToFlowPosition({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    })
    
    // Save current selection as initial state for this drag operation
    // This allows proper rollback when moving mouse backwards
    setInitialSelectionBeforeDrag(selectedNodeIds)

    // If Ctrl/Cmd is not pressed, clear existing selection
    if (!event.ctrlKey && !event.metaKey) {
      setSelectedNodeIds([])
    }

    setSelectionBox({
      startX: position.x,
      startY: position.y,
      currentX: position.x,
      currentY: position.y,
      isActive: true
    })
  }, [reactFlowInstance, isConnecting, justFinishedDragSelection, selectedNodeIds])

  const onPaneMouseMove = useCallback((event: React.MouseEvent) => {
    if (!selectionBox || !selectionBox.isActive || !reactFlowInstance || !reactFlowWrapper.current) return
    
    const bounds = reactFlowWrapper.current.getBoundingClientRect()
    const position = reactFlowInstance.screenToFlowPosition({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    })
    
    const newBox = {
      ...selectionBox,
      currentX: position.x,
      currentY: position.y
    }
    
    setSelectionBox(newBox)
    updateSelectionFromBox(newBox, event.ctrlKey || event.metaKey)
  }, [selectionBox, reactFlowInstance, updateSelectionFromBox])

  const onPaneMouseUp = useCallback((event: React.MouseEvent) => {
    if (selectionBox && selectionBox.isActive) {
      // Finalize the selection and keep it
      updateSelectionFromBox(selectionBox, event.ctrlKey || event.metaKey)
      setSelectionBox(null)
      // Clear initial selection state after drag is complete
      setInitialSelectionBeforeDrag([])
      setJustFinishedDragSelection(true)

      // Reset the flag after a short delay to allow onPaneClick to check it
      setTimeout(() => {
        setJustFinishedDragSelection(false)
      }, 10)
    }
  }, [selectionBox, updateSelectionFromBox])

  // Handle right click on canvas
  const onPaneContextMenu = useCallback((event: React.MouseEvent) => {
    // Check that click is not on + button or other UI elements
    const target = event.target as Element
    const isUIElement = target.closest('button, .floating-action-panel, .react-flow__controls')
    
    if (isUIElement) {
      return // Don't show context menu for UI elements
    }
    
    event.preventDefault()
    if (!reactFlowInstance || !reactFlowWrapper.current) return
    
    const bounds = reactFlowWrapper.current.getBoundingClientRect()
    const position = reactFlowInstance.project({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    })
    
    setCanvasCtxClickPos(position)
    setCanvasCtxPos({ x: event.clientX, y: event.clientY })
    setCanvasCtxOpen(true)
  }, [reactFlowInstance])

  // Handle connection drag start
  const onConnectStart = useCallback<OnConnectStart>((event, { nodeId, handleType, handleId }) => {
    if (!nodeId || !handleType) return
    
    setHandleMenuSourceNode(nodeId)
    setIsConnecting(true)
    setConnectionSuccessful(false) // Reset successful connection flag
    connectionSuccessfulRef.current = false
    
    // Create temporary connection
    const tempEdge: Edge = {
      id: 'temp-edge',
      source: handleType === "target" ? "temp-source" : nodeId,
      sourceHandle: handleType === "target" ? null : handleId,
      target: handleType === "target" ? nodeId : "temp-target",
      targetHandle: handleType === "target" ? handleId : null,
      type: 'removable',
      animated: true,
      style: { stroke: '#d3d3d3', strokeDasharray: '5,5' }
    }
    setTemporaryEdge(tempEdge)
  }, [])

  // Handle connection drag end
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    setIsConnecting(false)
    if (!reactFlowInstance || !reactFlowWrapper.current || !handleMenuSourceNode) return
    
    // Show menu only if connection was not successful (ended on empty area)
    if (!connectionSuccessfulRef.current) {
      const bounds = reactFlowWrapper.current.getBoundingClientRect()
      const clientX = 'changedTouches' in event ? event.changedTouches[0]?.clientX : event.clientX
      const clientY = 'changedTouches' in event ? event.changedTouches[0]?.clientY : event.clientY
      
      if (clientX !== undefined && clientY !== undefined) {
        const position = reactFlowInstance.project({
          x: clientX - bounds.left,
          y: clientY - bounds.top,
        })
        
        setHandleMenuEndPos(position)
        setHandleMenuPos({ x: clientX, y: clientY })
        setHandleMenuOpen(true)
      }
    } else {
      setTemporaryEdge(null)
      setHandleMenuSourceNode(null)
    }
    
    // Reset successful connection flag for next time
    setConnectionSuccessful(false)
    connectionSuccessfulRef.current = false
  }, [reactFlowInstance, handleMenuSourceNode, connectionSuccessful])

  // Handle double click on node to open details and notes panels
  const onNodeDoubleClick = useCallback((event: React.MouseEvent, node: Node) => {
    // Check that double click is not on interactive element inside node
    const target = event.target as Element
    const isInteractive = target.closest('select, textarea, input, button, [data-nodrag]')
    
    if (isInteractive) {
      // Don't handle double click on interactive elements
      return
    }
    
    // Check that node supports details panel
    const isSupportedNode = node.type === 'summarizer' ||
                           node.type === 'gemini' ||
                           node.type === 'custom' ||
                           node.type === 'openai' ||
                           node.type === 'openrouter' ||
                           node.type === 'nanobanana' ||
                           node.type === 'media' ||
                           node.type === 'text'
    
    if (isSupportedNode) {
      // Open details panel on the left
      setSelectedNodeId(node.id)
      setIsNodeDetailsOpen(true)
      
      // Simultaneously open notes panel on the right for the same node
      setNotesNodeId(node.id)
      setIsNotesPanelOpen(true)
    }
  }, [])

  // Close node details panel (closes both panels)
  const onCloseNodeDetails = useCallback(() => {
    // First trigger closing animation
    setIsNodeDetailsOpen(false)
    setIsNotesPanelOpen(false)
    // Keep selected IDs a bit longer so animation can complete
    const timeout = setTimeout(() => {
      setSelectedNodeId(null)
      setNotesNodeId(null)
    }, 320)
    // In case of quick unmount
    return () => clearTimeout(timeout)
  }, [])

  // Close notes panel (closes both panels)
  const onCloseNotesPanel = useCallback(() => {
    // First trigger closing animation
    setIsNotesPanelOpen(false)
    setIsNodeDetailsOpen(false)
    // Keep selected IDs a bit longer so animation can complete
    const timeout = setTimeout(() => {
      setNotesNodeId(null)
      setSelectedNodeId(null)
    }, 320)
    // In case of quick unmount
    return () => clearTimeout(timeout)
  }, [])


  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    
    // Check for files (more reliable check)
    const types = Array.from(event.dataTransfer.types)
    const hasFiles = types.includes('Files') || types.some(type => type === 'application/x-moz-file' || type.startsWith('Files'))
    
    if (hasFiles && reactFlowInstance && reactFlowWrapper.current) {
      // Calculate cursor position in ReactFlow coordinates
      const bounds = reactFlowWrapper.current.getBoundingClientRect()
      const position = reactFlowInstance.project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      })
      
      // Apply snap to grid
      const snappedPosition = {
        x: Math.round(position.x / GRID_SIZE) * GRID_SIZE,
        y: Math.round(position.y / GRID_SIZE) * GRID_SIZE,
      }
      
      setDragFilePosition(snappedPosition)
      setIsDraggingFile(true)
      event.dataTransfer.dropEffect = "copy"
    } else {
      // Existing logic for nodes from menu
      event.dataTransfer.dropEffect = "move"
    }
  }, [reactFlowInstance])

  const onDragLeave = useCallback((event: React.DragEvent) => {
    // Check that we actually left canvas area
    const relatedTarget = event.relatedTarget as HTMLElement | null
    if (!reactFlowWrapper.current || !relatedTarget || !reactFlowWrapper.current.contains(relatedTarget)) {
      setIsDraggingFile(false)
      setDragFilePosition(null)
    }
  }, [])

  // Function to upload file to media node
  const uploadFileToMediaNode = useCallback(async (nodeId: string, file: File) => {
    try {
      // Determine file type and select corresponding limit
      const isVideo = file.type.startsWith('video/')
      const isImage = file.type.startsWith('image/')
      const isCSV = file.type === 'text/csv' || 
                    file.type === 'application/csv' || 
                    file.name.toLowerCase().endsWith('.csv')
      
      // Select limit depending on file type
      const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_OR_CSV_SIZE
      const maxSizeMB = maxSize / (1024 * 1024)
      
      // Validate file size
      if (file.size > maxSize) {
        showToast(`File size exceeds ${maxSizeMB}MB limit`)
        onNodeUpdateRef.current(nodeId, { 
          status: 'error',
          error: `File too large (max ${maxSizeMB}MB)` 
        })
        return
      }

      // Show loading state
      onNodeUpdateRef.current(nodeId, { 
        status: 'processing',
        loadingMessage: 'Uploading file...' 
      })

      const formData = new FormData()
      formData.append('file', file)
      formData.append('canvasId', canvasId)

      const response = await fetch('/api/media/upload', {
        method: 'POST',
        body: formData,
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('Upload failed:', errorText)
        throw new Error(`Upload failed: ${errorText}`)
      }

      const result = await response.json()
      
      const isCsvFile = file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')
      const isImageFile = file.type.startsWith('image/')
      const videoData = result.mimeType?.startsWith('video/')

      // Update media node data after successful upload
      onNodeUpdateRef.current(nodeId, {
        // Clear loading state and error
        status: 'done',
        loadingMessage: undefined,
        error: undefined,
        
        // Main media fields
        mediaId: result.mediaId,
        filePath: result.filePath,
        filename: result.filename,
        mimeType: result.mimeType,
        fileSize: result.fileSize,
        width: result.width,
        height: result.height,
        url: result.filePath, // For backward compatibility
        
        // CSV specific fields
        csvData: result.csvData,
        csvRows: result.csvRows,
        csvColumns: result.csvColumns,
        
        // Video specific fields
        durationMs: result.durationMs,
        frameRate: result.frameRate,
        frameCount: result.frameCount,
        videoFrames: result.videoFrames,
        thumbnailPath: result.thumbnailPath,
        videoFilePath: result.filePath,
        videoMimeType: videoData ? result.mimeType : undefined,
        videoFileSize: videoData ? result.fileSize : undefined,
        
        // Media type flags
        isVideo: videoData,
        isImage: !videoData && isImageFile,
        isCsv: isCsvFile
      })
      
      // Trigger node resize through ReactFlow's internal mechanism
      // Force ReactFlow to recalculate node dimensions by updating the node
      setNodes(nds => nds.map(n => {
        if (n.id === nodeId) {
          // Create a new object reference to trigger ReactFlow's dimension recalculation
          return { ...n, data: { ...n.data } }
        }
        return n
      }))
    } catch (error) {
      console.error('Upload failed:', error)
      showToast(`Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`)
      onNodeUpdateRef.current(nodeId, { 
        status: 'error',
        error: `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        loadingMessage: undefined
      })
    }
  }, [canvasId, showToast, setNodes])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect()
      
      // Check for files
      if (event.dataTransfer.files.length > 0) {
        // Reset states
        setIsDraggingFile(false)
        setDragFilePosition(null)
        
        if (!reactFlowInstance || !reactFlowBounds) {
          return
        }
        
        // Warn user if multiple files were dropped
        if (event.dataTransfer.files.length > 1) {
          showToast(`Multiple files detected. Only the first file (${event.dataTransfer.files[0].name}) will be processed.`)
        }
        
        const file = event.dataTransfer.files[0]
        
        // Check file type
        const isCsvFile = file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')
        const isImageFile = file.type.startsWith('image/')
        const isVideoFile = file.type.startsWith('video/')
        
        if (!isImageFile && !isVideoFile && !isCsvFile) {
          showToast('Please drop an image, video, or CSV file')
          return
        }
        
        // Calculate drop position
        const position = reactFlowInstance.project({
          x: event.clientX - reactFlowBounds.left,
          y: event.clientY - reactFlowBounds.top,
        })
        
        // Snap to grid
        const snappedPosition = {
          x: Math.round(position.x / GRID_SIZE) * GRID_SIZE,
          y: Math.round(position.y / GRID_SIZE) * GRID_SIZE,
        }
        
        // Create new media node
        const newNodeId = crypto.randomUUID()
        setNodes((nds) => nds.concat({
          id: newNodeId,
          type: 'media',
          position: snappedPosition,
          data: getInitialData('media'),
        }))
        
        // Immediately start file upload
        uploadFileToMediaNode(newNodeId, file)
        
        return
      }
      
      // Existing logic for dragging nodes from menu
      const type = event.dataTransfer.getData("application/reactflow")

      if (typeof type === "undefined" || !type || !reactFlowInstance || !reactFlowBounds) {
        return
      }

      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      })

      // Snap to grid
      const snappedPosition = {
        x: Math.round(position.x / GRID_SIZE) * GRID_SIZE,
        y: Math.round(position.y / GRID_SIZE) * GRID_SIZE,
      }

      const knownTypes = new Set(["text","summarizer","gemini","openai","openrouter","nanobanana","media","memory","notes"])
      const nodeType = knownTypes.has(type) ? type : "text"

      setNodes((nds) => nds.concat({
        id: crypto.randomUUID(),
        type: nodeType,
        position: snappedPosition,
        data: getInitialData(nodeType),
        ...(nodeType === 'notes' ? { zIndex: -1 } : {}),
      }))
    },
    [reactFlowInstance, setNodes, getInitialData, uploadFileToMediaNode, showToast]
  )

  const createNodeAtCenter = useCallback((nodeType: string) => {
    if (!reactFlowInstance || !reactFlowWrapper.current) return
    const bounds = reactFlowWrapper.current.getBoundingClientRect()
    const position = reactFlowInstance.project({
      x: bounds.width / 2,
      y: bounds.height / 2,
    })
    const snappedPosition = {
      x: Math.round(position.x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(position.y / GRID_SIZE) * GRID_SIZE,
    }
    pushHistory(nodes, edges)
    setNodes((nds) => nds.concat({
      id: crypto.randomUUID(),
      type: nodeType,
      position: snappedPosition,
      data: getInitialData(nodeType),
      ...(nodeType === 'notes' ? { zIndex: -1 } : {}),
    }))
  }, [reactFlowInstance, getInitialData, setNodes, nodes, edges, pushHistory])

  // Create node at click position
  const createNodeAtClick = useCallback((nodeType: string) => {
    const snappedPosition = {
      x: Math.round(canvasCtxClickPos.x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(canvasCtxClickPos.y / GRID_SIZE) * GRID_SIZE,
    }
    pushHistory(nodes, edges)
    setNodes((nds) => nds.concat({
      id: crypto.randomUUID(),
      type: nodeType,
      position: snappedPosition,
      data: getInitialData(nodeType),
      ...(nodeType === 'notes' ? { zIndex: -1 } : {}),
    }))
    setCanvasCtxOpen(false)
  }, [canvasCtxClickPos, getInitialData, setNodes, nodes, edges, pushHistory])

  // Create node when dragging handle
  const createNodeFromHandle = useCallback((nodeType: string) => {
    if (!handleMenuSourceNode || !temporaryEdge) return

    const snappedPosition = {
      x: Math.round(handleMenuEndPos.x / GRID_SIZE) * GRID_SIZE,
      y: Math.round(handleMenuEndPos.y / GRID_SIZE) * GRID_SIZE,
    }

    const newNodeId = crypto.randomUUID()

    // Get initial data for node
    const initialData = getInitialData(nodeType)

    // If creating NanoBanana from executed NanoBanana, set iterative mode
    if (nodeType === 'nanobanana') {
      const sourceNode = nodesRef.current.find(n => n.id === handleMenuSourceNode)
      if (sourceNode?.type === 'nanobanana' && ['done', 'edited'].includes(sourceNode.data?.status)) {
        // For NanoBanana node, initialData already contains mode, so we override it
        (initialData as NanoBananaData).mode = 'iterative'
      }
    }

    const newNode = {
      id: newNodeId,
      type: nodeType,
      position: snappedPosition,
      data: initialData,
      ...(nodeType === 'notes' ? { zIndex: -1 } : {}),
    }

    // Push history before mutation
    pushHistory(nodes, persistentCanvasEdges(nodes, edges))

    // Forcefully synchronize edges and nodes update together
    flushSync(() => {
      // First create permanent connection
      setEdges((eds) => {
        const filteredEdges = persistentCanvasEdges(nodes, eds)
        const incoming = temporaryEdge.target === handleMenuSourceNode
        return addEdge({
          id: `e${handleMenuSourceNode}-${newNodeId}`,
          source: incoming ? newNodeId : handleMenuSourceNode,
          sourceHandle: incoming ? null : temporaryEdge.sourceHandle,
          target: incoming ? handleMenuSourceNode : newNodeId,
          targetHandle: incoming ? temporaryEdge.targetHandle : null,
          type: 'removable'
        } as Edge, filteredEdges)
      })
    })
    
    // Then create node in separate flushSync to ensure edge exists
    flushSync(() => {
      setNodes((nds) => nds.concat(newNode))
    })
    
    // Track node addition
    trackNodeAdded({
      node_id: newNodeId,
      node_type: nodeType,
      canvas_id: canvasId
    })
    
    setHandleMenuOpen(false)
    setHandleMenuSourceNode(null)
    setTemporaryEdge(null)
    setConnectionSuccessful(false)
    connectionSuccessfulRef.current = false
  }, [handleMenuSourceNode, handleMenuEndPos, temporaryEdge, getInitialData, setNodes, setEdges, nodes, edges, pushHistory])

  const saveCanvas = useCallback(async () => {
    if (savingRef.current) throw new Error("A save is already in progress")
    savingRef.current = true
    setIsSaving(true)
    const submittedNodes = nodesRef.current
    const submittedEdges = edgesRef.current
    const submittedSnapshot = JSON.stringify({ nodes: submittedNodes, edges: submittedEdges })
    try {
      // Include collapsed state in data for DB save
      const nodesWithCollapsedState = submittedNodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          isCollapsed: Boolean(node.data?.isCollapsed)
        }
      }))
      
      // Read last used models from localStorage
      let lastUsedModels: Record<string, string> = {}
      try {
        const key = `lastUsedModels_${canvasId}`
        const stored = localStorage.getItem(key)
        if (stored) {
          lastUsedModels = JSON.parse(stored)
        }
      } catch (error) {
        console.warn('Failed to read last used models from localStorage:', error)
      }
      
      const canvasData = compactCanvasDocument({
        nodes: nodesWithCollapsedState,
        edges: submittedEdges,
        metadata: {
          lastUsedModels
        }
      })

      const response = await fetch(`/api/canvases/${canvasId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: JSON.stringify(canvasData),
          expectedUpdatedAt: revisionRef.current,
        }),
      })

      if (!response.ok) {
        throw new Error(response.status === 409 ? "This canvas changed in another tab. Your draft is preserved; copy your edits before reloading." : "Failed to save canvas. Your draft is preserved.")
      }
      const saved = await response.json()
      if (typeof saved.updatedAt !== "string") throw new Error("Save confirmation is missing its revision")
      revisionRef.current = saved.updatedAt

      // Update snapshot and unsaved changes flag
      lastSavedSnapshotRef.current = submittedSnapshot
      const changedDuringSave = JSON.stringify({ nodes: nodesRef.current, edges: edgesRef.current }) !== submittedSnapshot
      setIsDirty(changedDuringSave)
      setIsSaved(!changedDuringSave)
      setTimeout(() => setIsSaved(false), 2000)
      return !changedDuringSave
    } catch (error) {
      console.error("Error saving canvas:", error)
      alert(error instanceof Error ? error.message : "Failed to save canvas. Your draft is preserved.")
      throw error
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }, [canvasId, nodes, edges])

  // Hotkey callbacks - defined as separate useCallback hooks
  const onCopy = useCallback((nodesToCopy: Node[], edgesToCopy: Edge[]) => {
    const clipboardData = {
      nodes: nodesToCopy.map(node => ({ ...node })),
      edges: edgesToCopy.filter(edge => 
        nodesToCopy.some(n => n.id === edge.source) && 
        nodesToCopy.some(n => n.id === edge.target)
      ),
      timestamp: Date.now(),
      sourceCanvas: canvasId
    }
    
    try {
      localStorage.setItem('llm-canvas-clipboard', JSON.stringify(clipboardData))
      
      // Show success toast
      const nodeCount = nodesToCopy.length
      const message = nodeCount === 1 ? 'Node copied' : `${nodeCount} nodes copied`
      showToast(message)
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }, [canvasId, showToast])

  const onPaste = useCallback((targetPosition?: { x: number; y: number }) => {
    try {
      const clipboardData = localStorage.getItem('llm-canvas-clipboard')
      if (!clipboardData) return
      
      const data = JSON.parse(clipboardData)
      
      // Generate new IDs for pasted nodes
      const idMap = new Map<string, string>()
      const newNodes = data.nodes.map((node: Node) => {
        const newId = crypto.randomUUID()
        idMap.set(node.id, newId)
        
        // Calculate position based on target or default offset
        let newPosition
        if (targetPosition) {
          // Calculate bounding box center of copied nodes to preserve relative positions
          const minX = Math.min(...data.nodes.map((n: Node) => n.position.x))
          const maxX = Math.max(...data.nodes.map((n: Node) => n.position.x))
          const minY = Math.min(...data.nodes.map((n: Node) => n.position.y))
          const maxY = Math.max(...data.nodes.map((n: Node) => n.position.y))

          const centerX = (minX + maxX) / 2
          const centerY = (minY + maxY) / 2

          // Offset to move center to target position (cursor)
          const offsetX = targetPosition.x - centerX
          const offsetY = targetPosition.y - centerY

          newPosition = {
            x: node.position.x + offsetX,
            y: node.position.y + offsetY
          }
        } else {
          // Default offset behavior
          newPosition = {
            x: node.position.x + 50,
            y: node.position.y + 50
          }
        }
        
        // If node is done or edited, convert to idle but preserve prompt and response
        const nodeStatus = node.data?.status
        if (nodeStatus === 'done' || nodeStatus === 'edited') {
          return {
            ...node,
            id: newId,
            position: newPosition,
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
          position: newPosition
        }
      })
      
      // Update edge references with new IDs
      const newEdges = data.edges.map((edge: Edge) => ({
        ...edge,
        id: `e${idMap.get(edge.source)}-${idMap.get(edge.target)}`,
        source: idMap.get(edge.source) || edge.source,
        target: idMap.get(edge.target) || edge.target
      }))
      
      pushHistory(nodes, edges)
      setNodes(prev => [...prev, ...newNodes])
      setEdges(prev => [...prev, ...newEdges])

      // Select only pasted nodes
      setSelectedNodeIds(newNodes.map((n: Node) => n.id))
    } catch (error) {
      console.error('Failed to paste:', error)
    }
  }, [setNodes, setEdges, nodes, edges, pushHistory])

  // Check if clipboard has data
  const hasClipboardData = useCallback((): boolean => {
    try {
      const clipboardData = localStorage.getItem('llm-canvas-clipboard')
      if (!clipboardData) return false
      
      const data = JSON.parse(clipboardData)
      return data.nodes && data.nodes.length > 0
    } catch (error) {
      return false
    }
  }, [])

  // Paste from context menu at specific position
  const onPasteAtPosition = useCallback(() => {
    onPaste(canvasCtxClickPos)
  }, [onPaste, canvasCtxClickPos])

  const onCut = useCallback((nodesToCut: Node[], edgesToCut: Edge[]) => {
    const nodeIds = nodesToCut.map(n => n.id)
    pushHistory(nodes, edges)
    setNodes(prev => prev.filter(n => !nodeIds.includes(n.id)))
    setEdges(prev => prev.filter(e =>
      !nodeIds.includes(e.source) && !nodeIds.includes(e.target)
    ))
    setSelectedNodeIds([])
  }, [setNodes, setEdges, nodes, edges, pushHistory])

  const onDelete = useCallback((nodeIds: string[]) => {
    // Track node deletions
    nodeIds.forEach(nodeId => {
      const node = nodes.find(n => n.id === nodeId)
      if (node) {
        trackNodeDeleted({
          node_id: nodeId,
          node_type: node.type,
          canvas_id: canvasId
        })
      }
    })

    pushHistory(nodes, edges)
    setNodes(prev => prev.filter(n => !nodeIds.includes(n.id)))
    setEdges(prev => prev.filter(e =>
      !nodeIds.includes(e.source) && !nodeIds.includes(e.target)
    ))
    setSelectedNodeIds([])
  }, [setNodes, setEdges, nodes, edges, canvasId, pushHistory])

  const onDuplicate = useCallback((nodesToDuplicate: Node[]) => {
    const idMap = new Map<string, string>()
    const newNodes = nodesToDuplicate.map(node => {
      const newId = crypto.randomUUID()
      idMap.set(node.id, newId)
      
      // If node is done or edited, convert to idle but preserve prompt and response
      const nodeStatus = node.data?.status
      if (nodeStatus === 'done' || nodeStatus === 'edited') {
        return {
          ...node,
          id: newId,
          position: {
            x: node.position.x + 50,
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
          x: node.position.x + 50,
          y: node.position.y + 50
        }
      }
    })

    pushHistory(nodes, edges)
    setNodes(prev => [...prev, ...newNodes])

    // Select only duplicated nodes
    setSelectedNodeIds(newNodes.map((n: Node) => n.id))
  }, [setNodes, nodes, edges, pushHistory])

  const onToggleHidden = useCallback((nodeIds: string[]) => {
    nodeIds.forEach(nodeId => {
      const currentHidden = Boolean(nodes.find(n => n.id === nodeId)?.data?.hidden)
      onNodeUpdate(nodeId, { hidden: !currentHidden })
    })
  }, [nodes, onNodeUpdate])

  const onToggleCollapse = useCallback((nodeIds: string[]) => {
    nodeIds.forEach(nodeId => {
      const currentCollapsed = Boolean(nodes.find(n => n.id === nodeId)?.data?.isCollapsed)
      onNodeUpdate(nodeId, { isCollapsed: !currentCollapsed })
    })
  }, [nodes, onNodeUpdate])

  const onMoveNodes = useCallback((nodeIds: string[], deltaX: number, deltaY: number) => {
    pushHistory(nodes, edges)
    setNodes(prev => prev.map(node => {
      if (nodeIds.includes(node.id)) {
        return {
          ...node,
          position: {
            x: Math.round((node.position.x + deltaX) / GRID_SIZE) * GRID_SIZE,
            y: Math.round((node.position.y + deltaY) / GRID_SIZE) * GRID_SIZE
          }
        }
      }
      return node
    }))
  }, [setNodes, nodes, edges, pushHistory])

  const onZoomToSelected = useCallback(() => {
    if (selectedNodeIds.length > 0 && reactFlowInstance) {
      const selectedNodes = nodes.filter(n => selectedNodeIds.includes(n.id))
      if (selectedNodes.length > 0) {
        // Calculate bounds for all selected nodes
        const minX = Math.min(...selectedNodes.map(n => n.position.x))
        const minY = Math.min(...selectedNodes.map(n => n.position.y))
        const maxX = Math.max(...selectedNodes.map(n => n.position.x + (n.width || 400)))
        const maxY = Math.max(...selectedNodes.map(n => n.position.y + (n.height || 300)))
        
        fitBounds({
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY
        }, { padding: 0.2, duration: 300 })
      }
    }
  }, [selectedNodeIds, nodes, reactFlowInstance, fitBounds])

  const onZoomReset = useCallback(() => {
    if (reactFlowInstance) {
      reactFlowInstance.zoomTo(1, { duration: 300 })
    }
  }, [reactFlowInstance])

  const onZoomIn = useCallback(() => {
    zoomIn({ duration: 300 })
  }, [zoomIn])

  const onZoomOut = useCallback(() => {
    zoomOut({ duration: 300 })
  }, [zoomOut])

  const onFitView = useCallback(() => {
    if (reactFlowInstance) {
      reactFlowInstance.fitView({ padding: 0.1, duration: 300 })
    }
  }, [reactFlowInstance])

  const onZoomToLevel = useCallback((level: number) => {
    if (reactFlowInstance) {
      reactFlowInstance.zoomTo(level, { duration: 300 })
    }
  }, [reactFlowInstance])

  const onDeselectAll = useCallback(() => {
    setSelectedNodeIds([])
    setIsNodeDetailsOpen(false)
    setSelectedNodeId(null)
    setIsNotesPanelOpen(false)
    setNotesNodeId(null)
  }, [])

  const onSelectAll = useCallback(() => {
    setSelectedNodeIds(nodes.map(n => n.id))
  }, [nodes])

  const onSave = useCallback(() => {
    void saveCanvas().catch(() => {})
  }, [saveCanvas])

  // Run selected nodes
  const onRunSelectedNodes = useCallback(async (nodeIds: string[]) => {
    if (nodeIds.length === 0) return
    
    const graph = { nodes: nodesRef.current, edges: edgesRef.current }
    try {
      await runSelectedGraph(nodeIds, graph, runNode)
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Selected node execution failed")
    }
  }, [runNode, showToast])

  // Tidy Up handler - automatically arrange all nodes
  const onTidyUp = useCallback(async () => {
    if (nodes.length === 0) return

    try {
      pushHistory(nodes, edges)
      const updatedNodes = await autoLayoutNodes(nodes, edges)

      setNodes(updatedNodes)
      
      // Fit view to show all nodes after layout
      setTimeout(() => {
        if (reactFlowInstance) {
          reactFlowInstance.fitView({ padding: 0.1 })
        }
      }, 100)
    } catch (error) {
      console.error('Error during tidy up:', error)
    }
  }, [nodes, edges, setNodes, reactFlowInstance, pushHistory])

  // Undo handler
  const handleUndo = useCallback(() => {
    const snapshot = undo(nodes, edges)
    if (!snapshot) return

    // Check if history limit was reached
    if (historyLimitReachedRef.current) {
      showToast("Undo history limit reached")
      historyLimitReachedRef.current = false
    }

    // Restore nodes with preserved data
    setNodes(current => {
      const currentMap = new Map(current.map(n => [n.id, n]))
      return snapshot.nodes.map(sn => {
        const existing = currentMap.get(sn.id)
        return existing
          ? { ...existing, position: sn.position }
          : { id: sn.id, type: sn.type, position: sn.position, data: sn.data ?? {} }
      })
    })

    // Restore edges
    setEdges(snapshot.edges.map(e => ({ ...e, type: e.type || 'removable' })))
  }, [undo, nodes, edges, setNodes, setEdges, showToast])

  // Redo handler
  const handleRedo = useCallback(() => {
    const snapshot = redo(nodes, edges)
    if (!snapshot) return

    // Check if history limit was reached
    if (historyLimitReachedRef.current) {
      showToast("Undo history limit reached")
      historyLimitReachedRef.current = false
    }

    // Restore nodes with preserved data
    setNodes(current => {
      const currentMap = new Map(current.map(n => [n.id, n]))
      return snapshot.nodes.map(sn => {
        const existing = currentMap.get(sn.id)
        return existing
          ? { ...existing, position: sn.position }
          : { id: sn.id, type: sn.type, position: sn.position, data: sn.data ?? {} }
      })
    })

    // Restore edges
    setEdges(snapshot.edges.map(e => ({ ...e, type: e.type || 'removable' })))
  }, [redo, nodes, edges, setNodes, setEdges, showToast])

  // Custom onNodesChange to track drag operations
  const handleNodesChange = useCallback((changes: any[]) => {
    const positionChanges = changes.filter((c: any) => c.type === 'position')

    // Only track drag if there are position changes with dragging flag
    const hasDraggingTrue = positionChanges.some((c: any) => c.dragging === true)
    const hasDraggingFalse = positionChanges.some((c: any) => c.dragging === false)

    // Detect drag start - only when dragging flag is explicitly true
    if (hasDraggingTrue && !isDraggingRef.current) {
      captureDragStart(nodes, edges)
      isDraggingRef.current = true
    }

    // Apply the changes
    onNodesChange(changes)

    // Detect drag end - only when dragging flag is explicitly false AND we were dragging
    if (hasDraggingFalse && isDraggingRef.current) {
      isDraggingRef.current = false
      commitDrag()

      // Check if history limit was reached during commit
      if (historyLimitReachedRef.current) {
        showToast("Undo history limit reached")
        historyLimitReachedRef.current = false
      }
    }
  }, [nodes, edges, onNodesChange, captureDragStart, commitDrag, showToast])

  // Custom onEdgesChange to track edge deletions
  const handleEdgesChange = useCallback((changes: any[]) => {
    // Check if any edge is being removed
    const hasRemoval = changes.some((c: any) => c.type === 'remove')

    if (hasRemoval) {
      pushHistory(nodes, edges)

      // Check if history limit was reached
      if (historyLimitReachedRef.current) {
        showToast("Undo history limit reached")
        historyLimitReachedRef.current = false
      }
    }

    // Apply the changes
    onEdgesChange(changes)
  }, [nodes, edges, onEdgesChange, pushHistory, showToast])

  // Navigation handlers for unsaved changes dialog
  const handleBackClick = useCallback(() => {
    if (isDirty) {
      setPendingNavigation(() => () => router.push('/dashboard'))
      setShowUnsavedDialog(true)
    } else {
      router.push('/dashboard')
    }
  }, [isDirty, router])

  const handleSaveAndLeave = useCallback(async () => {
    if (!pendingNavigation) return
    
    try {
      if (await saveCanvas() === false) return
      pendingNavigation()
    } catch (error) {
      console.error("Error saving canvas before leaving:", error)
      // Don't navigate if save failed
    }
  }, [pendingNavigation, saveCanvas])

  const handleDiscardChanges = useCallback(() => {
    if (pendingNavigation) {
      pendingNavigation()
    }
  }, [pendingNavigation])

  const handleCancelNavigation = useCallback(() => {
    setShowUnsavedDialog(false)
    setPendingNavigation(null)
  }, [])

  // Combine all callbacks into the hotkey callbacks object
  // Paste function for hotkeys - uses mouse position
  const onPasteHotkey = useCallback(() => {
    // Use mouse position if available, otherwise use center of viewport
    let targetPosition = mousePosition
    if (!targetPosition && reactFlowInstance && reactFlowWrapper.current) {
      const bounds = reactFlowWrapper.current.getBoundingClientRect()
      targetPosition = reactFlowInstance.project({
        x: bounds.width / 2,
        y: bounds.height / 2,
      })
    }
    onPaste(targetPosition || undefined)
  }, [onPaste, mousePosition, reactFlowInstance])

  const hotkeyCallbacks: HotkeyCallbacks = useMemo(() => ({
    onCopy,
    onPaste: onPasteHotkey,
    onCut,
    onDelete,
    onDuplicate,
    onToggleHidden,
    onToggleCollapse,
    onMoveNodes,
    onZoomToSelected,
    onZoomReset,
    onZoomIn,
    onZoomOut,
    onFitView,
    onZoomToLevel,
    onDeselectAll,
    onSelectAll,
    onSave,
    onRunNodes: onRunSelectedNodes,
    onUndo: handleUndo,
    onRedo: handleRedo
  }), [
    onCopy, onPasteHotkey, onCut, onDelete, onDuplicate, onToggleHidden, onToggleCollapse, onMoveNodes,
    onZoomToSelected, onZoomReset, onZoomIn, onZoomOut, onFitView, onZoomToLevel, onDeselectAll, onSelectAll, onSave, onRunSelectedNodes,
    handleUndo, handleRedo
  ])

  // Use the hotkeys hook
  useCanvasHotkeys({
    callbacks: hotkeyCallbacks,
    selectedNodeIds: selectedNodeIds,
    allNodes: nodes,
    allEdges: edges,
    canvasId,
    enabled: true
  })

  // Use the canvas search hook
  useCanvasSearch(
    searchModalOpen,
    () => setSearchModalOpen(true),
    () => setSearchModalOpen(false)
  )

  // Function to focus on a specific node with smooth easing animation
  const focusOnNode = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId)
    if (node && reactFlowInstance) {
      // Cancel previous animation if active
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }

      // Set the node as highlighted
      setSelectedNodeIds([nodeId])
      
      // Calculate the node's position and size
      const nodeElement = document.querySelector(`[data-id="${nodeId}"]`)
      if (nodeElement) {
        const rect = nodeElement.getBoundingClientRect()
        const flowRect = reactFlowWrapper.current?.getBoundingClientRect()
        
        if (flowRect) {
          // Calculate the center position relative to the flow container
          const centerX = rect.left + rect.width / 2 - flowRect.left
          const centerY = rect.top + rect.height / 2 - flowRect.top
          
          // Convert to flow coordinates (target center in flow space)
          const targetCenterFlow = reactFlowInstance.screenToFlowPosition({
            x: centerX,
            y: centerY
          })
          
          // Get current viewport
          const startViewport = reactFlowInstance.getViewport()
          const startZoom = startViewport.zoom
          const targetZoom = 1
          
          // Calculate target viewport transform to center on targetCenterFlow
          // ReactFlow viewport transform: viewport.x = screenCenterX / zoom - flowX
          const screenCenterX = flowRect.width / 2
          const screenCenterY = flowRect.height / 2
          const targetX = screenCenterX / targetZoom - targetCenterFlow.x
          const targetY = screenCenterY / targetZoom - targetCenterFlow.y
          
          // Calculate differences
          const deltaX = targetX - startViewport.x
          const deltaY = targetY - startViewport.y
          const deltaZoom = targetZoom - startZoom
          
          // If changes are minimal, don't animate
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
          if (distance < 1 && Math.abs(deltaZoom) < 0.01) {
            return
          }
          
          // Animation parameters
          const duration = 600 // milliseconds
          const startTime = performance.now()
          
          // Easing function: easeInOutCubic - smooth start and end
          const easeInOutCubic = (t: number): number => {
            return t < 0.5
              ? 4 * t * t * t
              : 1 - Math.pow(-2 * t + 2, 3) / 2
          }
          
          // Animation loop - directly interpolate viewport transform values
          const animate = (currentTime: number) => {
            // Check if reactFlowInstance is still available
            if (!reactFlowInstance) {
              animationFrameRef.current = null
              return
            }
            
            const elapsed = currentTime - startTime
            const progress = Math.min(elapsed / duration, 1)
            
            // Apply easing
            const eased = easeInOutCubic(progress)
            
            // Directly interpolate between start and target viewport values
            const currentX = startViewport.x + deltaX * eased
            const currentY = startViewport.y + deltaY * eased
            const currentZoom = startZoom + deltaZoom * eased
            
            // Update viewport
            reactFlowInstance.setViewport({
              x: currentX,
              y: currentY,
              zoom: currentZoom
            }, { duration: 0 }) // No additional animation, we're controlling it manually
            
            // Continue animation if not finished
            if (progress < 1) {
              animationFrameRef.current = requestAnimationFrame(animate)
            } else {
              // Animation complete
              animationFrameRef.current = null
            }
          }
          
          // Start animation
          animationFrameRef.current = requestAnimationFrame(animate)
        }
      }
    }
  }, [nodes, reactFlowInstance])

  // Handle navigation to a different node
  const handleNavigateToNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId)
    setNotesNodeId(nodeId)
    // Optionally focus on the node in the canvas
    focusOnNode(nodeId)
  }, [focusOnNode])

  // Memoized callback to refresh total tokens from the database
  const onRefreshTotalTokens = useCallback(async () => {
    try {
      const response = await fetch(`/api/canvases/${canvasId}`)
      if (response.ok) {
        const data = await response.json()
        // Ensure we update the state with the actual value from DB
        setCanvasTotalTokensUsed(data.totalTokensUsed ?? null)
      }
    } catch (error) {
      console.error('Failed to refresh canvas total tokens:', error)
    }
  }, [canvasId])

  if (isInitializing) {
    return (
      <div className="h-full w-full flex flex-col bg-background">
        <CanvasLoading 
          stage="rendering"
          message="Initializing canvas editor..."
        />
      </div>
    )
  }

  return (
    <div className="h-full w-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-background border-border">
        <div className="flex items-center gap-4">
          <Button 
            onClick={handleBackClick} 
            variant="ghost" 
            size="sm"
            className="w-10 h-10 p-0 rounded-lg flex items-center justify-center hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{canvasTitle}</h1>
            <p className="text-sm text-muted-foreground">Canvas Editor</p>
          </div>
          <div className="flex items-center gap-2 ml-2">
            <Badge variant="secondary" className="text-xs">
              <Layers className="w-3 h-3 mr-1" />
              {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'}
            </Badge>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge 
                    variant="secondary" 
                    className="text-xs cursor-pointer hover:bg-secondary/80 transition-colors"
                    onClick={() => setTokenStatsOpen(true)}
                  >
                    <Activity className="w-3 h-3 mr-1" />
                    {totalTokens.toLocaleString()} tokens
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm p-4">
                  <div className="space-y-3">
                    <div className="text-xs font-semibold mb-3 text-muted-foreground">Click for detailed statistics</div>
                    {Object.keys(aggregateTokenStatistics).length > 0 ? (
                      <div className="space-y-2.5">
                        {Object.entries(aggregateTokenStatistics)
                          .sort(([, a], [, b]) => b.total - a.total)
                          .map(([operator, data]) => {
                            const operatorType = operator === 'nanobanana' ? 'nanobanana' : 
                                                operator === 'openai' || operator === 'gemini' || operator === 'openrouter' 
                                                  ? operator as CredentialProviderId
                                                  : 'summarizer'
                            const color = getPrimaryColor(operatorType)
                            const icon = getNodeTypeIcon(operatorType)
                            
                            return (
                              <div key={operator} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2" style={{ color }}>
                                  <div className="w-3 h-3 flex items-center justify-center">
                                    {icon}
                                  </div>
                                  <span className="font-medium capitalize">{operator}</span>
                                </div>
                                <span className="font-semibold" style={{ color }}>
                                  {data.total.toLocaleString()}
                                </span>
                              </div>
                            )
                          })}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        No token data available
                      </div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Button
            variant="outline"
            onClick={() => setSearchModalOpen(true)}
            size="sm"
            className="h-8 px-3"
            title="Search in canvas (Ctrl+F)"
          >
            <Search className="mr-2 h-4 w-4" />
            Search
          </Button>
          <div className="flex items-center gap-1">
            <Button
              onClick={handleUndo}
              disabled={!canUndo}
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              onClick={handleRedo}
              disabled={!canRedo}
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={onTidyUp}
            disabled={nodes.length === 0}
            size="sm"
            variant="outline"
            title="Automatically arrange all nodes"
          >
            <LayoutGrid className="mr-2 h-4 w-4" />
            Tidy Up
          </Button>
          <Button
            onClick={saveCanvas}
            disabled={isSaving || !isDirty}
            size="sm"
            data-save-button
          >
            <Save className="mr-2 h-4 w-4" />
            {isSaving ? "Saving..." : isSaved ? "Saved!" : "Save"}
          </Button>
        </div>
      </div>

      {/* React Flow Canvas */}
      <div className="flex-1 relative" ref={reactFlowWrapper}>
        <CanvasNodeActionsContext.Provider value={nodeActions}>
        <ReactFlow
          nodes={nodesWithSelection}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          minZoom={0.0001}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          onNodeClick={(event, node) => {
            // Handle single node selection
            if (!event.ctrlKey && !event.metaKey) {
              setSelectedNodeIds([node.id])
            } else {
              // Handle multi-selection with Ctrl/Cmd
              setSelectedNodeIds(prev => {
                if (prev.includes(node.id)) {
                  return prev.filter(id => id !== node.id)
                } else {
                  return [...prev, node.id]
                }
              })
            }
          }}
          onNodeDoubleClick={(event, node) => {
            // Check that node supports details panel
            const isSupportedNode = node.type === 'summarizer' ||
                                 node.type === 'gemini' ||
                                 node.type === 'custom' ||
                           node.type === 'openai' ||
                                 node.type === 'openrouter' ||
                                 node.type === 'nanobanana' ||
                                 node.type === 'media' ||
                                 node.type === 'text'
            
            if (isSupportedNode) {
              setSelectedNodeId(node.id)
              setIsNodeDetailsOpen(true)
              setNotesNodeId(node.id)
              setIsNotesPanelOpen(true)
            }
          }}
          onPaneClick={onPaneClick}
          onMouseDown={onPaneMouseDown}
          onMouseMove={(event) => {
            // Handle selection box mouse move
            onPaneMouseMove(event)
            
            // Handle mouse position tracking
            if (reactFlowInstance && reactFlowWrapper.current) {
              const bounds = reactFlowWrapper.current.getBoundingClientRect()
              const position = reactFlowInstance.project({
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top,
              })
              setMousePosition(position)
            }
          }}
          onMouseUp={onPaneMouseUp}
          onPaneContextMenu={onPaneContextMenu}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          fitView
          snapToGrid={true}
          snapGrid={SNAP_GRID as [number, number]}
          className="bg-background"
          defaultViewport={defaultViewport}
          proOptions={{ hideAttribution: true }}
          nodeTypes={canvasNodeTypes}
          edgeTypes={{ removable: RemovableEdge as any }}
          defaultEdgeOptions={{ type: 'removable' } as any}
          nodesDraggable={true}
          nodesConnectable={true}
          elementsSelectable={true}
          selectNodesOnDrag={false}
          selectionOnDrag={false}
        >
          <Background 
            color="rgba(255, 255, 255, 0.18)" 
            gap={24} 
            size={2} 
          />
          <MiniMap
            nodeColor={(node) => {
              // Notes nodes use their custom color with transparency
              if (node.type === 'notes') {
                const noteColor = node.data?.color || '#facc15'
                // Convert hex to rgba with 50% opacity
                const hex = noteColor.replace('#', '')
                const r = parseInt(hex.substring(0, 2), 16)
                const g = parseInt(hex.substring(2, 4), 16)
                const b = parseInt(hex.substring(4, 6), 16)
                return `rgba(${r}, ${g}, ${b}, 0.5)`
              }
              // Use the same colors as node borders from colors.ts
              return getPrimaryColor(node.type as any) || '#6b7280'
            }}
            nodeStrokeWidth={3}
            position="bottom-right"
            maskColor="rgba(0, 0, 0, 0.3)"
          />
          <Controls 
            className="bg-background/95 border-border backdrop-blur-sm" 
            position="bottom-right"
            style={{
              backgroundColor: 'hsl(var(--background))',
              borderColor: 'hsl(var(--border))',
              color: 'hsl(var(--foreground))',
              right: '210px', // Shift left from minimap with sufficient padding
            } as any}
          />
        </ReactFlow>
        </CanvasNodeActionsContext.Provider>

        {/* Selection Box Overlay */}
        {selectionBox && selectionBox.isActive && reactFlowInstance && (
          <SelectionBox
            startX={reactFlowInstance.flowToScreenPosition({ x: selectionBox.startX, y: selectionBox.startY }).x}
            startY={reactFlowInstance.flowToScreenPosition({ x: selectionBox.startX, y: selectionBox.startY }).y}
            currentX={reactFlowInstance.flowToScreenPosition({ x: selectionBox.currentX, y: selectionBox.currentY }).x}
            currentY={reactFlowInstance.flowToScreenPosition({ x: selectionBox.currentX, y: selectionBox.currentY }).y}
            direction="ltr"
            theme="system"
          />
        )}

        {/* File Drag and Drop Preview */}
        {isDraggingFile && dragFilePosition && reactFlowInstance && (() => {
          const viewport = reactFlowInstance.getViewport()
          const zoom = viewport.zoom
          const baseWidth = 320
          const baseHeight = 200
          const scaledWidth = baseWidth * zoom
          const scaledHeight = baseHeight * zoom
          const screenPosition = reactFlowInstance.flowToScreenPosition(dragFilePosition)
          const offsetX = 160 * zoom
          
          return (
            <div
              className="absolute pointer-events-none z-50 rounded-xl border-2 border-dashed border-primary bg-primary/20 flex flex-col items-center justify-center"
              style={{
                width: `${scaledWidth}px`,
                minHeight: `${scaledHeight}px`,
                left: screenPosition.x - scaledWidth / 2 + offsetX,
                top: screenPosition.y - scaledHeight / 2,
              }}
            >
              <Upload 
                className="text-primary" 
                style={{ 
                  width: `${32 * zoom}px`, 
                  height: `${32 * zoom}px`,
                  marginBottom: `${8 * zoom}px`
                }} 
              />
              <p 
                className="text-primary font-medium" 
                style={{ 
                  fontSize: `${14 * zoom}px`,
                  lineHeight: `${20 * zoom}px`
                }}
              >
                Drop here to create media node
              </p>
            </div>
          )
        })()}

        {/* Floating Action Panel */}
        <div className="absolute top-4 right-4 z-10 floating-action-panel">
          <Button 
            onClick={() => setIsAddNodeMenuOpen((v) => !v)} 
            size="default"
            aria-label="Add node"
            className="w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>

        {/* Node Type Menu - separately positioned */}
        <div className="absolute top-20 right-4 z-20">
          <NodeTypeMenu
            open={isAddNodeMenuOpen}
            onSelect={(type) => createNodeAtCenter(type)}
            onClose={() => setIsAddNodeMenuOpen(false)}
          />
        </div>

        {/* Node Context Menu */}
        <NodeContextMenu
          open={ctxOpen}
          x={ctxPos.x}
          y={ctxPos.y}
          hidden={Boolean(nodes.find((n) => n.id === ctxNodeId)?.data?.hidden)}
          collapsed={Boolean(nodes.find((n) => n.id === ctxNodeId)?.data?.isCollapsed)}
          selectedCount={selectedNodeIds.includes(ctxNodeId || '') ? selectedNodeIds.length : 1}
          onClose={() => setCtxOpen(false)}
          onCopy={() => {
            if (!ctxNodeId) return
            
            // If the right-clicked node is among selected nodes, copy all selected nodes
            if (selectedNodeIds.includes(ctxNodeId) && selectedNodeIds.length > 1) {
              const nodesToCopy = nodes.filter((n) => selectedNodeIds.includes(n.id))
              const connectedEdges = edges.filter((e) => 
                selectedNodeIds.includes(e.source) && selectedNodeIds.includes(e.target)
              )
              onCopy(nodesToCopy, connectedEdges)
            } else {
              // Copy only the right-clicked node
              const nodeToCopy = nodes.find((n) => n.id === ctxNodeId)
              if (nodeToCopy) {
                const connectedEdges = edges.filter((e) => e.source === ctxNodeId || e.target === ctxNodeId)
                onCopy([nodeToCopy], connectedEdges)
              }
            }
          }}
          onToggleHidden={() => {
            if (!ctxNodeId) return
            
            // If the right-clicked node is among selected nodes, toggle all selected nodes
            if (selectedNodeIds.includes(ctxNodeId) && selectedNodeIds.length > 1) {
              selectedNodeIds.forEach(nodeId => {
                const currentHidden = Boolean(nodes.find((n) => n.id === nodeId)?.data?.hidden)
                onNodeUpdate(nodeId, { hidden: !currentHidden })
              })
            } else {
              // Toggle only the right-clicked node
              const currentHidden = Boolean(nodes.find((n) => n.id === ctxNodeId)?.data?.hidden)
              onNodeUpdate(ctxNodeId, { hidden: !currentHidden })
            }
          }}
          onToggleCollapse={() => {
            if (!ctxNodeId) return
            
            // If the right-clicked node is among selected nodes, toggle all selected nodes
            if (selectedNodeIds.includes(ctxNodeId) && selectedNodeIds.length > 1) {
              selectedNodeIds.forEach(nodeId => {
                const currentCollapsed = Boolean(nodes.find((n) => n.id === nodeId)?.data?.isCollapsed)
                onNodeUpdate(nodeId, { isCollapsed: !currentCollapsed })
              })
            } else {
              // Toggle only the right-clicked node
              const currentCollapsed = Boolean(nodes.find((n) => n.id === ctxNodeId)?.data?.isCollapsed)
              onNodeUpdate(ctxNodeId, { isCollapsed: !currentCollapsed })
            }
          }}
          onDelete={() => {
            if (!ctxNodeId) return
            
            // If the right-clicked node is among selected nodes, delete all selected nodes
            if (selectedNodeIds.includes(ctxNodeId) && selectedNodeIds.length > 1) {
              // Track deletions for all selected nodes
              selectedNodeIds.forEach(nodeId => {
                const node = nodes.find(n => n.id === nodeId)
                if (node) {
                  trackNodeDeleted({
                    node_id: nodeId,
                    node_type: node.type,
                    canvas_id: canvasId
                  })
                }
              })
              
              // Delete all selected nodes
              setNodes((prev) => prev.filter((n) => !selectedNodeIds.includes(n.id)))
              setEdges((prev) => prev.filter((e) => 
                !selectedNodeIds.includes(e.source) && !selectedNodeIds.includes(e.target)
              ))
              setSelectedNodeIds([])
            } else {
              // Track deletion for single node
              const node = nodes.find(n => n.id === ctxNodeId)
              if (node) {
                trackNodeDeleted({
                  node_id: ctxNodeId,
                  node_type: node.type,
                  canvas_id: canvasId
                })
              }
              
              // Delete only the right-clicked node
              setNodes((prev) => prev.filter((n) => n.id !== ctxNodeId))
              setEdges((prev) => prev.filter((e) => e.source !== ctxNodeId && e.target !== ctxNodeId))
              setSelectedNodeIds([])
            }
          }}
        />

        {/* Edge Context Menu */}
        <EdgeContextMenu
          open={edgeCtxOpen}
          x={edgeCtxPos.x}
          y={edgeCtxPos.y}
          onClose={() => setEdgeCtxOpen(false)}
          onDelete={() => {
            if (!edgeCtxEdgeId) return
            setEdges((prev) => prev.filter((e) => e.id !== edgeCtxEdgeId))
          }}
        />

        {/* Canvas Context Menu */}
        <NodeTypeMenu
          open={canvasCtxOpen}
          onSelect={createNodeAtClick}
          onClose={() => setCanvasCtxOpen(false)}
          position={{ x: canvasCtxPos.x, y: canvasCtxPos.y }}
          onPaste={onPasteAtPosition}
          hasClipboardData={hasClipboardData()}
        />

        {/* Handle Context Menu */}
        <NodeTypeMenu
          open={handleMenuOpen}
          onSelect={createNodeFromHandle}
          onClose={() => {
            setHandleMenuOpen(false)
            setTemporaryEdge(null)
            setHandleMenuSourceNode(null)
          }}
          position={{ x: handleMenuPos.x, y: handleMenuPos.y }}
        />

        {/* Node Details Window - unified window */}
        {selectedNode && (
          <NodeDetailsWindow
            selectedNode={selectedNode}
            isOpen={isNodeDetailsOpen}
            onClose={onCloseNodeDetails}
            allNodes={nodes}
            allEdges={edges}
            onNodeUpdate={onNodeUpdate}
            onRun={runNode}
            onRestore={onRestore}
            onNavigateToNode={handleNavigateToNode}
            onFocusNode={focusOnNode}
            canvasId={canvasId}
          />
        )}

        {/* Hotkeys Panel */}
        <HotkeysPanel className="hotkeys-panel" />

        {/* Unsaved Changes Dialog */}
        <UnsavedChangesDialog
          open={showUnsavedDialog}
          onOpenChange={setShowUnsavedDialog}
          onSaveAndLeave={handleSaveAndLeave}
          onDiscardChanges={handleDiscardChanges}
          onCancel={handleCancelNavigation}
          isSaving={isSaving}
        />

        {/* Canvas Search Modal */}
        <CanvasSearchModal
          isOpen={searchModalOpen}
          onClose={() => setSearchModalOpen(false)}
          canvasId={canvasId}
          canvasData={{
            title: canvasTitle,
            description: '', // We don't have description in the editor, but it's optional
            nodes: nodes,
            edges: edges
          }}
          onNodeFocus={focusOnNode}
        />

        {/* Token Statistics Dialog */}
        <TokenStatisticsDialog
          open={tokenStatsOpen}
          onOpenChange={setTokenStatsOpen}
          statistics={aggregateTokenStatistics}
          totalTokens={totalTokens}
          canvasTotalTokensUsed={canvasTotalTokensUsed}
          canvasId={canvasId}
          onRefreshTotalTokens={onRefreshTotalTokens}
        />

        {/* Toast Notification */}
        {toastMessage && (
          <Toast
            message={toastMessage}
            onClose={() => setToastMessage(null)}
          />
        )}
      </div>
    </div>
  )
}

export default function CanvasEditor(props: CanvasEditorProps) {
  return (
    <ReactFlowProvider>
      <CanvasEditorComponent {...props} />
    </ReactFlowProvider>
  )
}
