import type { ProviderId } from "@/lib/providers/registry"
// Basic color mapping inspired by v1 node colors

type NodeTypeKey = ProviderId
  | "text"
  | "summarizer"
  | "media"
  | "memory"
  | "notes"
  | "test"

type ColorEntry = { primary: string }

const NODE_COLORS: Record<NodeTypeKey, ColorEntry> = {
  text: { primary: "#6b7280" }, // zinc/gray
  media: { primary: "#6b7280" }, // gray
  notes: { primary: "#6b7280" },
  memory: { primary: "#6b7280" },
  summarizer: { primary: "#f59e0b" }, // amber accent
  gemini: { primary: "#4285f4" }, // blue
  custom: { primary: "#0d9488" },
  openai: { primary: "#10a37f" }, // green
  openrouter: { primary: "#8b5cf6" }, // purple
  nanobanana: { primary: "#f97316" }, // orange
  test: { primary: "#ef4444" }, // red
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const bigint = parseInt(h, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return { r, g, b }
}

export function getHeaderStyleForType(type: NodeTypeKey): React.CSSProperties {
  const color = NODE_COLORS[type]?.primary || '#6b7280'
  const { r, g, b } = hexToRgb(color)
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.12)`,
    borderBottomColor: `rgba(${r}, ${g}, ${b}, 0.45)`,
  }
}

export function getMenuDotStyle(type: NodeTypeKey): React.CSSProperties {
  const color = NODE_COLORS[type]?.primary || '#6b7280'
  return { backgroundColor: color }
}

export function getPrimaryColor(type: NodeTypeKey): string {
  return NODE_COLORS[type]?.primary || '#6b7280'
}

export type { NodeTypeKey }


