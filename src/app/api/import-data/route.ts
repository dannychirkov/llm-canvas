import { withApiBoundary } from "@/lib/apiBoundary"
import { authenticatedWorkload } from "@/lib/authenticatedWorkload"
import { normalizeImportedProviders } from "@/lib/providers/customStore"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { randomUUID } from "crypto"
import { mkdir, writeFile, mkdtemp, cp, rm } from "fs/promises"
import { tmpdir } from "os"
import { join, basename, extname } from "path"
import { ApiError } from "@/lib/apiErrors"
import { MAX_ARCHIVE_BYTES, readBoundedArchive } from "@/lib/safeArchive"
import { parseCanonicalGraph, remapGraphReferences, synchronizeCanvasNodes, type CanonicalGraph } from "@/lib/canonicalGraph"
import { validateMediaFilename, validateSafeMedia, safeMediaExtension, cleanupCanvasMedia } from "@/lib/safeMedia"
import { assertStorageId, resolvePublicPath } from "@/lib/publicPath"
import { withStorageReservation } from "@/lib/storageUtils"
import { readBoundedFormData } from "@/lib/boundedFormData"

export const dynamic = "force-dynamic"
type JsonRecord = Record<string, unknown>
interface BackupCanvas extends JsonRecord { id: string; title: string; graph: CanonicalGraph; media: JsonRecord[]; tokenUsage: JsonRecord[] }
interface ParsedBackup { files: Map<string, Buffer>; canvases: BackupCanvas[]; user: JsonRecord; settings: JsonRecord; warnings: string[]; exportVersion: "old" | "new" }

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("Invalid backup metadata")
  return value as JsonRecord
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value) throw new ApiError("Invalid backup text field")
  return value
}

function integer(value: unknown, fallback: number | null = null): number | null {
  if (value === undefined || value === null) return fallback
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw new ApiError("Invalid backup counter")
  return value
}

function usageSource(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string" || !["provider", "estimated", "unreported", "legacy"].includes(value)) throw new ApiError("Invalid token usage source")
  return value
}

function date(value: unknown): Date | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new ApiError("Invalid backup timestamp")
  return new Date(value)
}

function jsonFile(files: Map<string, Buffer>, name: string, required = false): unknown {
  const buffer = files.get(name)
  if (!buffer) { if (required) throw new ApiError("Backup is missing required metadata"); return {} }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)) } catch { throw new ApiError("Invalid backup JSON") }
}

function originalEntry(files: Map<string, Buffer>, media: JsonRecord): string | undefined {
  const prefix = `media/${text(media.id)}/original`
  const matches = [...files.keys()].filter(name => name.startsWith(prefix) && /^\.[a-zA-Z0-9]+$/.test(name.slice(prefix.length)))
  if (matches.length > 1) throw new ApiError("Duplicate media original")
  return matches[0]
}

function framesOf(value: unknown): JsonRecord[] {
  const frames = Array.isArray(value) ? value : value && typeof value === "object" ? record(value).frames : []
  if (frames === undefined || frames === null) return []
  if (!Array.isArray(frames)) throw new ApiError("Invalid video frame metadata")
  return frames.map(record)
}

async function parseBackup(buffer: Buffer): Promise<ParsedBackup> {
  const files = readBoundedArchive(buffer)
  const user = record(jsonFile(files, "user.json", true))
  const rawCanvases = jsonFile(files, "canvases.json", true)
  if (!Array.isArray(rawCanvases)) throw new ApiError("Invalid canvas list")
  const metadata = new Map<string, JsonRecord>()
  for (const [name] of files) {
    if (name.startsWith("media-metadata/") && name.endsWith(".json")) {
      const item = record(jsonFile(files, name))
      const id = assertStorageId(text(item.id))
      if (metadata.has(id)) throw new ApiError("Duplicate media metadata")
      metadata.set(id, item)
    } else if (!["user.json", "canvases.json", "settings.json", "manifest.json"].includes(name) && !/^media\/[a-zA-Z0-9_-]+\/(?:original\.[a-zA-Z0-9]+|thumbnail\.jpg|frames\/[^/]+\.jpg)$/.test(name)) throw new ApiError("Unsupported backup entry")
  }
  const warnings: string[] = []
  const canvasIds = new Set<string>()
  const mediaIds = new Set<string>()
  const canvases: BackupCanvas[] = []
  for (const value of rawCanvases) {
    const item = record(value)
    const id = assertStorageId(text(item.id))
    if (canvasIds.has(id)) throw new ApiError("Duplicate canvas identifier")
    canvasIds.add(id)
    const graph = parseCanonicalGraph(item.content ?? { nodes: item.nodes ?? [], edges: [] })
    const media: JsonRecord[] = []
    if (item.media !== undefined && !Array.isArray(item.media)) throw new ApiError("Invalid media list")
    for (const raw of (item.media ?? []) as unknown[]) {
      const base = record(raw)
      const mediaId = assertStorageId(text(base.id))
      if (mediaIds.has(mediaId)) throw new ApiError("Duplicate media identifier")
      mediaIds.add(mediaId)
      const mediaItem = { ...base, ...metadata.get(mediaId) }
      validateMediaFilename(text(mediaItem.filename), text(mediaItem.mimeType))
      const original = originalEntry(files, mediaItem)
      if (original) {
        const archiveFilename = `original${extname(original)}`
        validateMediaFilename(archiveFilename, text(mediaItem.mimeType))
        await validateSafeMedia(files.get(original)!, text(mediaItem.mimeType), text(mediaItem.filename))
      } else warnings.push("A media original is missing; its metadata will be restored without fabricating a file.")
      for (const [entryName, data] of files) {
        if (entryName.startsWith(`media/${mediaId}/`) && entryName !== original) await validateSafeMedia(data, "image/jpeg", basename(entryName))
      }
      media.push(mediaItem)
    }
    if (item.tokenUsage !== undefined && !Array.isArray(item.tokenUsage)) throw new ApiError("Invalid usage ledger")
    canvases.push({ ...item, id, title: text(item.title), graph, media, tokenUsage: ((item.tokenUsage ?? []) as unknown[]).map(record) })
  }
  return { files, canvases, user, settings: record(jsonFile(files, "settings.json")), warnings, exportVersion: [...files.keys()].some(name => name.startsWith("media/")) ? "new" : "old" }
}

function addPathMapping(replacements: Map<string, string>, oldPath: unknown, newPath: string) {
  if (typeof oldPath !== "string" || !oldPath) return
  replacements.set(oldPath, newPath)
  replacements.set(`/api/media/serve/${oldPath.replace(/^\//, "")}`, `/api/media/serve/${newPath.replace(/^\//, "")}`)
}

async function importBackup(parsed: ParsedBackup, userId: string, selectedIds: string[], importSettings: boolean) {
  const selected = parsed.canvases.filter(canvas => selectedIds.includes(canvas.id))
  if (selected.length !== new Set(selectedIds).size) throw new ApiError("Unknown canvas selection")
  const providers = importSettings && parsed.settings.providers ? await normalizeImportedProviders(parsed.settings.providers) as Prisma.InputJsonValue : undefined
  const staging = await mkdtemp(join(tmpdir(), "llm-canvas-import-"))
  const copied: string[] = []
  let committed = false
  try {
    const prepared: Array<{ id: string; source: BackupCanvas; graph: CanonicalGraph; media: Prisma.MediaUncheckedCreateInput[]; usage: Prisma.TokenUsageUncheckedCreateInput[] }> = []
    const reservedIds = new Set<string>()
    let additionalBytes = 0
    for (const canvas of selected) {
      const canvasId = randomUUID()
      const replacements = new Map<string, string>([[canvas.id, canvasId]])
      const existingNodes = await prisma.node.findMany({ where: { id: { in: canvas.graph.nodes.map(node => node.id) } }, select: { id: true } })
      const conflicts = new Set(existingNodes.map(node => node.id))
      for (const node of canvas.graph.nodes) {
        const id = conflicts.has(node.id) || reservedIds.has(node.id) ? randomUUID() : node.id
        reservedIds.add(id)
        replacements.set(node.id, id)
      }
      const media: Prisma.MediaUncheckedCreateInput[] = []
      for (const item of canvas.media) {
        const oldId = text(item.id)
        const mediaId = randomUUID()
        replacements.set(oldId, mediaId)
        replacements.set(`/api/media/${oldId}/base64`, `/api/media/${mediaId}/base64`)
        replacements.set(`/api/media/${oldId}/sync`, `/api/media/${mediaId}/sync`)
        const basePath = `/uploads/canvases/${canvasId}/${mediaId}`
        const filePath = `${basePath}/original${safeMediaExtension(text(item.mimeType))}`
        addPathMapping(replacements, item.filePath, filePath)
        const original = originalEntry(parsed.files, item)
        const originalData = original ? parsed.files.get(original) : undefined
        const directory = join(staging, canvasId, mediaId)
        await mkdir(directory, { recursive: true })
        if (originalData) { await writeFile(join(directory, `original${safeMediaExtension(text(item.mimeType))}`), originalData); additionalBytes += originalData.length }
        let thumbnailPath: string | null = typeof item.thumbnailPath === "string" ? `${basePath}/thumbnail.jpg` : null
        const thumbnail = parsed.files.get(`media/${oldId}/thumbnail.jpg`)
        if (typeof item.thumbnailPath === "string") addPathMapping(replacements, item.thumbnailPath, `${basePath}/thumbnail.jpg`)
        if (thumbnail) {
          await writeFile(join(directory, "thumbnail.jpg"), thumbnail)
          additionalBytes += thumbnail.length
          thumbnailPath = `${basePath}/thumbnail.jpg`
          addPathMapping(replacements, item.thumbnailPath, thumbnailPath)
        }
        const frames: Prisma.InputJsonObject[] = []
        const originalFrames = framesOf(item.videoFrames)
        for (const frame of originalFrames) {
          if (typeof frame.path !== "string") throw new ApiError("Invalid frame path")
          const filename = basename(frame.path)
          validateMediaFilename(filename, "image/jpeg")
          const newPath = `${basePath}/frames/${filename}`
          addPathMapping(replacements, frame.path, newPath)
          frames.push({ ...frame, path: newPath, mimeType: "image/jpeg" } as Prisma.InputJsonObject)
        }
        for (const [entryName, data] of parsed.files) {
          if (!entryName.startsWith(`media/${oldId}/frames/`)) continue
          const filename = basename(entryName)
          const oldFrame = originalFrames.find(frame => typeof frame.path === "string" && basename(frame.path) === filename)
          const newPath = `${basePath}/frames/${filename}`
          await mkdir(join(directory, "frames"), { recursive: true })
          await writeFile(join(directory, "frames", filename), data)
          additionalBytes += data.length
          addPathMapping(replacements, oldFrame?.path, newPath)
          if (!frames.some(frame => frame.path === newPath)) frames.push({ ...(oldFrame ?? {}), path: newPath, mimeType: "image/jpeg" } as Prisma.InputJsonObject)
        }
        const frameRate = item.frameRate
        if (frameRate !== undefined && frameRate !== null && (typeof frameRate !== "number" || !Number.isFinite(frameRate) || frameRate < 0)) throw new ApiError("Invalid frame rate")
        media.push({ id: mediaId, canvasId, filename: text(item.filename), filePath, mimeType: text(item.mimeType), fileSize: originalData?.length ?? integer(item.fileSize, 0)!,
          width: integer(item.width), height: integer(item.height), csvData: typeof item.csvData === "string" ? item.csvData : null,
          csvRows: integer(item.csvRows), csvColumns: integer(item.csvColumns), durationMs: integer(item.durationMs), frameRate: typeof frameRate === "number" ? frameRate : null,
          frameCount: frames.length || integer(item.frameCount), thumbnailPath, videoFrames: frames.length ? frames : Prisma.JsonNull, createdAt: date(item.createdAt), updatedAt: date(item.updatedAt) })
      }
      const graph = parseCanonicalGraph(remapGraphReferences(canvas.graph, replacements))
      const usage = canvas.tokenUsage.map(item => ({
        id: randomUUID(), canvasId, operator: text(item.operator), modelName: text(item.modelName), totalTokens: integer(item.totalTokens, 0)!,
        usageSource: usageSource(item.usageSource), inputTokens: integer(item.inputTokens), outputTokens: integer(item.outputTokens), reasoningTokens: integer(item.reasoningTokens),
        cachedTokens: integer(item.cachedTokens), audioTokens: integer(item.audioTokens), videoTokens: integer(item.videoTokens), imageTokens: integer(item.imageTokens), otherTools: integer(item.otherTools), createdAt: date(item.createdAt)
      }))
      additionalBytes += Buffer.byteLength(JSON.stringify(graph)) + Buffer.byteLength(JSON.stringify(graph.nodes)) + Buffer.byteLength(JSON.stringify(media)) + usage.length * 512 + 4096
      prepared.push({ id: canvasId, source: canvas, graph, media, usage })
    }
    const importedNodes = prepared.reduce((total, item) => total + item.graph.nodes.length, 0)
    const importedMedia = prepared.reduce((total, item) => total + item.media.length, 0)
    const importedTokens = prepared.reduce((total, item) => total + (integer(item.source.totalTokensUsed) ?? item.usage.reduce((sum, usage) => sum + usage.totalTokens, 0)), 0)
    const wholeBackup = selected.length === parsed.canvases.length
    await withStorageReservation(userId, additionalBytes, async () => {
      for (const item of prepared) {
        const target = join(resolvePublicPath(`/uploads/canvases/${item.id}/placeholder`, item.id, { allowLegacy: false }), "..")
        copied.push(item.id)
        if (item.media.length) {
          await mkdir(join(target, ".."), { recursive: true })
          await cp(join(staging, item.id), target, { recursive: true, force: false, errorOnExist: true })
        } else await mkdir(target, { recursive: true })
      }
      await prisma.$transaction(async tx => {
        for (const item of prepared) {
          const source = item.source
          await tx.canvas.create({ data: {
            id: item.id, userId, title: `[imported] ${source.title}`, description: typeof source.description === "string" ? source.description : null,
            content: JSON.stringify(item.graph), isPublic: false, isPinned: source.isPinned === true, nodeCount: item.graph.nodes.length,
            totalTokensUsed: integer(source.totalTokensUsed) ?? item.usage.reduce((sum, usage) => sum + usage.totalTokens, 0),
            largestContextTokens: integer(source.largestContextTokens), contextCacheUpdated: date(source.contextCacheUpdated), createdAt: date(source.createdAt)
          } })
          await synchronizeCanvasNodes(tx, item.id, item.graph)
          for (const media of item.media) await tx.media.create({ data: media })
          for (const usage of item.usage) await tx.tokenUsage.create({ data: usage })
        }
        if (providers !== undefined) await tx.userSettings.upsert({ where: { userId }, create: { userId, providers }, update: { providers } })
        await tx.user.update({ where: { id: userId }, data: {
          totalCanvasesCreated: { increment: wholeBackup ? Math.max(prepared.length, integer(parsed.user.totalCanvasesCreated, 0)!) : prepared.length },
          totalNodesCreated: { increment: wholeBackup ? Math.max(importedNodes, integer(parsed.user.totalNodesCreated, 0)!) : importedNodes },
          totalTokensCreated: { increment: wholeBackup ? Math.max(importedTokens, integer(parsed.user.totalTokensCreated, 0)!) : importedTokens }
        } })
      }, { timeout: 30000 })
      committed = true
    })
    return { success: true, importedCanvases: prepared.length, importedNodes, importedMedia, errors: [], warnings: parsed.warnings }
  } finally {
    await rm(staging, { recursive: true, force: true })
    if (!committed) for (const canvasId of copied) await cleanupCanvasMedia(canvasId)
  }
}

async function handlePOST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) throw new ApiError("Unauthorized", 401)
    const form = await readBoundedFormData(request, MAX_ARCHIVE_BYTES + 1024 * 1024)
    const file = form.get("file")
    if (!(file instanceof File)) throw new ApiError("No backup file provided")
    if (file.size > MAX_ARCHIVE_BYTES) throw new ApiError("Archive is too large", 413)
    const parsed = await parseBackup(Buffer.from(await file.arrayBuffer()))
    const action = form.get("action") ?? "preview"
    if (action === "preview") {
      const existing = await prisma.canvas.findMany({ where: { userId: session.user.id }, select: { title: true } })
      const titles = new Set(existing.map(canvas => canvas.title.toLowerCase()))
      return NextResponse.json({ exportVersion: parsed.exportVersion, canvases: parsed.canvases.map(canvas => ({
        originalId: canvas.id, originalTitle: canvas.title, newTitle: `[imported] ${canvas.title}`, nodeCount: canvas.graph.nodes.length,
        mediaCount: canvas.media.length, mediaWithFiles: canvas.media.filter(media => originalEntry(parsed.files, media)).length,
        hasConflicts: titles.has(`[imported] ${canvas.title}`.toLowerCase())
      })), settings: !!parsed.settings.providers, totalNodes: parsed.canvases.reduce((sum, canvas) => sum + canvas.graph.nodes.length, 0), totalMedia: parsed.canvases.reduce((sum, canvas) => sum + canvas.media.length, 0), warnings: parsed.warnings })
    }
    if (action !== "import") throw new ApiError("Invalid import action")
    let selected: unknown
    try { selected = JSON.parse(String(form.get("selectedCanvasIds"))) } catch { throw new ApiError("Invalid canvas selection") }
    if (!Array.isArray(selected) || selected.some(id => typeof id !== "string")) throw new ApiError("Invalid canvas selection")
    return NextResponse.json(await importBackup(parsed, session.user.id, selected, form.get("importSettings") === "true"))
  } catch (error) {
    return NextResponse.json({ error: error instanceof ApiError ? error.message : "Failed to import data" }, { status: error instanceof ApiError ? error.status : 400 })
  }
}

async function boundaryPOST(request: NextRequest) {
  return authenticatedWorkload("transfer", () => handlePOST(request))
}

export function POST(request: NextRequest) {
  return withApiBoundary(request, () => boundaryPOST(request))
}
