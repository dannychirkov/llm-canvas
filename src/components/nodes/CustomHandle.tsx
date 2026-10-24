"use client"

import React from "react"
import { Handle, Position, type HandleProps } from "reactflow"

interface CustomHandleProps extends HandleProps {
  // Additional props for customization
  activationRadius?: number
  style?: React.CSSProperties
  className?: string
}

/**
 * Custom Handle component with increased activation radius
 * for easier node connection
 */
function CustomHandle({ 
  activationRadius = 20, // Increased activation radius (default 8px)
  style,
  className,
  ...props 
}: CustomHandleProps) {
  return (
    <Handle
      {...props}
      style={{
        ...style,
        // Increase visual size of handle for better visibility
        width: '12px',
        height: '12px',
        // Increase activation radius via CSS variable
        '--react-flow-handle-activation-radius': `${activationRadius}px`,
      } as React.CSSProperties}
      // Add CSS class for additional styling
      className={`react-flow__handle react-flow__handle-${props.type} react-flow__handle-${props.position} custom-handle ${className || ''}`}
    />
  )
}

export default CustomHandle
