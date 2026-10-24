import { useEffect, useState } from "react"
import type { Node, Edge } from "reactflow"
import { calculateTokenPreview, type TokenPreviewResult } from "@/lib/tokenPreviewCalculator"

interface UseNodeTokensOptions {
  nodeId: string
  promptText: string
  allNodes: Node[]
  allEdges: Edge[]
  nodeType: string
}

export function useNodeTokens({ nodeId, promptText, allNodes, allEdges, nodeType }: UseNodeTokensOptions) {
  const [tokenPreview, setTokenPreview] = useState<TokenPreviewResult | null>(null)
  const [isCalculatingTokens, setIsCalculatingTokens] = useState(false)
  useEffect(() => {
    let active = true
    const timer = setTimeout(async () => {
      setIsCalculatingTokens(true)
      try {
        const result = await calculateTokenPreview(nodeId, allNodes, allEdges, promptText || "")
        if (active) setTokenPreview(result)
      } catch {
        if (active) setTokenPreview(null)
      } finally {
        if (active) setIsCalculatingTokens(false)
      }
    }, 100)
    return () => { active = false; clearTimeout(timer) }
  }, [nodeId, promptText, allNodes, allEdges, nodeType])
  return { tokenPreview, isCalculatingTokens }
}
