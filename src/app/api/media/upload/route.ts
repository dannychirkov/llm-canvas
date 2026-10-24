import { withApiBoundary } from "@/lib/apiBoundary"
import { authenticatedWorkload } from "@/lib/authenticatedWorkload"
import { NextRequest, NextResponse } from "next/server"
import { mkdir, writeFile, rm, mkdtemp, cp } from "fs/promises"
import { tmpdir } from "os"
import { join, relative } from "path"
import { randomUUID } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { ApiError } from "@/lib/apiErrors"
import { extractVideoMetadata, generateVideoFrames, generateVideoThumbnail } from "@/lib/videoUtils"
import { withStorageReservation, calculateFolderSize } from "@/lib/storageUtils"
import { validateSafeMedia, safeMediaExtension } from "@/lib/safeMedia"
import { resolvePublicPath, assertStorageId } from "@/lib/publicPath"
import { MAX_IMAGE_OR_CSV_SIZE, MAX_VIDEO_SIZE } from "@/lib/storageConstants"
import { readBoundedFormData } from "@/lib/boundedFormData"

export const dynamic = "force-dynamic"

async function handlePOST(request: NextRequest) {
  let staging: string | undefined
  let finalDirectory: string | undefined
  let committed = false
  try {
    const session = await auth()
    if (!session?.user?.id) throw new ApiError("Unauthorized", 401)
    const form = await readBoundedFormData(request, MAX_VIDEO_SIZE + 1024 * 1024)
    const file = form.get("file")
    const canvasId = form.get("canvasId")
    if (!(file instanceof File) || typeof canvasId !== "string") throw new ApiError("Missing file or canvasId")
    assertStorageId(canvasId)
    const canvas = await prisma.canvas.findFirst({ where: { id: canvasId, userId: session.user.id }, select: { id: true } })
    if (!canvas) throw new ApiError("Canvas not found", 404)
    const mimeType = file.type
    const isVideo = mimeType.startsWith("video/")
    const maximum = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_OR_CSV_SIZE
    if (file.size > maximum) throw new ApiError("File exceeds the size limit", 413)
    const buffer = Buffer.from(await file.arrayBuffer())
    await validateSafeMedia(buffer, mimeType, file.name)
    const mediaId = randomUUID()
    const basePath = `/uploads/canvases/${canvasId}/${mediaId}`
    finalDirectory = resolvePublicPath(`${basePath}/original${safeMediaExtension(mimeType)}`, canvasId, { allowLegacy: false })
    finalDirectory = join(finalDirectory, "..")
    staging = await mkdtemp(join(tmpdir(), "llm-canvas-upload-"))
    const original = join(staging, `original${safeMediaExtension(mimeType)}`)
    await writeFile(original, buffer)
    let width: number | null = null
    let height: number | null = null
    let durationMs: number | null = null
    let frameRate: number | null = null
    let csvData: string | null = null
    let csvRows: number | null = null
    let csvColumns: number | null = null
    if (mimeType.startsWith("image/")) {
      const { getImageDimensionsFromBuffer } = await import("@/lib/imageUtils")
      const dimensions = await getImageDimensionsFromBuffer(buffer, mimeType)
      if (!dimensions) throw new ApiError("Unable to read image dimensions")
      width = dimensions.width
      height = dimensions.height
    } else if (mimeType === "text/csv") {
      csvData = buffer.toString("utf8")
      const lines = csvData.split(/\r?\n/).filter(line => line.trim())
      csvRows = lines.length
      csvColumns = lines[0]?.split(",").length ?? 0
    } else if (isVideo) {
      const metadata = await extractVideoMetadata(original)
      if (!Number.isFinite(metadata.durationMs) || metadata.durationMs <= 0 || metadata.durationMs > 600000) throw new ApiError("Video duration must be between zero and ten minutes")
      width = metadata.width
      height = metadata.height
      durationMs = metadata.durationMs
      frameRate = metadata.frameRate ?? null
    }
    const framesBudget = isVideo ? (Math.ceil((durationMs ?? 0) / 5000) + 2) * 4 * 1024 * 1024 : 0
    const databaseBytes = (csvData ? Buffer.byteLength(csvData) : 0) + 8192
    const result = await withStorageReservation(session.user.id, buffer.length + framesBudget + databaseBytes, async reservation => {
      let frames: Prisma.InputJsonValue = []
      let frameCount: number | null = null
      let thumbnailPath: string | null = null
      if (isVideo) {
        await generateVideoThumbnail({ inputPath: original, outputPath: join(staging!, "thumbnail.jpg") })
        const extracted = await generateVideoFrames({ inputPath: original, outputDir: join(staging!, "frames"), durationMs: durationMs!, frameIntervalSeconds: 5 })
        frames = extracted.map(frame => ({ path: `${basePath}/${relative(staging!, frame.path).replace(/\\/g, "/")}`, width: frame.width, height: frame.height, timestampMs: frame.timestampMs, mimeType: frame.mimeType }))
        frameCount = extracted.length
        thumbnailPath = `${basePath}/thumbnail.jpg`
      }
      reservation.verify(await calculateFolderSize(staging!) + databaseBytes + Buffer.byteLength(JSON.stringify(frames)))
      await mkdir(join(finalDirectory!, ".."), { recursive: true })
      await cp(staging!, finalDirectory!, { recursive: true, errorOnExist: true, force: false })
      const media = await prisma.media.create({ data: {
        id: mediaId, canvasId, filename: file.name, filePath: `${basePath}/original${safeMediaExtension(mimeType)}`,
        mimeType, fileSize: buffer.length, width, height, csvData, csvRows, csvColumns,
        durationMs, frameRate, frameCount, thumbnailPath, videoFrames: frameCount === null ? Prisma.JsonNull : frames
      } })
      committed = true
      return media
    })
    return NextResponse.json({ ...result, mediaId: result.id })
  } catch (error) {
    return NextResponse.json({ error: error instanceof ApiError ? error.message : "Upload failed" }, { status: error instanceof ApiError ? error.status : 500 })
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true })
    if (!committed && finalDirectory) await rm(finalDirectory, { recursive: true, force: true })
  }
}

async function boundaryPOST(request: NextRequest) {
  return authenticatedWorkload("transfer", () => handlePOST(request))
}

export function POST(request: NextRequest) {
  return withApiBoundary(request, () => boundaryPOST(request))
}
