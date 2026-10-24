import type { Node, Edge, NanoBananaData } from "@/types"
import { getConnectedMediaNodes } from "./contextService"

export function getNanoAutoMode(id: string, nodes: Node[], edges: Edge[]): NanoBananaData["mode"] {
  const mediaNodes = getConnectedMediaNodes(id, nodes, edges)
  // Generated images use their persisted media ID; ordinary media must be an image.
  if (mediaNodes.some(node => node.type !== "media" && node.data.generatedImage?.mediaId)) {
    return "iterative"
  }
  const imageCount = mediaNodes.filter(node => node.type === "media" && node.data.mediaId && node.data.mimeType?.startsWith("image/")).length
  if (imageCount > 1) return "composition"
  return imageCount === 1 ? "image-edit" : "text-to-image"
}
