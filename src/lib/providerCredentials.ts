import { isProviderId, providerRegistry } from "@/lib/providers/registry"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { decryptString } from "@/lib/crypto"
import { ApiError } from "@/lib/apiErrors"
import type { VideoAttachment } from "@/types"

export async function requireUserId(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) throw new ApiError("Unauthorized", 401)
  return session.user.id
}

export async function savedProviderKey(userId: string, provider: string): Promise<string> {
  if (!isProviderId(provider)) throw new ApiError("Invalid provider")
  const keyProvider = providerRegistry[provider].modelsProvider
  const settings = await prisma.userSettings.findUnique({ where: { userId } })
  const providers = settings?.providers as Record<string, { enc?: string }> | undefined
  const encrypted = providers?.[keyProvider]?.enc
  if (!encrypted) throw new ApiError("Configure a provider key in settings first")
  return decryptString(encrypted)
}

export async function requireCanvasAccess(userId: string, canvasId: unknown): Promise<void> {
  if (typeof canvasId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(canvasId)) throw new ApiError("Invalid canvas ID")
  const canvas = await prisma.canvas.findFirst({ where: { id: canvasId, userId }, select: { id: true } })
  if (!canvas) throw new ApiError("Canvas not found", 404)
}

export async function requireVideoAccess(userId: string, videos: VideoAttachment[]): Promise<void> {
  if (!Array.isArray(videos)) throw new ApiError("Invalid video attachments")
  for (const video of videos) {
    if (!video || typeof video.mediaId !== "string") throw new ApiError("Invalid video attachment")
    const media = await prisma.media.findFirst({
      where: { id: video.mediaId, canvas: { userId } },
      select: { filePath: true, videoFrames: true, canvasId: true }
    })
    if (!media || (video.filePath && video.filePath !== media.filePath)) throw new ApiError("Video not found", 404)
    const stored = media.videoFrames as { frames?: Array<{ path: string }> } | Array<{ path: string }> | null
    const frames = Array.isArray(stored) ? stored : stored?.frames ?? []
    const allowed = new Set(frames.map(frame => frame.path))
    if (video.frames?.some(frame => !allowed.has(frame.path))) throw new ApiError("Invalid video frame")
    video.canvasId = media.canvasId
  }
}
