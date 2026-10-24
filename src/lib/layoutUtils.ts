import { Node, Edge } from 'reactflow'
import dagre from 'dagre'

// Constants for layout
const NODE_WIDTH = 200
const NODE_HEIGHT = 100
const GRID_SIZE = 20

// Zone-based layout constants
const PRIORITY_LANE_SPACING = 50
const MAIN_WORKFLOW_ZONE_SPACING = 100
const STAGING_AREA_COLUMN_SPACING = 100
const STAGING_AREA_ROW_SPACING = 30

export interface LayoutOptions {
  direction?: 'TB' | 'BT' | 'LR' | 'RL'
  nodeWidth?: number
  nodeHeight?: number
  ranksep?: number
  nodesep?: number
}

/**
 * Try to get real DOM dimensions of a node if available
 * @param nodeId - ID of the node
 * @returns Real dimensions if available, null otherwise
 */
function getRealNodeDimensions(nodeId: string): { width: number; height: number } | null {
  try {
    // Try multiple selectors to find the DOM element for this node
    const selectors = [
      `[data-id="${nodeId}"]`,
      `[data-testid="${nodeId}"]`,
      `.react-flow__node[data-id="${nodeId}"]`,
      `#${nodeId}`
    ]
    
    for (const selector of selectors) {
      const nodeElement = document.querySelector(selector)
      if (nodeElement) {
        const rect = nodeElement.getBoundingClientRect()
        // Only return if we have valid dimensions
        if (rect.width > 0 && rect.height > 0) {
          return {
            width: rect.width,
            height: rect.height
          }
        }
      }
    }
  } catch (error) {
    // Silently fail if DOM access is not available
  }
  return null
}

/**
 * Get actual node dimensions based on node type and content
 * @param node - ReactFlow node
 * @param useRealDimensions - Whether to try to get real DOM dimensions first
 * @returns Object with width and height
 */
function getNodeDimensions(node: Node, useRealDimensions: boolean = true): { width: number; height: number } {
  // FIRST: Check if React Flow has already measured the node
  if (node.width && node.height && node.width > 0 && node.height > 0) {
    return { width: node.width, height: node.height }
  }
  
  // Try to get real DOM dimensions first if requested
  if (useRealDimensions) {
    const realDimensions = getRealNodeDimensions(node.id)
    if (realDimensions) {
      return realDimensions
    }
  }
  // Check if node is collapsed first
  const isCollapsed = Boolean(node.data?.isCollapsed)
  
  // Base dimensions for different node types (more accurate measurements)
  const nodeTypeDimensions: Record<string, { width: number; baseHeight: number }> = {
    memory: { width: 320, baseHeight: 200 },
    text: { width: 320, baseHeight: 150 },
    notes: { width: 300, baseHeight: 150 },
    summarizer: { width: 360, baseHeight: 200 },
    gemini: { width: 340, baseHeight: 200 },
    openai: { width: 340, baseHeight: 200 },
    openrouter: { width: 340, baseHeight: 200 },
    nanobanana: { width: 340, baseHeight: 200 },
    media: { width: 320, baseHeight: 200 },
    test: { width: 200, baseHeight: 100 }
  }

  const baseDimensions = nodeTypeDimensions[node.type as keyof typeof nodeTypeDimensions] || { width: NODE_WIDTH, baseHeight: NODE_HEIGHT }
  
  // If node is collapsed, return collapsed dimensions
  if (isCollapsed) {
    const collapsedHeight = 120 // More accurate collapsed height
    return {
      width: baseDimensions.width,
      height: collapsedHeight
    }
  }
  
  // Calculate dynamic height based on content with more accurate formulas
  let dynamicHeight = baseDimensions.baseHeight
  
  // For LLM nodes, calculate height based on response content
  if (node.type && ['gemini', 'openai', 'openrouter', 'nanobanana', 'summarizer'].includes(node.type)) {
    const response = node.data?.response || ''
    if (response) {
      // More accurate line calculation considering actual text wrapping
      // Account for different character widths and line breaks
      const textLines = response.split('\n')
      let totalLines = 0
      
      textLines.forEach((line: string) => {
        if (line.trim()) {
          // More accurate character count per line (considering actual node width)
          const charsPerLine = Math.floor((baseDimensions.width - 40) / 8) // ~8px per character
          const lineCount = Math.ceil(line.length / charsPerLine)
          totalLines += Math.max(1, lineCount)
        } else {
          totalLines += 1 // Empty lines still take space
        }
      })
      
      const minLines = 4 // Minimum lines for response area
      const maxLines = 25 // Maximum lines to prevent excessive height
      const estimatedLines = Math.max(minLines, Math.min(maxLines, totalLines))
      
      // More accurate height calculation: header (90px) + response area (22px per line) + padding
      dynamicHeight = 90 + (estimatedLines * 22) + 30
    }
  }
  
  // For text nodes, calculate height based on content
  if (node.type === 'text') {
    const content = node.data?.content || ''
    if (content) {
      // More accurate calculation for text nodes
      const textLines = content.split('\n')
      let totalLines = 0
      
      textLines.forEach((line: string) => {
        if (line.trim()) {
          const charsPerLine = Math.floor((baseDimensions.width - 30) / 7) // ~7px per character for text
          const lineCount = Math.ceil(line.length / charsPerLine)
          totalLines += Math.max(1, lineCount)
        } else {
          totalLines += 1
        }
      })
      
      const minLines = 3
      const maxLines = 20
      const estimatedLines = Math.max(minLines, Math.min(maxLines, totalLines))
      
      // More accurate height: header (70px) + content area (18px per line) + padding
      dynamicHeight = 70 + (estimatedLines * 18) + 25
    }
  }
  
  // For memory nodes, calculate height based on value content
  if (node.type === 'memory') {
    const value = node.data?.value || ''
    if (value) {
      // More accurate calculation for memory nodes
      const textLines = value.split('\n')
      let totalLines = 0
      
      textLines.forEach((line: string) => {
        if (line.trim()) {
          const charsPerLine = Math.floor((baseDimensions.width - 30) / 7) // ~7px per character
          const lineCount = Math.ceil(line.length / charsPerLine)
          totalLines += Math.max(1, lineCount)
        } else {
          totalLines += 1
        }
      })
      
      const minLines = 4
      const maxLines = 15
      const estimatedLines = Math.max(minLines, Math.min(maxLines, totalLines))
      
      // More accurate height: header (70px) + textarea (18px per line) + footer (50px) + padding
      dynamicHeight = 70 + (estimatedLines * 18) + 50 + 25
    }
  }
  
  // Return dimensions with minimal padding (more accurate)
  return {
    width: baseDimensions.width,
    height: Math.max(dynamicHeight, baseDimensions.baseHeight) // Ensure minimum height
  }
}

/**
 * Layout priority lane (memory nodes) in a horizontal row
 * @param nodes - Array of memory nodes
 * @returns Layouted nodes and zone dimensions
 */
function layoutPriorityLane(nodes: Node[]): { nodes: Node[], width: number, height: number } {
  if (nodes.length === 0) {
    return { nodes: [], width: 0, height: 0 }
  }

  const layoutedNodes: Node[] = []
  let currentX = 0
  let maxHeight = 0

  nodes.forEach((node) => {
    const dimensions = getNodeDimensions(node)
    
    const layoutedNode = {
      ...node,
      position: {
        x: Math.round(currentX / GRID_SIZE) * GRID_SIZE,
        y: 0, // Always at top
      },
    }
    
    layoutedNodes.push(layoutedNode)
    currentX += dimensions.width + PRIORITY_LANE_SPACING
    maxHeight = Math.max(maxHeight, dimensions.height)
  })

  // Remove last spacing
  const totalWidth = currentX - PRIORITY_LANE_SPACING

  return {
    nodes: layoutedNodes,
    width: totalWidth,
    height: maxHeight
  }
}

/**
 * Layout main workflow using dagre algorithm
 * @param nodes - Array of connected nodes
 * @param edges - Array of edges
 * @returns Layouted nodes and zone dimensions
 */
function layoutMainWorkflow(nodes: Node[], edges: Edge[]): { nodes: Node[], width: number, height: number } {
  if (nodes.length === 0) {
    return { nodes: [], width: 0, height: 0 }
  }

  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 80 })

  // Add nodes with accurate dimensions
  nodes.forEach((node) => {
    const dimensions = getNodeDimensions(node)
    dagreGraph.setNode(node.id, {
      width: dimensions.width,
      height: dimensions.height,
    })
  })

  // Add edges (only those connecting nodes in this zone)
  const nodeIds = new Set(nodes.map(n => n.id))
  edges.forEach((edge) => {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      dagreGraph.setEdge(edge.source, edge.target)
    }
  })

  // Calculate layout
  dagre.layout(dagreGraph)

  // Update node positions (dagre returns center, React Flow uses top-left)
  const layoutedNodes = nodes.map((node) => {
    const dagreNode = dagreGraph.node(node.id)
    const dimensions = getNodeDimensions(node)
    
    return {
      ...node,
      position: {
        x: Math.round((dagreNode.x - dimensions.width / 2) / GRID_SIZE) * GRID_SIZE,
        y: Math.round((dagreNode.y - dimensions.height / 2) / GRID_SIZE) * GRID_SIZE,
      },
    }
  })

  // Calculate zone bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  
  layoutedNodes.forEach(node => {
    const dimensions = getNodeDimensions(node)
    const nodeMinX = node.position.x
    const nodeMinY = node.position.y
    const nodeMaxX = node.position.x + dimensions.width
    const nodeMaxY = node.position.y + dimensions.height
    
    minX = Math.min(minX, nodeMinX)
    minY = Math.min(minY, nodeMinY)
    maxX = Math.max(maxX, nodeMaxX)
    maxY = Math.max(maxY, nodeMaxY)
  })

  const width = maxX - minX
  const height = maxY - minY

  return {
    nodes: layoutedNodes,
    width: width,
    height: height
  }
}

/**
 * Layout staging area (orphan nodes) grouped by type in vertical columns
 * @param nodes - Array of orphan nodes
 * @returns Layouted nodes and zone dimensions
 */
function layoutStagingArea(nodes: Node[]): { nodes: Node[], width: number, height: number } {
  if (nodes.length === 0) {
    return { nodes: [], width: 0, height: 0 }
  }

  // Group nodes by type
  const nodesByType = new Map<string, Node[]>()
  nodes.forEach(node => {
    const type = node.type
    if (type && !nodesByType.has(type)) {
      nodesByType.set(type, [])
    }
    if (type) {
      nodesByType.get(type)!.push(node)
    }
  })

  // Sort nodes within each type group by status
  nodesByType.forEach((typeNodes, type) => {
    typeNodes.sort((a, b) => {
      const statusOrder = { done: 0, error: 1, idle: 2, processing: 3 }
      const aStatus = a.data?.status
      const bStatus = b.data?.status
      const aOrder = aStatus ? (statusOrder[aStatus as keyof typeof statusOrder] ?? 4) : 4
      const bOrder = bStatus ? (statusOrder[bStatus as keyof typeof statusOrder] ?? 4) : 4
      return aOrder - bOrder
    })
  })

  const layoutedNodes: Node[] = []
  let currentColumnX = 0
  let maxHeight = 0

  // Layout each type group as a vertical column
  nodesByType.forEach((typeNodes) => {
    let currentY = 0
    let columnMaxWidth = 0

    typeNodes.forEach((node) => {
      const dimensions = getNodeDimensions(node)
      
      const layoutedNode = {
        ...node,
        position: {
          x: Math.round(currentColumnX / GRID_SIZE) * GRID_SIZE,
          y: Math.round(currentY / GRID_SIZE) * GRID_SIZE,
        },
      }
      
      layoutedNodes.push(layoutedNode)
      currentY += dimensions.height + STAGING_AREA_ROW_SPACING
      columnMaxWidth = Math.max(columnMaxWidth, dimensions.width)
    })

    // Move to next column
    currentColumnX += columnMaxWidth + STAGING_AREA_COLUMN_SPACING
    maxHeight = Math.max(maxHeight, currentY - STAGING_AREA_ROW_SPACING) // Remove last spacing
  })

  // Remove last column spacing
  const totalWidth = currentColumnX - STAGING_AREA_COLUMN_SPACING

  return {
    nodes: layoutedNodes,
    width: totalWidth,
    height: maxHeight
  }
}

/**
 * Zone-based hierarchical layout algorithm
 * @param nodes - Array of ReactFlow nodes
 * @param edges - Array of ReactFlow edges
 * @returns Updated nodes with new positions
 */
async function dagreLayout(nodes: Node[], edges: Edge[]): Promise<Node[]> {
  if (nodes.length === 0) return []
  
  try {
  
  // Phase 1: Node Partitioning
  const priorityNodes: Node[] = []
  const mainGraphNodes: Node[] = []
  const orphanNodes: Node[] = []
  
  // Create set of connected node IDs
  const connectedNodeIds = new Set<string>()
  edges.forEach(edge => {
    connectedNodeIds.add(edge.source)
    connectedNodeIds.add(edge.target)
  })
  
  // Classify nodes into zones
  nodes.forEach(node => {
    if (node.type === 'memory') {
      priorityNodes.push(node)
    } else if (connectedNodeIds.has(node.id)) {
      mainGraphNodes.push(node)
    } else {
      orphanNodes.push(node)
    }
  })
  
  
  // Phase 2: Zone Layout
  const priorityLane = layoutPriorityLane(priorityNodes)
  const mainWorkflow = layoutMainWorkflow(mainGraphNodes, edges)
  const stagingArea = layoutStagingArea(orphanNodes)
  
  
  // Phase 3: Final Assembly
  const allLayoutedNodes: Node[] = []
  
  // Priority Lane: Already positioned at y=0, center horizontally
  if (priorityLane.nodes.length > 0) {
    const totalCanvasWidth = Math.max(priorityLane.width, mainWorkflow.width || 0)
    const centerOffset = (totalCanvasWidth - priorityLane.width) / 2
    
    priorityLane.nodes.forEach(node => {
      allLayoutedNodes.push({
        ...node,
        position: {
          x: Math.round((node.position.x + centerOffset) / GRID_SIZE) * GRID_SIZE,
          y: node.position.y
        }
      })
    })
  }
  
  // Main Workflow: Position below priority lane
  if (mainWorkflow.nodes.length > 0) {
    const yOffset = priorityLane.height + MAIN_WORKFLOW_ZONE_SPACING
    
    mainWorkflow.nodes.forEach(node => {
      allLayoutedNodes.push({
        ...node,
        position: {
          x: node.position.x,
          y: Math.round((node.position.y + yOffset) / GRID_SIZE) * GRID_SIZE
        }
      })
    })
  }
  
  // Staging Area: Position to the right of main workflow
  if (stagingArea.nodes.length > 0) {
    const xOffset = (mainWorkflow.width || 0) + MAIN_WORKFLOW_ZONE_SPACING
    const yOffset = priorityLane.height + MAIN_WORKFLOW_ZONE_SPACING
    
    stagingArea.nodes.forEach(node => {
      allLayoutedNodes.push({
        ...node,
        position: {
          x: Math.round((node.position.x + xOffset) / GRID_SIZE) * GRID_SIZE,
          y: Math.round((node.position.y + yOffset) / GRID_SIZE) * GRID_SIZE
        }
      })
    })
  }
  
    return allLayoutedNodes
  } catch (error) {
    console.error('❌ Error in zone-based layout:', error)
    // Fallback to simple layout if zone-based layout fails
    return nodes.map((node, index) => ({
      ...node,
      position: {
        x: (index % 5) * 250,
        y: Math.floor(index / 5) * 150
      }
    }))
  }
}

/**
 * Automatically arranges nodes using Dagre hierarchical layout algorithm
 * @param nodes - Array of ReactFlow nodes
 * @param edges - Array of ReactFlow edges
 * @param options - Layout configuration options
 * @returns Updated nodes with new positions
 */
export async function autoLayoutNodes(
  nodes: Node[],
  edges: Edge[],
  _options: LayoutOptions = {}
): Promise<Node[]> {
  if (nodes.length === 0) return []

  // Use zone-based hierarchical layout
  return await dagreLayout(nodes, edges)
}

/**
 * Get the bounding box of all nodes
 * @param nodes - Array of ReactFlow nodes
 * @returns Bounding box coordinates
 */
export function getNodesBounds(nodes: Node[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }

  // Calculate bounds considering actual node dimensions
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  
  nodes.forEach(node => {
    const dimensions = getNodeDimensions(node, true) // Use real dimensions
    const nodeMinX = node.position.x
    const nodeMinY = node.position.y
    const nodeMaxX = node.position.x + dimensions.width
    const nodeMaxY = node.position.y + dimensions.height
    
    minX = Math.min(minX, nodeMinX)
    minY = Math.min(minY, nodeMinY)
    maxX = Math.max(maxX, nodeMaxX)
    maxY = Math.max(maxY, nodeMaxY)
  })
  
  return { minX, minY, maxX, maxY }
}

/**
 * Center all nodes around a specific point
 * @param nodes - Array of ReactFlow nodes
 * @param centerX - X coordinate to center around
 * @param centerY - Y coordinate to center around
 * @returns Updated nodes centered around the point
 */
export function centerNodes(
  nodes: Node[],
  centerX: number = 0,
  centerY: number = 0
): Node[] {
  const bounds = getNodesBounds(nodes)
  const currentCenterX = (bounds.minX + bounds.maxX) / 2
  const currentCenterY = (bounds.minY + bounds.maxY) / 2
  
  const offsetX = centerX - currentCenterX
  const offsetY = centerY - currentCenterY

  return nodes.map(node => ({
    ...node,
    position: {
      x: Math.round((node.position.x + offsetX) / GRID_SIZE) * GRID_SIZE,
      y: Math.round((node.position.y + offsetY) / GRID_SIZE) * GRID_SIZE,
    }
  }))
}
