import { NextRequest, NextResponse } from "next/server"
import { stat } from "fs/promises"
import { createReadStream } from "fs"
import { Readable } from "stream"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { ApiError } from "@/lib/apiErrors"
import { mediaPathCanvasId, resolvePublicPath } from "@/lib/publicPath"
import { mediaResponseHeaders } from "@/lib/safeMedia"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) throw new ApiError("Unauthorized", 401)
    const filePath = `/${(await params).path.join("/")}`
    const canvasId = mediaPathCanvasId(filePath)
    const canvas = await prisma.canvas.findFirst({ where: { id: canvasId, userId: session.user.id }, select: { id: true } })
    if (!canvas) throw new ApiError("File not found", 404)
    const media = await prisma.media.findMany({ where: { canvasId } })
    let mimeType: string | undefined
    for (const item of media) {
      if (item.filePath === filePath) { mimeType = item.mimeType; break }
      if (item.thumbnailPath === filePath) { mimeType = "image/jpeg"; break }
      const value = item.videoFrames
      const frames = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray(value.frames) ? value.frames : []
      const match = frames.find(frame => frame && typeof frame === "object" && !Array.isArray(frame) && frame.path === filePath)
      if (match && typeof match === "object" && !Array.isArray(match)) { mimeType = typeof match.mimeType === "string" ? match.mimeType : "image/jpeg"; break }
    }
    if (!mimeType) throw new ApiError("File not found", 404)
    const headers = mediaResponseHeaders(mimeType)
    const fullPath = resolvePublicPath(filePath, canvasId)
    const file = await stat(fullPath)
    if (!file.isFile()) throw new ApiError("File not found", 404)
    const range = request.headers.get("range")
    let start = 0
    let end = file.size - 1
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match || (!match[1] && !match[2])) throw new ApiError("Invalid Range header", 416)
      if (!match[1]) {
        const suffix = Number(match[2])
        if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new ApiError("Invalid Range header", 416)
        start = Math.max(0, file.size - suffix)
      } else {
        start = Number(match[1])
        if (match[2]) end = Math.min(end, Number(match[2]))
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.size) return NextResponse.json({ error: "Invalid Range header" }, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } })
    }
    const stream = file.size ? Readable.toWeb(createReadStream(fullPath, { start, end })) as ReadableStream<Uint8Array> : null
    return new NextResponse(stream, { status: range ? 206 : 200, headers: {
      ...headers, "Accept-Ranges": "bytes", "Content-Length": String(file.size ? end - start + 1 : 0),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${file.size}` } : {})
    } })
  } catch (error) {
    const missing = error && typeof error === "object" && "code" in error && error.code === "ENOENT"
    return NextResponse.json({ error: error instanceof ApiError ? error.message : missing ? "File not found" : "Unable to serve media" }, { status: error instanceof ApiError ? error.status : missing ? 404 : 500 })
  }
}
