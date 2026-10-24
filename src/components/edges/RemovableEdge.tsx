"use client"

import React from "react"
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow } from "reactflow"
import type { EdgeProps } from "reactflow"

export default function RemovableEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    markerEnd,
  } = props

  const { setEdges } = useReactFlow()
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  const onDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEdges((eds) => eds.filter((edge) => edge.id !== id))
  }

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <button
          className="edge-delete-btn"
          onClick={onDelete}
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          aria-label="Delete connection"
          title="Delete connection"
        >
          ×
        </button>
      </EdgeLabelRenderer>
    </>
  )
}


