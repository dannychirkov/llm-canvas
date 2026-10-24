"use client"

import React, { memo } from "react"
import { Position, type NodeProps } from "reactflow"

interface TestNodeProps extends NodeProps {
  onNodeUpdate: (id: string, patch: Record<string, any>) => void
  onNodeSelect?: (id: string) => void
}

function TestNode(props: TestNodeProps) {
  const { id, data } = props

  return (
    <div 
      className="bg-red-500 text-white p-4 rounded-lg w-[200px] h-[100px] flex items-center justify-center cursor-pointer"
      onClick={(e) => {
        e.stopPropagation()
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
      }}
    >
      <div>Test Node {id}</div>
    </div>
  )
}

export default memo(TestNode)
