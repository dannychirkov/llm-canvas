"use client"

import React from 'react'

// Colors from colors.ts
const NODE_COLORS = {
  orange1: '#f97316', // Nano Banana
  orange2: '#f59e0b', // Summarizer
  green: '#10a37f',   // OpenAI
  blue: '#4285f4',    // Gemini
  purple: '#8b5cf6',  // OpenRouter
  gray: '#6b7280',    // Text, Media
}

interface ColorBlock {
  color: string
  left: string
  top: string
  width: string
  height: string
  opacity: number
}

// Predefined static positions for colorful "nodes"
const COLOR_BLOCKS: ColorBlock[] = [
  // Orange blocks (Nano Banana, Summarizer)
  { color: NODE_COLORS.orange1, left: '15%', top: '20%', width: '320px', height: '240px', opacity: 0.18 },
  { color: NODE_COLORS.orange2, left: '65%', top: '60%', width: '280px', height: '200px', opacity: 0.15 },
  
  // Green blocks (OpenAI)
  { color: NODE_COLORS.green, left: '75%', top: '15%', width: '300px', height: '220px', opacity: 0.16 },
  { color: NODE_COLORS.green, left: '10%', top: '65%', width: '260px', height: '180px', opacity: 0.14 },
  
  // Blue blocks (Gemini)
  { color: NODE_COLORS.blue, left: '45%', top: '10%', width: '290px', height: '210px', opacity: 0.17 },
  { color: NODE_COLORS.blue, left: '55%', top: '75%', width: '270px', height: '190px', opacity: 0.15 },
  
  // Purple blocks (OpenRouter)
  { color: NODE_COLORS.purple, left: '25%', top: '45%', width: '310px', height: '230px', opacity: 0.16 },
  { color: NODE_COLORS.purple, left: '80%', top: '40%', width: '250px', height: '170px', opacity: 0.14 },
  
  // Gray blocks (Text, Media)
  { color: NODE_COLORS.gray, left: '5%', top: '5%', width: '240px', height: '160px', opacity: 0.12 },
  { color: NODE_COLORS.gray, left: '35%', top: '70%', width: '230px', height: '150px', opacity: 0.11 },
  { color: NODE_COLORS.gray, left: '85%', top: '80%', width: '220px', height: '140px', opacity: 0.10 },
]

export default function CanvasBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-background">
      {/* Grid pattern (optional, like canvas grid) */}
      <div className="absolute inset-0 opacity-[0.03]">
        <div 
          className="h-full w-full"
          style={{
            backgroundImage: 'linear-gradient(hsl(var(--foreground) / 0.1) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground) / 0.1) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
      </div>
      
      {/* Colorful "node" blocks */}
      {COLOR_BLOCKS.map((block, index) => (
        <div
          key={index}
          className="absolute rounded-xl"
          style={{
            left: block.left,
            top: block.top,
            width: block.width,
            height: block.height,
            backgroundColor: block.color,
            opacity: block.opacity,
            filter: 'blur(40px)',
            transform: 'translate(-50%, -50%)',
          }}
        />
      ))}
    </div>
  )
}

