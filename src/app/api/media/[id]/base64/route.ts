import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
const { readFile } = fs.promises
import { resolvePublicPath } from "@/lib/publicPath"
import { validateSafeMedia } from "@/lib/safeMedia"
import { MAX_IMAGE_OR_CSV_SIZE } from "@/lib/storageConstants"
import { ApiError } from "@/lib/apiErrors"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const media = await prisma.media.findUnique({
      where: { id },
      include: {
        canvas: {
          select: { userId: true }
        }
      }
    })

    if (!media) {
      return NextResponse.json({ error: "Media not found" }, { status: 404 })
    }

    // Access rights check
    if (media.canvas.userId !== session.user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    if (media.mimeType.startsWith('video/')) {
      return NextResponse.json({ error: "Video files cannot be converted to base64" }, { status: 400 })
    }

    const fullPath = resolvePublicPath(media.filePath, media.canvasId)
    const stats = await fs.promises.stat(fullPath)
    if (stats.size > MAX_IMAGE_OR_CSV_SIZE) return NextResponse.json({ error: "Media is too large" }, { status: 413 })

    const fileBuffer = await readFile(fullPath)
    await validateSafeMedia(fileBuffer, media.mimeType, media.filename)
    const base64 = fileBuffer.toString('base64')
    const dataUrl = `data:${media.mimeType};base64,${base64}`

    return NextResponse.json({
      dataUrl,
      mimeType: media.mimeType,
      filename: media.filename,
      width: media.width,
      height: media.height,
      csvData: media.csvData,
      csvRows: media.csvRows,
      csvColumns: media.csvColumns
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof ApiError ? error.message : "Failed to convert to base64" }, { status: error instanceof ApiError ? error.status : 500 })
  }
}
