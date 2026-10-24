import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { resolvePublicPath } from "@/lib/publicPath"
import { safeMediaExtension } from "@/lib/safeMedia"
import { ApiError } from "@/lib/apiErrors"

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

    resolvePublicPath(media.filePath, media.canvasId)
    safeMediaExtension(media.mimeType)
    
    // Return current media data from DB, including gemini fields
    return NextResponse.json({
      mediaId: media.id,
      filePath: media.filePath,
      filename: media.filename,
      mimeType: media.mimeType,
      fileSize: media.fileSize,
      width: media.width,
      height: media.height,
      csvData: media.csvData,
      csvRows: media.csvRows,
      csvColumns: media.csvColumns,
      durationMs: media.durationMs,
      frameRate: media.frameRate,
      frameCount: media.frameCount,
      videoFrames: media.videoFrames,
      thumbnailPath: media.thumbnailPath,
      geminiFileUri: media.geminiFileUri,
      geminiUploadedAt: media.geminiUploadedAt ? media.geminiUploadedAt.toISOString() : null
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof ApiError ? error.message : "Failed to sync media data" }, { status: error instanceof ApiError ? error.status : 500 })
  }
}

