"use client"

import React from "react"

interface SelectionBoxProps {
  startX: number
  startY: number
  currentX: number
  currentY: number
  direction: 'ltr' | 'rtl'
  theme: 'light' | 'dark' | 'system'
}

export default function SelectionBox({
  startX,
  startY,
  currentX,
  currentY,
  direction,
  theme
}: SelectionBoxProps) {
  // Calculate box dimensions
  const left = Math.min(startX, currentX)
  const top = Math.min(startY, currentY)
  const width = Math.abs(currentX - startX)
  const height = Math.abs(currentY - startY)

  // Don't render if box is too small
  if (width < 5 || height < 5) {
    return null
  }

  // Determine actual theme (handle system theme)
  const actualTheme = theme === 'system' 
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme

  // Style based on theme - always blue for better visibility
  const borderColor = '#3b82f6' // blue-500
  const fillColor = 'rgba(59, 130, 246, 0.15)' // blue-500 with 15% opacity
  
  const borderStyle = 'solid'

  return (
    <div
      className="absolute pointer-events-none z-50"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        border: `2px ${borderStyle} ${borderColor}`,
        backgroundColor: fillColor,
        borderRadius: '8px',
        boxSizing: 'border-box'
      }}
    />
  )
}
