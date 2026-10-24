import { authenticatedWorkload } from "@/lib/authenticatedWorkload"
import { normalizeImportedProviders } from "@/lib/providers/customStore"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import archiver from "archiver"
import { stat } from "fs/promises"
import { basename } from "path"
import { Readable } from "stream"
import { resolvePublicPath, assertStorageId } from "@/lib/publicPath"
import { safeMediaExtension } from "@/lib/safeMedia"
import { parseCanonicalGraph } from "@/lib/canonicalGraph"

async function handleGET() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id
    const user = await prisma.$transaction(tx => tx.user.findUnique({ where: { id: userId }, include: { canvases: { include: { media: true, tokenUsage: true } }, settings: true } }))
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })
    const archive = archiver("zip", { zlib: { level: 6 } })
    const missingFiles: string[] = []
    const files: Array<{ fullPath: string; name: string }> = []
    const addFile = async (filePath: unknown, canvasId: string, name: string) => {
      if (typeof filePath !== "string" || !filePath) return
      try {
        const fullPath = resolvePublicPath(filePath, canvasId)
        if (!(await stat(fullPath)).isFile()) { missingFiles.push(name); return }
        files.push({ fullPath, name })
      } catch { missingFiles.push(name) }
    }
    const canvases = []
    for (const canvas of user.canvases) {
      assertStorageId(canvas.id)
      const graph = parseCanonicalGraph(canvas.content ?? { nodes: [], edges: [] })
      canvases.push({ ...canvas, nodes: graph.nodes, content: JSON.stringify(graph) })
      for (const media of canvas.media) {
        assertStorageId(media.id)
        let extension: string
        try { extension = safeMediaExtension(media.mimeType) } catch { missingFiles.push(`media/${media.id}/unsupported`); continue }
        await addFile(media.filePath, canvas.id, `media/${media.id}/original${extension}`)
        await addFile(media.thumbnailPath, canvas.id, `media/${media.id}/thumbnail.jpg`)
        const value = media.videoFrames
        const frames = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray(value.frames) ? value.frames : []
        for (const frame of frames) {
          if (frame && typeof frame === "object" && !Array.isArray(frame) && typeof frame.path === "string") await addFile(frame.path, canvas.id, `media/${media.id}/frames/${basename(frame.path)}`)
        }
      }
    }
    const userData = { id: user.id, email: user.email, name: user.name, image: user.image, createdAt: user.createdAt, updatedAt: user.updatedAt, totalNodesCreated: user.totalNodesCreated, totalCanvasesCreated: user.totalCanvasesCreated, totalTokensCreated: user.totalTokensCreated }
    const settings = user.settings ? { providers: await normalizeImportedProviders(user.settings.providers) } : {}
    const body = Readable.toWeb(archive) as ReadableStream<Uint8Array>
    archive.append(JSON.stringify(userData), { name: "user.json" })
    archive.append(JSON.stringify(canvases), { name: "canvases.json" })
    archive.append(JSON.stringify(settings), { name: "settings.json" })
    archive.append(JSON.stringify({ version: 3, missingFiles }), { name: "manifest.json" })
    for (const file of files) archive.file(file.fullPath, { name: file.name })
    archive.on("warning", () => archive.destroy(new Error("Backup file is unavailable")))
    void archive.finalize().catch(() => archive.destroy(new Error("Backup export failed")))
    return new NextResponse(body, { headers: {
      "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="user-data-export-${Date.now()}.zip"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"
    } })
  } catch {
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 })
  }
}

export function GET() {
  return authenticatedWorkload("transfer", () => handleGET())
}
