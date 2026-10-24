import { prisma } from "./prisma"
import { calculateCanvasMetrics, parseCanvasDocument } from "./canvasMetrics"

export async function invalidateCanvasCache(canvasId: string) {
  const canvas = await prisma.canvas.findUnique({ where: { id: canvasId }, select: { content: true, updatedAt: true } })
  if (!canvas) return null
  const document = canvas.content ? parseCanvasDocument(canvas.content) : { nodes: [], edges: [] }
  const metrics = await calculateCanvasMetrics(document)
  const updated = await prisma.canvas.updateMany({ where: { id: canvasId, updatedAt: canvas.updatedAt }, data: { ...metrics, updatedAt: canvas.updatedAt } })
  return updated.count ? metrics : null
}

export async function invalidateUserCache(userId: string): Promise<void> {
  const canvases = await prisma.canvas.findMany({ where: { userId }, select: { id: true } })
  for (const canvas of canvases) await invalidateCanvasCache(canvas.id)
}

export function shouldUpdateCache(contextCacheUpdated: Date | null): boolean {
  return !contextCacheUpdated || Date.now() - contextCacheUpdated.getTime() > 24 * 60 * 60 * 1000
}
