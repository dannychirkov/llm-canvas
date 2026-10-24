import { rm } from "fs/promises"
import { join } from "path"
import { ApiError } from "@/lib/apiErrors"
import { assertNoSymlinks, assertStorageId } from "@/lib/publicPath"

const extensions: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/gif": ["gif"],
  "image/webp": ["webp"], "image/bmp": ["bmp"], "image/tiff": ["tif", "tiff"],
  "text/csv": ["csv"], "video/mp4": ["mp4"], "video/webm": ["webm"],
  "video/ogg": ["ogv", "ogg"], "video/quicktime": ["mov"], "video/x-msvideo": ["avi"],
  "video/x-ms-wmv": ["wmv"], "video/x-flv": ["flv"], "video/x-matroska": ["mkv"]
}

export function safeMediaExtension(mimeType: string): string {
  const extension = extensions[mimeType]?.[0]
  if (!extension) throw new ApiError("Unsupported media type")
  return `.${extension}`
}

export function validateMediaFilename(filename: string, mimeType: string): void {
  safeMediaExtension(mimeType)
  if (typeof filename !== "string" || filename.length > 240 || /[\\/%\u0000-\u001f\u007f]/.test(filename) || /\.(?:html?|svg|js|mjs|cjs|xhtml|xml|shtml|php)(?:\.|$)/i.test(filename)) throw new ApiError("Unsafe media filename")
  const extension = filename.split(".").pop()?.toLowerCase()
  if (!extension || !extensions[mimeType].includes(extension)) throw new ApiError("Filename extension does not match media type")
}

export async function validateSafeMedia(buffer: Buffer, mimeType: string, filename: string): Promise<void> {
  validateMediaFilename(filename, mimeType)
  if (mimeType === "text/csv") {
    let text: string
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer) } catch { throw new ApiError("Invalid CSV encoding") }
    if (buffer.includes(0) || /<\s*(?:[!?]|\/?[a-z][^>]*>)/i.test(text)) throw new ApiError("Active content is not allowed")
    return
  }
  const { fileTypeFromBuffer } = await import("file-type")
  const detected = await fileTypeFromBuffer(buffer)
  if (!detected || detected.mime !== mimeType) throw new ApiError("Media content does not match its type")
}

export function mediaResponseHeaders(mimeType: string): Record<string, string> {
  safeMediaExtension(mimeType)
  return {
    "Content-Type": mimeType,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    ...(mimeType === "text/csv" ? { "Content-Disposition": "attachment; filename=\"data.csv\"" } : {})
  }
}

export async function cleanupCanvasMedia(canvasId: string): Promise<void> {
  assertStorageId(canvasId)
  for (const namespace of ["uploads/canvases", "canvases"]) {
    const directory = join(process.cwd(), "public", namespace, canvasId)
    assertNoSymlinks(directory)
    await rm(directory, { recursive: true, force: true })
  }
}
