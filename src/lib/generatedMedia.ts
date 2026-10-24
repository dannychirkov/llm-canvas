import { randomUUID } from "node:crypto"
import { mkdir, writeFile, unlink } from "node:fs/promises"
import { join } from "node:path"
import sizeOf from "image-size"
import { ApiError } from "@/lib/apiErrors"
import { prisma } from "@/lib/prisma"
import { withStorageReservation } from "@/lib/storageUtils"
import { assertNoSymlinks } from "@/lib/publicPath"
import type { GeneratedImage } from "@/types"

export const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_GENERATED_IMAGES = 4
const MAX_GENERATED_BATCH_BYTES = 40 * 1024 * 1024

export interface GeneratedRaster {
  data: string
  mimeType?: string
}

export function extractGeminiGeneratedImages(payload: unknown): GeneratedRaster[] {
  const json = payload as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string; mimeType: string }; inline_data?: { data: string; mime_type: string } }> } }> }
  const parts = json?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return []
  return parts.flatMap(part => part.inlineData ? [{ data: part.inlineData.data, mimeType: part.inlineData.mimeType }] : part.inline_data ? [{ data: part.inline_data.data, mimeType: part.inline_data.mime_type }] : [])
}

export function decodeGeneratedRaster(image: GeneratedRaster) {
  if (typeof image.data !== "string" || !image.data.length || image.data.length > Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
    throw new ApiError("Invalid or oversized generated image", 502)
  }
  const buffer = Buffer.from(image.data, "base64")
  if (!buffer.length || buffer.length > MAX_GENERATED_IMAGE_BYTES || buffer.toString("base64").replace(/=+$/, "") !== image.data.replace(/=+$/, "")) {
    throw new ApiError("Invalid or oversized generated image", 502)
  }
  let mimeType: string
  let extension: string
  if (buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.toString("ascii", 12, 16) === "IHDR") {
    mimeType = "image/png"
    extension = "png"
  } else if (buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
    mimeType = "image/jpeg"
    extension = "jpg"
  } else if (buffer.length >= 20 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" && buffer.readUInt32LE(4) + 8 === buffer.length) {
    mimeType = "image/webp"
    extension = "webp"
  } else {
    throw new ApiError("Generated images must be PNG, JPEG or WebP rasters", 502)
  }
  if (image.mimeType && image.mimeType !== mimeType) throw new ApiError("Generated image MIME type does not match its bytes", 502)
  let dimensions
  try { dimensions = sizeOf(buffer) } catch { throw new ApiError("Invalid generated image dimensions", 502) }
  const { width, height } = dimensions
  if (!width || !height || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 40_000_000) {
    throw new ApiError("Generated image dimensions exceed the supported limits", 502)
  }
  return { buffer, mimeType, extension, width, height }
}

export async function saveGeneratedImages(images: GeneratedRaster[], owner: { userId: string; canvasId?: string }): Promise<GeneratedImage[]> {
  if (!owner.userId || !owner.canvasId || !/^[a-zA-Z0-9_-]+$/.test(owner.canvasId)) throw new ApiError("An owned canvas is required to save generated images")
  if (!Array.isArray(images) || !images.length || images.length > MAX_GENERATED_IMAGES) throw new ApiError("Invalid number of generated images", 502)
  const rasters = images.map(decodeGeneratedRaster)
  if (rasters.reduce((total, image) => total + image.buffer.length, 0) > MAX_GENERATED_BATCH_BYTES) throw new ApiError("Generated images exceed the response size limit", 502)
  const canvasId = owner.canvasId
  const writtenPaths: string[] = []
  try {
    const reservedBytes = rasters.reduce((total, image) => total + image.buffer.length + 4096, 0)
    return await withStorageReservation(owner.userId, reservedBytes, async reservation => {
      reservation.verify(reservedBytes)
      const canvas = await prisma.canvas.findFirst({ where: { id: canvasId, userId: owner.userId }, select: { id: true } })
      if (!canvas) throw new ApiError("Canvas not found", 404)
      const directory = join(process.cwd(), "public", "uploads", "canvases", canvasId)
      assertNoSymlinks(directory)
      await mkdir(directory, { recursive: true })
      assertNoSymlinks(directory)
      const pending: Array<{ filename: string; filePath: string; raster: ReturnType<typeof decodeGeneratedRaster> }> = []
      for (const raster of rasters) {
        const filename = `generated_${randomUUID()}.${raster.extension}`
        const filePath = `/uploads/canvases/${canvasId}/${filename}`
        const fullPath = join(directory, filename)
        writtenPaths.push(fullPath)
        await writeFile(fullPath, raster.buffer, { flag: "wx" })
        pending.push({ filename, filePath, raster })
      }
      return prisma.$transaction(async transaction => {
        const owned = await transaction.canvas.findFirst({ where: { id: canvasId, userId: owner.userId }, select: { id: true } })
        if (!owned) throw new ApiError("Canvas not found", 404)
        const saved: GeneratedImage[] = []
        for (const { filename, filePath, raster } of pending) {
          const media = await transaction.media.create({ data: { canvasId, filename, filePath, mimeType: raster.mimeType, fileSize: raster.buffer.length, width: raster.width, height: raster.height } })
          saved.push({ url: filePath, mediaId: media.id, width: raster.width, height: raster.height })
        }
        return saved
      })
    })
  } catch (error) {
    await Promise.all(writtenPaths.map(fullPath => unlink(fullPath).catch(() => undefined)))
    throw error
  }
}
