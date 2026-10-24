const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const { execFileSync, execFile } = require("node:child_process")
const { promisify } = require("node:util")
const { PrismaClient } = require("@prisma/client")
const AdmZip = require("adm-zip")
const { createLoader } = require("./loadSource")

const repository = process.cwd()
let directory
let prisma
let currentUser = "owner-data"
let load
let notes
let importer
let exporter
let paths
let media
let storage
let graphs
let archives
let serve
let upload
let base64
let boundedForm

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwWQAAAAASUVORK5CYII=", "base64")
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q==", "base64")

test.before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "llm-canvas-data-test-"))
  const schema = (await fs.readFile("prisma/schema.prisma", "utf8")).replace(/datasource db \{[\s\S]*?\}/, `datasource db {\n  provider = "sqlite"\n  url = "file:${directory}/fixture.db"\n}`)
  const schemaPath = path.join(directory, "schema.prisma")
  await fs.writeFile(schemaPath, schema)
  execFileSync(process.execPath, [path.join(repository, "node_modules/prisma/build/index.js"), "db", "push", "--schema", schemaPath, "--skip-generate"], { stdio: "pipe", env: { ...process.env, DATABASE_URL: `file:${directory}/fixture.db` } })
  prisma = new PrismaClient({ datasources: { db: { url: `file:${directory}/fixture.db` } } })
  await prisma.user.create({ data: { id: currentUser, email: "owner-data@example.invalid", isOwner: true } })
  await prisma.user.create({ data: { id: "victim-data", email: "victim-data@example.invalid" } })
  load = createLoader({
    "@/lib/prisma": { prisma },
    "@/lib/auth": { auth: async () => currentUser ? { user: { id: currentUser } } : null },
    "@/lib/providers/customStore": { normalizeImportedProviders: async value => value },
    "@/lib/imageUtils": { getImageDimensionsFromBuffer: async () => ({ width: 1, height: 1 }) },
    "@/lib/videoUtils": {
      extractVideoMetadata: async () => ({ width: 1, height: 1, durationMs: 6000, frameRate: 1 }),
      generateVideoThumbnail: async ({ outputPath }) => fs.writeFile(outputPath, jpeg),
      generateVideoFrames: async ({ outputDir }) => {
        await fs.mkdir(outputDir, { recursive: true })
        const framePath = path.join(outputDir, "frame_00001.jpg")
        await fs.writeFile(framePath, jpeg)
        return [{ path: framePath, width: 1, height: 1, timestampMs: 0, mimeType: "image/jpeg" }]
      }
    },
    "file-type": { fileTypeFromBuffer: async buffer => (await import("file-type")).fileTypeFromBuffer(buffer) }
  })
  notes = load("src/app/api/nodes/[id]/notes/route.ts")
  importer = load("src/app/api/import-data/route.ts")
  exporter = load("src/app/api/export-data/route.ts")
  paths = load("src/lib/publicPath.ts")
  media = load("src/lib/safeMedia.ts")
  storage = load("src/lib/storageUtils.ts")
  graphs = load("src/lib/canonicalGraph.ts")
  archives = load("src/lib/safeArchive.ts")
  serve = load("src/app/api/media/serve/[...path]/route.ts")
  upload = load("src/app/api/media/upload/route.ts")
  base64 = load("src/app/api/media/[id]/base64/route.ts")
  boundedForm = load("src/lib/boundedFormData.ts")
  await fs.mkdir(path.join(directory, "public"), { recursive: true })
})

test.after(async () => {
  process.chdir(repository)
  if (prisma) await prisma.$disconnect()
  if (directory) await fs.rm(directory, { recursive: true, force: true })
})

async function isolated(operation) {
  process.chdir(directory)
  try { return await operation() } finally { process.chdir(repository) }
}

function graph(id, data = {}) {
  return { nodes: [{ id, type: "text", position: { x: 0, y: 0 }, data }], edges: [] }
}

async function canvas(id, document, userId = "owner-data") {
  return prisma.canvas.create({ data: { id, title: id, userId, content: JSON.stringify(document), nodeCount: document.nodes.length } })
}

function noteRequest(canvasId, nodeId, body) {
  return new Request(`http://localhost/api/nodes/${nodeId}/notes?canvasId=${canvasId}`, body ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ canvasId, ...body }) } : undefined)
}

function backup(canvases, user = {}, extra = {}) {
  const archive = new AdmZip()
  archive.addFile("user.json", Buffer.from(JSON.stringify(user)))
  archive.addFile("canvases.json", Buffer.from(JSON.stringify(canvases)))
  archive.addFile("settings.json", Buffer.from("{}"))
  for (const [name, buffer] of Object.entries(extra)) archive.addFile(name, buffer)
  return archive.toBuffer()
}

function importRequest(buffer, ids, action = "import") {
  const form = new FormData()
  form.append("file", new File([buffer], "backup.zip", { type: "application/zip" }))
  form.append("action", action)
  form.append("selectedCanvasIds", JSON.stringify(ids))
  return new Request("http://localhost/api/import-data", { method: "POST", body: form })
}

test("notes read canonical graph instead of a stale Node row", async () => {
  await canvas("canonical-notes", graph("canonical-note-node", { notes: "current graph" }))
  await prisma.node.create({ data: { id: "canonical-note-node", canvasId: "canonical-notes", type: "text", position: { x: 0, y: 0 }, data: { notes: "stale row" } } })
  const response = await notes.GET(noteRequest("canonical-notes", "canonical-note-node"), { params: Promise.resolve({ id: "canonical-note-node" }) })
  const result = await response.json()
  assert.equal(result.notes, "current graph")
  assert.ok(result.updatedAt)
  assert.equal(response.headers.get("cache-control"), "no-store")
})

test("notes foreign global identifier conflict rolls back both graph and Node writes", async () => isolated(async () => {
  await canvas("victim-canvas", graph("global-victim-node", { notes: "private" }), "victim-data")
  await prisma.node.create({ data: { id: "global-victim-node", canvasId: "victim-canvas", type: "text", position: {}, data: { notes: "private" } } })
  const owned = await canvas("attacker-canvas", graph("global-victim-node", { notes: "owned" }))
  const response = await notes.PUT(noteRequest(owned.id, "global-victim-node", { notes: "tampered", expectedUpdatedAt: owned.updatedAt.toISOString() }), { params: Promise.resolve({ id: "global-victim-node" }) })
  assert.equal(response.status, 409)
  assert.equal((await prisma.node.findUnique({ where: { id: "global-victim-node" } })).data.notes, "private")
  assert.equal(JSON.parse((await prisma.canvas.findUnique({ where: { id: owned.id } })).content).nodes[0].data.notes, "owned")
}))

test("notes require a revision, reject stale writes, and keep graph and rows consistent", async () => isolated(async () => {
  const owned = await canvas("notes-cas", graph("notes-cas-node", { notes: "initial" }))
  const context = { params: Promise.resolve({ id: "notes-cas-node" }) }
  assert.equal((await notes.PUT(noteRequest(owned.id, "notes-cas-node", { notes: "missing" }), context)).status, 428)
  const first = await notes.PUT(noteRequest(owned.id, "notes-cas-node", { notes: "first", expectedUpdatedAt: owned.updatedAt.toISOString() }), context)
  assert.equal(first.status, 200)
  const firstResult = await first.json()
  assert.notEqual(firstResult.updatedAt, owned.updatedAt.toISOString())
  assert.equal(firstResult.baseUpdatedAt, owned.updatedAt.toISOString())
  const stale = await notes.PUT(noteRequest(owned.id, "notes-cas-node", { notes: "last", expectedUpdatedAt: owned.updatedAt.toISOString() }), context)
  assert.equal(stale.status, 409)
  const saved = await prisma.canvas.findUnique({ where: { id: owned.id } })
  assert.equal(JSON.parse(saved.content).nodes[0].data.notes, "first")
  assert.equal((await prisma.node.findUnique({ where: { id: "notes-cas-node" } })).data.notes, "first")
}))

test("canonical synchronization preserves IDs and deletes stale scoped rows", async () => {
  await canvas("sync-canvas", graph("sync-keep"))
  await prisma.node.create({ data: { id: "sync-delete", canvasId: "sync-canvas", type: "text", position: {}, data: {} } })
  await prisma.$transaction(tx => graphs.synchronizeCanvasNodes(tx, "sync-canvas", graph("sync-keep", { notes: "saved" })))
  assert.deepEqual((await prisma.node.findMany({ where: { canvasId: "sync-canvas" } })).map(node => node.id), ["sync-keep"])
})

test("media resolver rejects non-upload files, traversal, encoded tricks and other canvases", async () => isolated(async () => {
  for (const candidate of ["/.env", "/uploads/canvases/owned/../foreign/a.png", "/uploads/canvases/owned/%2e%2e/a.png", "/uploads/canvases/owned\\a.png", "/uploads/canvases/foreign/a.png", "/uploads/canvases/owned/a.png?download=1"]) assert.throws(() => paths.resolvePublicPath(candidate, "owned"))
  assert.equal(paths.resolvePublicPath("/uploads/canvases/owned/a.png", "owned"), path.join(directory, "public/uploads/canvases/owned/a.png"))
  assert.ok(paths.resolvePublicPath("/canvases/owned/nanobanana_old.png", "owned").endsWith("nanobanana_old.png"))
  assert.throws(() => paths.resolvePublicPath("/canvases/owned/a.png", "owned", { allowLegacy: false }))
  await fs.mkdir(path.join(directory, "public/uploads/canvases/symlink-canvas"), { recursive: true })
  await fs.symlink(os.tmpdir(), path.join(directory, "public/uploads/canvases/symlink-canvas/link"))
  assert.throws(() => paths.resolvePublicPath("/uploads/canvases/symlink-canvas/link/file.png", "symlink-canvas"))
}))

test("active content and filename extension tricks are rejected", async () => {
  for (const filename of ["review.html", "image.svg", "script.js.csv", "nested/ok.csv", "bad%2ehtml.csv", "trailing.csv.html"]) assert.throws(() => media.validateMediaFilename(filename, "text/csv"))
  await assert.rejects(media.validateSafeMedia(Buffer.from("<html><script>fixture</script></html>"), "text/csv", "safe.csv"))
  await assert.rejects(media.validateSafeMedia(Buffer.from("<img src=x onerror=fixture>"), "text/csv", "safe.csv"))
  await assert.rejects(media.validateSafeMedia(Buffer.from("<svg/>"), "image/svg+xml", "safe.svg"))
  await media.validateSafeMedia(Buffer.from("name,value\nfixture,1\n"), "text/csv", "safe.csv")
  assert.equal(media.mediaResponseHeaders("text/csv")["X-Content-Type-Options"], "nosniff")
  assert.match(media.mediaResponseHeaders("text/csv")["Content-Disposition"], /attachment/)
})

test("bounded ZIP rejects expansion budgets before calling an entry inflater", () => {
  const bomb = new AdmZip()
  bomb.addFile("expanded.txt", Buffer.alloc(2 * 1024 * 1024))
  assert.throws(() => archives.readBoundedArchive(bomb.toBuffer()), /expansion limit/)
  const forged = new AdmZip()
  forged.addFile("forged.txt", Buffer.from("small"))
  const bytes = forged.toBuffer()
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  bytes.writeUInt32LE(archives.MAX_ARCHIVE_ENTRY_BYTES + 1, central + 24)
  assert.throws(() => archives.readBoundedArchive(bytes), /expansion limit/)
  const count = Buffer.from(bytes)
  const end = count.length - 22
  count.writeUInt16LE(archives.MAX_ARCHIVE_ENTRIES + 1, end + 8)
  count.writeUInt16LE(archives.MAX_ARCHIVE_ENTRIES + 1, end + 10)
  assert.throws(() => archives.readBoundedArchive(count), /oversized/)
})

test("bounded ZIP enforces actual inflation even when the declared size lies", () => {
  const archive = new AdmZip()
  archive.addFile("payload.txt", Buffer.from("a".repeat(10000)))
  const bytes = archive.toBuffer()
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  bytes.writeUInt32LE(1, central + 24)
  bytes.writeUInt32LE(1, 22)
  assert.throws(() => archives.readBoundedArchive(bytes), /oversized ZIP entry|Invalid ZIP/)
})

test("import remaps media in nested graph state and preserves node IDs, usage and counters", async () => isolated(async () => {
  const oldPath = "/uploads/canvases/backup-origin/old.csv"
  const document = graph("backup-preserved-node", { mediaId: "backup-media", filePath: oldPath, response: { images: [{ mediaId: "backup-media", url: `/api/media/serve${oldPath}` }] }, responseHistory: JSON.stringify([{ mediaId: "backup-media", filePath: oldPath }]) })
  const payload = backup([{ id: "backup-origin", title: "Roundtrip", content: JSON.stringify(document), totalTokensUsed: 17,
    tokenUsage: [{ operator: "custom", modelName: "fixture-model", totalTokens: 17, inputTokens: 11, outputTokens: 6, createdAt: "2026-01-01T00:00:00.000Z" }],
    media: [{ id: "backup-media", filename: "old.csv", filePath: oldPath, mimeType: "text/csv", fileSize: 10, csvData: "name\nvalue" }]
  }], { totalCanvasesCreated: 5, totalNodesCreated: 9, totalTokensCreated: 99 }, { "media/backup-media/original.csv": Buffer.from("name\nvalue") })
  const before = await prisma.user.findUnique({ where: { id: currentUser } })
  const response = await importer.POST(importRequest(payload, ["backup-origin"]))
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
  const restored = await prisma.canvas.findFirst({ where: { title: "[imported] Roundtrip" }, include: { media: true, nodes: true, tokenUsage: true } })
  const data = JSON.parse(restored.content).nodes[0].data
  assert.equal(restored.nodes[0].id, "backup-preserved-node")
  assert.notEqual(restored.media[0].id, "backup-media")
  assert.equal(data.mediaId, restored.media[0].id)
  assert.equal(data.filePath, restored.media[0].filePath)
  assert.equal(data.response.images[0].url, `/api/media/serve${restored.media[0].filePath}`)
  assert.equal(JSON.parse(data.responseHistory)[0].mediaId, restored.media[0].id)
  assert.equal(restored.totalTokensUsed, 17)
  assert.equal(restored.tokenUsage[0].inputTokens, 11)
  assert.equal(restored.tokenUsage[0].createdAt.toISOString(), "2026-01-01T00:00:00.000Z")
  assert.equal(await fs.readFile(paths.resolvePublicPath(restored.media[0].filePath, restored.id), "utf8"), "name\nvalue")
  const after = await prisma.user.findUnique({ where: { id: currentUser } })
  assert.equal(after.totalCanvasesCreated - before.totalCanvasesCreated, 5)
  assert.equal(after.totalNodesCreated - before.totalNodesCreated, 9)
  assert.equal(after.totalTokensCreated - before.totalTokensCreated, 99)
}))

test("repeated import remaps conflicting node IDs and edge endpoints together", async () => isolated(async () => {
  const document = { nodes: [...graph("existing-shared-node").nodes, ...graph("second-shared-node").nodes], edges: [{ id: "edge", source: "existing-shared-node", target: "second-shared-node" }] }
  await canvas("existing-graph", document)
  await prisma.$transaction(tx => graphs.synchronizeCanvasNodes(tx, "existing-graph", document))
  const response = await importer.POST(importRequest(backup([{ id: "collision-backup", title: "Collision", content: JSON.stringify(document) }]), ["collision-backup"]))
  assert.equal(response.status, 200)
  const saved = await prisma.canvas.findFirst({ where: { title: "[imported] Collision" }, include: { nodes: true } })
  const restored = JSON.parse(saved.content)
  assert.notEqual(restored.nodes[0].id, document.nodes[0].id)
  assert.equal(restored.edges[0].source, restored.nodes[0].id)
  assert.deepEqual(saved.nodes.map(node => node.id).sort(), restored.nodes.map(node => node.id).sort())
}))

test("invalid media import writes neither canvas rows nor upload directories", async () => isolated(async () => {
  const before = await prisma.canvas.count()
  const response = await importer.POST(importRequest(backup([{ id: "unsafe-backup", title: "Unsafe", content: JSON.stringify(graph("unsafe-node")), media: [{ id: "unsafe-media", filename: "active.html", mimeType: "text/html" }] }], {}, { "media/unsafe-media/original.html": Buffer.from("<html>fixture</html>") }), ["unsafe-backup"]))
  assert.equal(response.status, 400)
  assert.equal(await prisma.canvas.count(), before)
}))

test("failed import DB transaction removes all copied upload assets", async () => isolated(async () => {
  const beforeCanvases = await prisma.canvas.count()
  const root = path.join(directory, "public/uploads/canvases")
  const beforeFiles = (await fs.readdir(root)).sort()
  const response = await importer.POST(importRequest(backup([{ id: "rollback-backup", title: "Rollback", content: JSON.stringify(graph("rollback-node")), totalTokensUsed: -1, media: [{ id: "rollback-media", filename: "safe.csv", mimeType: "text/csv" }] }], {}, { "media/rollback-media/original.csv": Buffer.from("name\nvalue") }), ["rollback-backup"]))
  assert.equal(response.status, 400)
  assert.equal(await prisma.canvas.count(), beforeCanvases)
  assert.deepEqual((await fs.readdir(root)).sort(), beforeFiles)
}))

test("export includes canonical nodes, detailed usage and historical user counters", async () => isolated(async () => {
  const response = await exporter.GET()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const entries = archives.readBoundedArchive(Buffer.from(await response.arrayBuffer()))
  const exported = JSON.parse(entries.get("canvases.json").toString())
  const restored = exported.find(item => item.title === "[imported] Roundtrip")
  assert.equal(restored.totalTokensUsed, 17)
  assert.equal(restored.tokenUsage[0].outputTokens, 6)
  assert.equal(restored.nodes[0].id, "backup-preserved-node")
  const user = JSON.parse(entries.get("user.json").toString())
  assert.equal(user.totalTokensCreated, (await prisma.user.findUnique({ where: { id: currentUser } })).totalTokensCreated)
  assert.equal(Object.hasOwn(user, "passwordHash"), false)
  const exportedMedia = restored.media[0]
  assert.equal(entries.get(`media/${exportedMedia.id}/original.csv`).toString(), "name\nvalue")
  const roundtrip = backup([restored], user, Object.fromEntries([...entries].filter(([name]) => name.startsWith(`media/${exportedMedia.id}/`))))
  const imported = await importer.POST(importRequest(roundtrip, [restored.id]))
  assert.equal(imported.status, 200)
  const twice = await prisma.canvas.findFirst({ where: { title: "[imported] [imported] Roundtrip" }, include: { tokenUsage: true, media: true } })
  assert.equal(twice.totalTokensUsed, 17)
  assert.equal(twice.tokenUsage[0].totalTokens, 17)
  assert.equal(JSON.parse(twice.content).nodes[0].data.mediaId, twice.media[0].id)
}))

test("measured storage reflects actual graph bytes instead of per-canvas averages", async () => isolated(async () => {
  await prisma.user.create({ data: { id: "measured-user", email: "measured@example.invalid", storageLimitBytes: 2000000 } })
  await canvas("measured-canvas", graph("measured-node", { notes: "x".repeat(300000) }), "measured-user")
  const usage = await storage.calculateUserStorageUsage("measured-user", 1, 0, 0, ["measured-canvas"])
  assert.ok(usage.breakdown.database > 300000)
}))

test("quota reservation serializes competing writes and rejects the second allocation", async () => isolated(async () => {
  await prisma.user.create({ data: { id: "quota-user", email: "quota@example.invalid", storageLimitBytes: 100 } })
  await canvas("quota-canvas", graph("quota-node"), "quota-user")
  const baseline = await storage.checkStorageLimit("quota-user", 0)
  await prisma.user.update({ where: { id: "quota-user" }, data: { storageLimitBytes: baseline.currentUsage + 100 } })
  const target = path.join(directory, "public/uploads/canvases/quota-canvas")
  let writes = 0
  const operation = () => storage.withStorageReservation("quota-user", 70, async reservation => {
    reservation.verify(70)
    await new Promise(resolve => setTimeout(resolve, 25))
    await fs.mkdir(target, { recursive: true })
    await fs.writeFile(path.join(target, `${writes++}.csv`), Buffer.alloc(70))
  })
  const results = await Promise.allSettled([operation(), operation()])
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1)
  assert.equal(results.find(result => result.status === "rejected").reason.status, 403)
  assert.equal(writes, 1)
}))

test("quota denies import before destination copy and database writes", async () => isolated(async () => {
  const previousUser = currentUser
  currentUser = "quota-user"
  try {
    const before = await prisma.canvas.count({ where: { userId: currentUser } })
    const response = await importer.POST(importRequest(backup([{ id: "quota-backup", title: "Quota", content: JSON.stringify(graph("quota-import-node")) }]), ["quota-backup"]))
    assert.equal(response.status, 403)
    assert.equal(await prisma.canvas.count({ where: { userId: currentUser } }), before)
  } finally { currentUser = previousUser }
}))

test("cleanup removes originals, video frame trees and legacy assets only for one canvas", async () => isolated(async () => {
  for (const namespace of ["uploads/canvases", "canvases"]) {
    const target = path.join(directory, "public", namespace, "cleanup-canvas", "media", "frames")
    await fs.mkdir(target, { recursive: true })
    await fs.writeFile(path.join(target, "frame.jpg"), "fixture")
  }
  await media.cleanupCanvasMedia("cleanup-canvas")
  await assert.rejects(fs.stat(path.join(directory, "public/uploads/canvases/cleanup-canvas")), { code: "ENOENT" })
  await assert.rejects(fs.stat(path.join(directory, "public/canvases/cleanup-canvas")), { code: "ENOENT" })
  assert.ok(await fs.stat(path.join(directory, "public/uploads/canvases/quota-canvas")))
  await assert.rejects(media.cleanupCanvasMedia("../quota-canvas"))
}))

test("upload, authenticated serving, byte ranges and base64 use one owned namespace", async () => isolated(async () => {
  await canvas("upload-fixture", graph("upload-fixture-node"))
  const form = new FormData()
  form.append("file", new File([png], "fixture.png", { type: "image/png" }))
  form.append("canvasId", "upload-fixture")
  const response = await upload.POST(new Request("http://localhost/api/media/upload", { method: "POST", body: form }))
  assert.equal(response.status, 200)
  const stored = await response.json()
  assert.match(stored.filePath, /^\/uploads\/canvases\/upload-fixture\//)
  const context = { params: Promise.resolve({ path: stored.filePath.slice(1).split("/") }) }
  const served = await serve.GET(new Request("http://localhost/api/media/serve"), context)
  assert.equal(served.status, 200)
  assert.equal(served.headers.get("x-content-type-options"), "nosniff")
  assert.equal(served.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), png)
  const ranged = await serve.GET(new Request("http://localhost/api/media/serve", { headers: { range: "bytes=1-4" } }), context)
  assert.equal(ranged.status, 206)
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), png.subarray(1, 5))
  const invalid = await serve.GET(new Request("http://localhost/api/media/serve", { headers: { range: "bytes=9999-" } }), context)
  assert.equal(invalid.status, 416)
  const encoded = await base64.GET(new Request("http://localhost/api/media/base64"), { params: Promise.resolve({ id: stored.id }) })
  assert.equal(encoded.status, 200)
  assert.equal((await encoded.json()).dataUrl, `data:image/png;base64,${png.toString("base64")}`)
  currentUser = "victim-data"
  try { assert.equal((await serve.GET(new Request("http://localhost/api/media/serve"), context)).status, 404) } finally { currentUser = "owner-data" }
}))

test("upload rejects CSV HTML filename tricks and HTML disguised as CSV", async () => isolated(async () => {
  for (const filename of ["active.html", "active.csv"]) {
    const form = new FormData()
    form.append("file", new File(["<html><script>fixture</script></html>"], filename, { type: "text/csv" }))
    form.append("canvasId", "upload-fixture")
    assert.equal((await upload.POST(new Request("http://localhost/api/media/upload", { method: "POST", body: form }))).status, 400)
  }
}))

test("media serving recognizes wrapped video frame metadata and protects originals", async () => isolated(async () => {
  await canvas("wrapped-video", graph("wrapped-video-node"))
  const basePath = "/uploads/canvases/wrapped-video/media"
  const framePath = `${basePath}/frames/frame.jpg`
  const fullPath = paths.resolvePublicPath(framePath, "wrapped-video")
  await fs.mkdir(path.dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, jpeg)
  await prisma.media.create({ data: { id: "wrapped-video-media", canvasId: "wrapped-video", filename: "video.mp4", filePath: `${basePath}/video.mp4`, mimeType: "video/mp4", fileSize: 0, videoFrames: { frames: [{ path: framePath, mimeType: "image/jpeg" }] } } })
  const response = await serve.GET(new Request("http://localhost/api/media/serve"), { params: Promise.resolve({ path: framePath.slice(1).split("/") }) })
  assert.equal(response.status, 200)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg)
}))

test("media gateways reject anonymous access before querying files", async () => isolated(async () => {
  currentUser = null
  try {
    assert.equal((await serve.GET(new Request("http://localhost/api/media/serve"), { params: Promise.resolve({ path: ["uploads", "canvases", "upload-fixture", "missing.png"] }) })).status, 401)
    assert.equal((await base64.GET(new Request("http://localhost/api/media/base64"), { params: Promise.resolve({ id: "missing" }) })).status, 401)
    assert.equal((await upload.POST(new Request("http://localhost/api/media/upload", { method: "POST" }))).status, 401)
  } finally { currentUser = "owner-data" }
}))

test("multipart reader bounds streamed bytes even without content-length", async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(200)); controller.close() } })
  const request = new Request("http://localhost/upload", { method: "POST", body, duplex: "half", headers: { "content-type": "multipart/form-data; boundary=fixture" } })
  await assert.rejects(boundedForm.readBoundedFormData(request, 100), error => error.status === 413)
})

test("shared quota guard serializes independent application processes", async () => isolated(async () => {
  await prisma.user.create({ data: { id: "process-quota-user", email: "process-quota@example.invalid", storageLimitBytes: 1000000 } })
  await canvas("process-quota-canvas", graph("process-quota-node"), "process-quota-user")
  const baseline = await storage.checkStorageLimit("process-quota-user", 0)
  await prisma.user.update({ where: { id: "process-quota-user" }, data: { storageLimitBytes: baseline.currentUsage + 1000 } })
  const operation = () => promisify(execFile)(process.execPath, [path.join(repository, "tests/dataQuotaWorker.js"), directory, path.join(directory, "fixture.db"), "process-quota-user", "process-quota-canvas"], { cwd: repository })
  const results = await Promise.allSettled([operation(), operation()])
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1)
  assert.equal(results.find(result => result.status === "rejected").reason.code, 23)
}))

test("video restore remaps thumbnails, wrapped frames and nested response history", async () => isolated(async () => {
  const originalPath = "/uploads/canvases/video-backup/video.mp4"
  const oldThumbnail = "/uploads/canvases/video-backup/old-media/thumbnail.jpg"
  const oldFrame = "/uploads/canvases/video-backup/old-media/frames/frame_00001.jpg"
  const missingFrame = "/uploads/canvases/video-backup/old-media/frames/frame_00002.jpg"
  const videoFrames = { frames: [{ path: oldFrame, width: 1, height: 1, timestampMs: 0 }, { path: missingFrame, timestampMs: 5000 }] }
  const document = graph("video-restored-node", { mediaId: "old-video-media", filePath: originalPath, thumbnailPath: oldThumbnail, videoFrames, responses: [{ content: `preview: ![frame](${oldFrame})`, response: JSON.stringify({ mediaId: "old-video-media", thumbnailPath: oldThumbnail }) }] })
  const response = await importer.POST(importRequest(backup([{ id: "video-backup", title: "Video backup", content: JSON.stringify(document), media: [{ id: "old-video-media", filename: "video.mp4", filePath: originalPath, mimeType: "video/mp4", thumbnailPath: oldThumbnail, videoFrames }] }], {}, { "media/old-video-media/thumbnail.jpg": jpeg, "media/old-video-media/frames/frame_00001.jpg": jpeg }), ["video-backup"]))
  assert.equal(response.status, 200)
  const restored = await prisma.canvas.findFirst({ where: { title: "[imported] Video backup" }, include: { media: true } })
  const data = JSON.parse(restored.content).nodes[0].data
  const item = restored.media[0]
  assert.equal(data.mediaId, item.id)
  assert.equal(data.thumbnailPath, item.thumbnailPath)
  assert.equal(data.videoFrames.frames[0].path, item.videoFrames[0].path)
  assert.equal(item.videoFrames[0].timestampMs, 0)
  assert.equal(item.videoFrames.length, 2)
  assert.ok(data.videoFrames.frames[1].path.includes(restored.id))
  assert.equal(data.responses[0].content, `preview: ![frame](${item.videoFrames[0].path})`)
  assert.equal(JSON.parse(data.responses[0].response).thumbnailPath, item.thumbnailPath)
}))
