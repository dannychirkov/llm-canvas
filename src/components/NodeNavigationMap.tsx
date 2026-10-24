"use client"

import { useMemo, useCallback, useEffect, useState, useRef } from "react"
import { createPortal } from "react-dom"
import { Node, Edge, Handle, Position } from "reactflow"
import ReactFlow, {
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
} from "reactflow"
import "reactflow/dist/style.css"
import { getPrimaryColor } from "@/components/nodes/colors"
import { getNodeTypeIcon, isNavigableNodeType } from "@/components/nodes/NodeTypeIcon"
import dagre from 'dagre'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import MarkdownRenderer from "@/components/MarkdownRenderer"

interface NodeNavigationMapProps {
  selectedNode: Node | null
  allNodes: Node[]
  allEdges: Edge[]
  onNavigateToNode?: (nodeId: string) => void
  onFocusNode?: (nodeId: string) => void
}

// Mini version of node for navigation map (square with rounded corners)
function MiniNode({ data, selected, onNavigateToNode }: { data: any; selected: boolean; onNavigateToNode?: (nodeId: string) => void }) {
  const [isHovered, setIsHovered] = useState(false)
  const [popupPosition, setPopupPosition] = useState<{ top: number; left: number } | null>(null)
  const nodeRef = useRef<HTMLDivElement>(null)
  const nodeType = data.type || 'text'
  const nodeId = data.id || ''
  const status = data.status || 'idle'
  const isNavigable = isNavigableNodeType(nodeType)
  const isMediaOrText = nodeType === 'media' || nodeType === 'text'
  const nodeTitle = data.title || nodeType
  const nodePrompt = data.promptText
  const nodeResponse = data.responseText
  const nodeTextContent = data.textContent // For text nodes
  // Media data (only for MediaNode and NanoBananaNode)
  const mediaUrl = (nodeType === 'media') ? (data.filePath || data.url) : null
  const generatedImage = (nodeType === 'nanobanana') ? data.generatedImage : null
  const hasMedia = (nodeType === 'media' && mediaUrl) || (nodeType === 'nanobanana' && generatedImage?.url)

  // Check if there's any content to display
  const hasContent = Boolean(nodePrompt || nodeResponse || hasMedia || (nodeType === 'text' && nodeTextContent))

  // Background - provider color (node type) with transparency, like in shadow
  const primaryColor = getPrimaryColor(nodeType as any) || '#9ca3af'
  // Convert hex to rgba with 0.12 opacity (like in getHeaderStyleForType)
  const hexToRgb = (hex: string) => {
    const h = hex.replace('#', '')
    const bigint = parseInt(h, 16)
    const r = (bigint >> 16) & 255
    const g = (bigint >> 8) & 255
    const b = bigint & 255
    return { r, g, b }
  }
  const { r, g, b } = hexToRgb(primaryColor)
  const backgroundColor = `rgba(${r}, ${g}, ${b}, 0.12)`

  // Border - status color (synchronized with details panel)
  const getBorderColor = () => {
    // If status is IDLE, use light gray color
    if (status === "idle") {
      return "#9ca3af" // gray-400
    }

    // Base color based on node type
    const baseColor = getPrimaryColor(nodeType as any)

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
  }

  const borderColor = getBorderColor()

  // Calculate popup position on hover
  useEffect(() => {
    if (isHovered && nodeRef.current) {
      const updatePosition = () => {
        if (nodeRef.current) {
          const rect = nodeRef.current.getBoundingClientRect()
          setPopupPosition({
            top: rect.top - 8, // 8px offset from top
            left: rect.left + rect.width / 2 // center of node
          })
        }
      }

      updatePosition()

      // Update position on scroll and window resize
      window.addEventListener('scroll', updatePosition, true)
      window.addEventListener('resize', updatePosition)

      return () => {
        window.removeEventListener('scroll', updatePosition, true)
        window.removeEventListener('resize', updatePosition)
      }
    }
  }, [isHovered])

  return (
    <>
      <div className="relative group" ref={nodeRef}>
        <div
          className={`w-16 h-16 rounded-lg border-2 shadow-lg flex items-center justify-center transition-all duration-200 relative ${selected
            ? 'ring-4 ring-offset-2 scale-110'
            : (isNavigable || isMediaOrText)
              ? 'cursor-pointer hover:scale-110 hover:shadow-xl'
              : 'cursor-default opacity-50'
            }`}
          onClick={(e) => {
            if ((isNavigable || isMediaOrText) && onNavigateToNode && nodeId) {
              e.stopPropagation()
              onNavigateToNode(nodeId)
            }
          }}
          style={{
            backgroundColor: backgroundColor,
            borderColor: borderColor,
            borderWidth: selected ? '3px' : '2px',
            boxShadow: selected
              ? `0 0 0 4px ${borderColor}40, 0 10px 15px -3px rgb(0 0 0 / 0.1)`
              : `0 4px 6px -1px rgb(0 0 0 / 0.1)`,
          }}
          title={nodeTitle}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => { setIsHovered(false); setPopupPosition(null) }}
        >
          {/* Handle for incoming connections (top) - invisible */}
          <Handle
            type="target"
            position={Position.Top}
            id="target"
            style={{
              background: 'transparent',
              border: 'none',
              width: '1px',
              height: '1px',
              opacity: 0,
            }}
          />

          <div className="scale-140">
            {getNodeTypeIcon(nodeType)}
          </div>

          {/* Handle for outgoing connections (bottom) - invisible */}
          <Handle
            type="source"
            position={Position.Bottom}
            id="source"
            style={{
              background: 'transparent',
              border: 'none',
              width: '1px',
              height: '1px',
              opacity: 0,
            }}
          />
        </div>

        {/* Fallback simple tooltip for non-navigable nodes (only if no media) */}
        {isHovered && !isNavigable && !hasMedia && (
          <div
            className="absolute z-50 px-2 py-1 text-xs bg-popover text-popover-foreground rounded shadow-lg whitespace-nowrap"
            style={{
              bottom: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              marginBottom: '4px'
            }}
          >
            {nodeTitle} (No panel)
          </div>
        )}
      </div>

      {/* Enhanced Popup - appears from top via Portal */}
      {isHovered && (isNavigable || hasMedia || isMediaOrText) && popupPosition && typeof window !== 'undefined' && createPortal(
        <>
          {/* Invisible bridge between node and popup to prevent disappearance */}
          <div
            className="fixed z-[9998]"
            style={{
              top: `${popupPosition.top - 8}px`,
              left: `${popupPosition.left - 200}px`,
              width: '400px',
              height: '8px',
              pointerEvents: 'auto'
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => { setIsHovered(false); setPopupPosition(null) }}
          />
          <div
            className="fixed z-[9999] w-96 max-w-[500px] bg-popover text-popover-foreground border rounded-lg shadow-xl p-3 transition-all duration-200 ease-in-out"
            style={{
              top: `${popupPosition.top}px`,
              left: `${popupPosition.left}px`,
              transform: 'translate(-50%, -100%)',
              marginBottom: '8px',
              opacity: 1
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => { setIsHovered(false); setPopupPosition(null) }}
          >
            {/* Node Title */}
            <div className="font-semibold text-xs mb-2 text-foreground border-b border-border pb-1.5">
              {nodeTitle}
            </div>

            {/* Prompt Section */}
            {nodePrompt && (
              <div className="mb-3">
                <div className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Prompt
                </div>
                <div className="relative">
                  <div
                    className="text-xs leading-relaxed max-h-[350px] overflow-hidden"
                    style={{
                      maskImage: 'linear-gradient(to bottom, black 0%, black 85%, transparent 100%)',
                      WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 85%, transparent 100%)'
                    }}
                  >
                    <MarkdownRenderer content={nodePrompt} />
                  </div>
                </div>
              </div>
            )}

            {/* Media Section - only for MediaNode and NanoBananaNode */}
            {nodeType === 'media' && (
              <div className={nodeResponse ? "mb-3" : ""}>
                <div className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Media
                </div>
                <div className="relative">
                  {hasMedia && mediaUrl ? (
                    <img
                      src={`/api/media/serve${mediaUrl}`}
                      alt={data.caption || 'Media'}
                      className="w-full max-h-[200px] object-contain rounded-md border"
                    />
                  ) : (
                    <div className="text-xs text-muted-foreground italic">(empty)</div>
                  )}
                </div>
              </div>
            )}
            {/* Generated Image Section for NanoBananaNode */}
            {nodeType === 'nanobanana' && hasMedia && (
              <div className={nodeResponse ? "mb-3" : ""}>
                <div className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Generated Image
                </div>
                <div className="relative">
                  {generatedImage?.url && (
                    <div className="relative">
                      <img
                        src={`/api/media/serve${generatedImage.url}`}
                        alt="Generated image"
                        className="w-full max-h-[200px] object-contain rounded-md border"
                        style={{
                          aspectRatio: generatedImage.width && generatedImage.height
                            ? `${generatedImage.width} / ${generatedImage.height}`
                            : 'auto'
                        }}
                      />
                      {generatedImage.width && generatedImage.height && (
                        <div className="absolute bottom-1 left-1 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">
                          {generatedImage.width}×{generatedImage.height}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Text Content Section - for text nodes */}
            {nodeType === 'text' && (
              <div className={nodeResponse ? "mb-3" : ""}>
                <div className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Text Content
                </div>
                <div className="relative">
                  {nodeTextContent ? (
                    <div
                      className="text-xs leading-relaxed max-h-[350px] overflow-hidden"
                      style={{
                        maskImage: 'linear-gradient(to bottom, black 0%, black 85%, transparent 100%)',
                        WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 85%, transparent 100%)'
                      }}
                    >
                      <MarkdownRenderer content={nodeTextContent} />
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground italic">(empty)</div>
                  )}
                </div>
              </div>
            )}

            {/* Response Section */}
            {nodeResponse && (
              <div>
                <div className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Response
                </div>
                <div className="relative">
                  <div
                    className="text-xs leading-relaxed max-h-[350px] overflow-hidden"
                    style={{
                      maskImage: 'linear-gradient(to bottom, black 0%, black 85%, transparent 100%)',
                      WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 85%, transparent 100%)'
                    }}
                  >
                    <MarkdownRenderer content={nodeResponse} />
                  </div>
                </div>
              </div>
            )}

            {/* Empty state - show only for operators without content */}
            {!hasContent && isNavigable && !isMediaOrText && (
              <div className="text-xs text-muted-foreground italic">(empty)</div>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  )
}

// Custom node type for React Flow
const createNodeTypes = (onNavigateToNode?: (nodeId: string) => void) => ({
  mini: ({ data, selected }: any) => <MiniNode data={data} selected={selected} onNavigateToNode={onNavigateToNode} />
})

function NodeNavigationMapInner({
  selectedNode,
  allNodes,
  allEdges,
  onNavigateToNode,
  onFocusNode
}: NodeNavigationMapProps) {
  const { getViewport } = useReactFlow()

  // Find all connected nodes within one workflow (entire connected graph component via BFS)
  const connectedNodes = useMemo(() => {
    if (!selectedNode) return []

    const visited = new Set<string>()
    const connected = new Set<string>([selectedNode.id])
    const queue = [selectedNode.id]

    // BFS to find entire connected graph component (workflow)
    // This will find all nodes connected to selected one through any chain of connections
    // Important: we only traverse edges that actually connect nodes
    while (queue.length > 0) {
      const currentNodeId = queue.shift()!
      if (visited.has(currentNodeId)) continue
      visited.add(currentNodeId)

      // Find all connected nodes (both incoming and outgoing)
      // Filter only edges where currentNodeId is source or target
      const connectedNodeIds = new Set<string>()

      // Outgoing connections (currentNodeId -> target)
      allEdges
        .filter(edge => edge.source === currentNodeId)
        .forEach(edge => {
          // Check that target exists in allNodes
          const targetNode = allNodes.find(n => n.id === edge.target)
          if (targetNode) {
            connectedNodeIds.add(edge.target)
          }
        })

      // Incoming connections (source -> currentNodeId)
      allEdges
        .filter(edge => edge.target === currentNodeId)
        .forEach(edge => {
          // Check that source exists in allNodes
          const sourceNode = allNodes.find(n => n.id === edge.source)
          if (sourceNode) {
            connectedNodeIds.add(edge.source)
          }
        })

      // Add found nodes to result and queue
      // This ensures we find the entire connected graph component
      connectedNodeIds.forEach(nodeId => {
        if (!connected.has(nodeId)) {
          connected.add(nodeId)
          queue.push(nodeId)
        }
      })
    }

    // Return all connected nodes within one workflow, excluding the selected one
    // Important: filter only nodes that actually exist in allNodes
    return allNodes.filter(node =>
      connected.has(node.id) && node.id !== selectedNode.id
    )
  }, [selectedNode, allNodes, allEdges])

  // Find all edges within one workflow (between all connected nodes)
  const allEdgesInContext = useMemo(() => {
    if (!selectedNode) return []

    // Create set of all node IDs in connected workflow
    const connectedNodeIds = new Set<string>([selectedNode.id, ...connectedNodes.map(n => n.id)])

    // Find all edges that connect nodes within one workflow
    // This ensures we only show connections within the connected graph component
    return allEdges.filter(edge =>
      connectedNodeIds.has(edge.source) && connectedNodeIds.has(edge.target)
    )
  }, [selectedNode, allEdges, connectedNodes])


  // Create nodes for React Flow using dagre (like in tidy up)
  const flowNodes = useMemo(() => {
    if (!selectedNode) return []

    // Collect all nodes for layout (selected + all connected)
    const allNodesForLayout = [
      {
        ...selectedNode,
        type: 'mini',
        data: {
          ...selectedNode.data,
          id: selectedNode.id,
          type: selectedNode.type,
          title: selectedNode.data?.title || selectedNode.type || 'Node',
          status: selectedNode.data?.status || 'idle',
        },
        selected: true,
      },
      ...connectedNodes.map(node => ({
        ...node,
        type: 'mini',
        data: {
          ...node.data,
          id: node.id,
          type: node.type,
          title: node.data?.title || node.type || 'Node',
          status: node.data?.status || 'idle',
        },
        selected: false,
      }))
    ]

    if (allNodesForLayout.length === 0) return []

    // If positions not in cache, calculate layout using dagre
    const dagreGraph = new dagre.graphlib.Graph()
    dagreGraph.setDefaultEdgeLabel(() => ({}))
    dagreGraph.setGraph({
      rankdir: 'TB', // Top to Bottom
      nodesep: 50,   // Distance between nodes on same level
      ranksep: 80    // Distance between levels
    })

    // Mini node dimensions (64x64px)
    const MINI_NODE_SIZE = 64

    // Sort nodes by ID for dagre stability (same order = same layout)
    const sortedNodes = [...allNodesForLayout].sort((a, b) => a.id.localeCompare(b.id))

    // Add nodes to graph
    sortedNodes.forEach((node) => {
      dagreGraph.setNode(node.id, {
        width: MINI_NODE_SIZE,
        height: MINI_NODE_SIZE,
      })
    })

    // Sort edges for dagre stability
    const sortedEdges = [...allEdgesInContext].sort((a, b) => {
      const sourceCompare = a.source.localeCompare(b.source)
      if (sourceCompare !== 0) return sourceCompare
      return a.target.localeCompare(b.target)
    })

    // Add edges (only those that connect nodes in context)
    sortedEdges.forEach((edge) => {
      dagreGraph.setEdge(edge.source, edge.target)
    })

    // Calculate layout
    dagre.layout(dagreGraph)

    // Save positions to cache
    const positionsMap = new Map<string, { x: number; y: number }>()

    // Update node positions (dagre returns center, React Flow uses top-left)
    const layoutedNodes = allNodesForLayout.map((node) => {
      const dagreNode = dagreGraph.node(node.id)
      const position = {
        x: dagreNode.x - MINI_NODE_SIZE / 2,
        y: dagreNode.y - MINI_NODE_SIZE / 2,
      }

      // Save position to cache
      positionsMap.set(node.id, position)

      return {
        ...node,
        position,
      }
    })

    // Save cache for this set of nodes

    return layoutedNodes
  }, [selectedNode, connectedNodes, allEdgesInContext])

  // Create edges for React Flow (all connections in context)
  const flowEdges = useMemo(() => {
    const edges: Edge[] = []

    if (!selectedNode) return edges

    // Create edges for all connections in context
    allEdgesInContext.forEach(edge => {
      const sourceNode = allNodes.find(n => n.id === edge.source)
      const targetNode = allNodes.find(n => n.id === edge.target)

      if (!sourceNode || !targetNode) return

      // Use source node color for connection
      const sourceType = sourceNode.type || 'text'
      const sourceColor = getPrimaryColor(sourceType as any) || '#9ca3af'

      edges.push({
        id: edge.id || `edge-${edge.source}-${edge.target}`,
        source: edge.source,
        sourceHandle: 'source',
        target: edge.target,
        targetHandle: 'target',
        type: 'default',
        animated: false,
        style: {
          stroke: sourceColor,
          strokeWidth: 1.5,
        },
      })
    })

    return edges
  }, [selectedNode, allEdgesInContext, allNodes])

  const [nodes, setNodes, onNodesChangeBase] = useNodesState(flowNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges)
  const [initialZoom, setInitialZoom] = useState<number | null>(null)

  // Node change handler - prevent deselection
  const onNodesChange = useCallback((changes: any[]) => {
    // Filter changes that deselect all nodes
    const filteredChanges = changes.filter((change: any) => {
      // Ignore changes that deselect (selected: false) all nodes
      if (change.type === 'select' && change.selected === false) {
        // Check if there are other changes that set selection
        const hasOtherSelection = changes.some((c: any) =>
          c.type === 'select' && c.selected === true && c.id !== change.id
        )
        // If no other selections, ignore this change
        if (!hasOtherSelection) {
          return false
        }
      }
      return true
    })

    // If all changes were filtered (only deselection), don't apply them
    if (filteredChanges.length === 0 && changes.length > 0) {
      return
    }

    onNodesChangeBase(filteredChanges)
  }, [onNodesChangeBase])

  // Update nodes and edges when selectedNode changes
  useEffect(() => {
    setNodes(flowNodes)
    setEdges(flowEdges)
  }, [flowNodes, flowEdges, setNodes, setEdges])

  // Get initial zoom after fitView
  useEffect(() => {
    if (flowNodes.length > 0 && initialZoom === null) {
      // Use small timeout so fitView can complete
      setTimeout(() => {
        try {
          const viewport = getViewport()
          if (viewport && viewport.zoom) {
            setInitialZoom(viewport.zoom)
          }
        } catch (error) {
          // If failed to get zoom, use value from fitViewOptions
          setInitialZoom(1)
        }
      }, 300)
    }
  }, [flowNodes, initialZoom, getViewport])


  // Handle node click - only focus, navigation is handled by MiniNode
  const onNodeClick = useCallback((event: any, node: Node) => {
    const nodeType = node.data?.type || ''
    const isMediaOrText = nodeType === 'media' || nodeType === 'text'

    if (!isNavigableNodeType(nodeType) && !isMediaOrText) return

    // Center node on main canvas (navigation is handled by MiniNode.onClick)
    if (onFocusNode) {
      onFocusNode(node.id)
    }
  }, [onFocusNode])

  // Handle click on empty space - don't deselect
  const onPaneClick = useCallback((event: React.MouseEvent) => {
    // Do nothing - don't deselect
    // Selection can only change to another node
    event.preventDefault()
  }, [])

  // Create nodeTypes before conditional return to follow React Hooks rules
  const nodeTypesWithNavigation = useMemo(() => createNodeTypes(onNavigateToNode), [onNavigateToNode])

  if (!selectedNode) {
    return (
      <div className="h-full w-full flex items-center justify-center text-muted-foreground">
        Select a node to see navigation map
      </div>
    )
  }

  return (
    <div className="h-full w-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypesWithNavigation}
        defaultEdgeOptions={{
          type: 'default',
          animated: false,
        }}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={initialZoom || 0.3}
        maxZoom={2.0}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        panOnDrag={true}
        zoomOnScroll={true}
        zoomOnPinch={true}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        className="bg-muted/20"
      >
        <Background color="#e5e7eb" gap={16} size={1} />
      </ReactFlow>

      {/* Legend - bottom right */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="absolute bottom-2 right-2 bg-background/80 backdrop-blur-sm border border-border rounded-lg p-2 text-xs cursor-help">
              <div className="font-semibold mb-1">NavMap</div>
              <div className="text-muted-foreground">
                Click nodes to navigate
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <div className="text-center">
              <div>Ctrl + mouse wheel to zoom</div>
              <div>Hover for tooltip</div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

export default function NodeNavigationMap(props: NodeNavigationMapProps) {
  return (
    <ReactFlowProvider>
      <NodeNavigationMapInner {...props} />
    </ReactFlowProvider>
  )
}

