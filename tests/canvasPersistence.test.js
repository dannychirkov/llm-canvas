const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const { execFileSync } = require("node:child_process")
const { PrismaClient } = require("@prisma/client")
const { createLoader } = require("./loadSource")

const repository = process.cwd()
let directory
let prisma
let currentUser = "canvas-owner"
let routes
let listing
let persistence
let storage
let synchronize
let loaderOverrides

test.before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "llm-canvas-persistence-test-"))
  const schema = (await fs.readFile("prisma/schema.prisma", "utf8")).replace(/datasource db \{[\s\S]*?\}/, `datasource db {\n  provider = "sqlite"\n  url = "file:${directory}/fixture.db"\n}`)
  const schemaPath = path.join(directory, "schema.prisma")
  await fs.writeFile(schemaPath, schema)
  execFileSync(process.execPath, [path.join(repository, "node_modules/prisma/build/index.js"), "db", "push", "--schema", schemaPath, "--skip-generate"], { stdio: "pipe", env: { ...process.env, DATABASE_URL: `file:${directory}/fixture.db` } })
  prisma = new PrismaClient({ datasources: { db: { url: `file:${directory}/fixture.db` } } })
  await prisma.user.create({ data: { id: currentUser, email: "canvas-owner@example.invalid", isOwner: true } })
  await prisma.user.create({ data: { id: "canvas-foreign", email: "canvas-foreign@example.invalid", isOwner: true } })
  loaderOverrides = {
    "@/lib/prisma": { prisma }, "@/lib/auth": { auth: async () => currentUser ? { user: { id: currentUser } } : null },
    "@/lib/analytics": { trackCanvasCreated() {}, trackCanvasUpdated() {}, trackCanvasDeleted() {} },
    "@/lib/presetPrompts": { getRandomPresetPrompt: () => "Fixture prompt" },
    "@/lib/tokenPreviewCalculator": { calculateTokenPreview: async () => ({ totalTokens: { openai: 7, gemini: 11 } }) }
  }
  const load = createLoader(loaderOverrides)
  routes = load("src/app/api/canvases/[id]/route.ts")
  listing = load("src/app/api/canvases/route.ts")
  persistence = load("src/lib/canvasPersistence.ts")
  storage = load("src/lib/storageUtils.ts")
  synchronize = load("src/lib/canonicalGraph.ts").synchronizeCanvasNodes
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

function request(body, method = "PUT") {
  return new Request("http://localhost/api/canvases/fixture", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}

function context(id) { return { params: Promise.resolve({ id }) } }
function graph(id, value = "fixture", type = "text") {
  return { nodes: [{ id, type, position: { x: 0, y: 0 }, data: { textContent: value } }], edges: [] }
}

async function fixture(id, document = graph(`${id}-node`), userId = "canvas-owner") {
  const created = await prisma.canvas.create({ data: { id, userId, title: id, description: "before", content: JSON.stringify(document), nodeCount: document.nodes.length } })
  await prisma.$transaction(tx => synchronize(tx, id, document))
  return created
}

test("canvas POST uses UUIDs and mirrors exact graph IDs inside its statistics transaction", async () => isolated(async () => {
  const before = await prisma.user.findUnique({ where: { id: currentUser } })
  const response = await listing.POST(request({ title: "  New canvas  ", description: "description" }, "POST"))
  assert.equal(response.status, 201)
  const created = await response.json()
  assert.match(created.id, /^[a-f0-9-]{36}$/)
  assert.equal(created.title, "New canvas")
  const document = JSON.parse(created.content)
  for (const node of document.nodes) assert.match(node.id, /^[a-f0-9-]{36}$/)
  const rows = await prisma.node.findMany({ where: { canvasId: created.id } })
  assert.deepEqual(rows.map(node => node.id).sort(), document.nodes.map(node => node.id).sort())
  const after = await prisma.user.findUnique({ where: { id: currentUser } })
  assert.equal(after.totalCanvasesCreated - before.totalCanvasesCreated, 1)
  assert.equal(after.totalNodesCreated - before.totalNodesCreated, 2)
}))

test("canvas content requires a revision and validates JSON before writing", async () => isolated(async () => {
  const saved = await fixture("revision-required")
  assert.equal((await routes.PUT(request({ content: JSON.stringify(graph("replacement")) }), context(saved.id))).status, 428)
  for (const content of ["{broken", "[]", JSON.stringify({ nodes: [], edges: [{ id: "dangling", source: "missing", target: "missing" }] })]) {
    assert.equal((await routes.PUT(request({ content, expectedUpdatedAt: saved.updatedAt.toISOString() }), context(saved.id))).status, 400)
  }
  assert.equal((await prisma.canvas.findUnique({ where: { id: saved.id } })).content, saved.content)
}))

test("content PUT atomically mirrors new IDs, removes old rows and returns a compact monotonic revision", async () => isolated(async () => {
  const saved = await fixture("replace-equal-count")
  const before = await prisma.user.findUnique({ where: { id: currentUser } })
  const document = graph("replace-new-node", "saved", "custom")
  const response = await routes.PUT(request({ content: JSON.stringify(document), expectedUpdatedAt: saved.updatedAt.toISOString() }), context(saved.id))
  assert.equal(response.status, 200)
  const compact = await response.json()
  assert.equal(Object.hasOwn(compact, "content"), false)
  assert.ok(Date.parse(compact.updatedAt) > saved.updatedAt.getTime())
  assert.equal(compact.nodeCount, 1)
  assert.equal(compact.largestContextTokens, 7)
  const rows = await prisma.node.findMany({ where: { canvasId: saved.id } })
  assert.deepEqual(rows.map(node => node.id), ["replace-new-node"])
  assert.equal(rows[0].data.textContent, "saved")
  assert.equal((await prisma.user.findUnique({ where: { id: currentUser } })).totalNodesCreated - before.totalNodesCreated, 1)
  const replay = await routes.PUT(request({ content: JSON.stringify(document), expectedUpdatedAt: compact.updatedAt }), context(saved.id))
  assert.equal(replay.status, 200)
  assert.equal((await prisma.user.findUnique({ where: { id: currentUser } })).totalNodesCreated - before.totalNodesCreated, 1)
  const stale = await routes.PUT(request({ content: saved.content, expectedUpdatedAt: saved.updatedAt.toISOString() }), context(saved.id))
  assert.equal(stale.status, 409)
}))

test("repairing a legacy divergent mirror does not count existing canonical nodes as newly created", async () => isolated(async () => {
  const saved = await fixture("legacy-mirror")
  await prisma.node.update({ where: { id: "legacy-mirror-node" }, data: { id: "old-mirror-only-id" } })
  const before = await prisma.user.findUnique({ where: { id: currentUser } })
  const response = await routes.PUT(request({ content: saved.content, expectedUpdatedAt: saved.updatedAt.toISOString() }), context(saved.id))
  assert.equal(response.status, 200)
  assert.equal((await prisma.user.findUnique({ where: { id: currentUser } })).totalNodesCreated, before.totalNodesCreated)
  assert.equal((await prisma.node.findFirst({ where: { canvasId: saved.id } })).id, "legacy-mirror-node")
}))

test("canvas PUT CAS catches a change occurring after its initial owner-scoped read", async () => {
  const saved = await fixture("concurrent-cas")
  let interfere = true
  const proxy = new Proxy(prisma, { get(target, property) {
    if (property === "$transaction") return async (operation, options) => {
      if (interfere) {
        interfere = false
        await prisma.canvas.update({ where: { id: saved.id }, data: { title: "newer title", updatedAt: new Date(saved.updatedAt.getTime() + 10) } })
      }
      return target.$transaction(operation, options)
    }
    const value = Reflect.get(target, property)
    return typeof value === "function" ? value.bind(target) : value
  } })
  const route = createLoader({ ...loaderOverrides, "@/lib/prisma": { prisma: proxy } })("src/app/api/canvases/[id]/route.ts")
  await isolated(async () => {
    const response = await route.PUT(request({ title: "stale title", content: JSON.stringify(graph("concurrent-new")), expectedUpdatedAt: saved.updatedAt.toISOString() }), context(saved.id))
    assert.equal(response.status, 409)
    assert.equal((await prisma.canvas.findUnique({ where: { id: saved.id } })).title, "newer title")
    assert.deepEqual((await prisma.node.findMany({ where: { canvasId: saved.id } })).map(node => node.id), ["concurrent-cas-node"])
  })
})

test("global node conflicts roll back canvas content, revision, rows and user counters", async () => isolated(async () => {
  const foreign = await fixture("foreign-canvas", graph("foreign-global-node", "private"), "canvas-foreign")
  const saved = await fixture("conflict-canvas")
  const before = await prisma.user.findUnique({ where: { id: currentUser } })
  const response = await routes.PUT(request({ title: "should roll back", content: JSON.stringify(graph("foreign-global-node", "tampered")), expectedUpdatedAt: saved.updatedAt.toISOString() }), context(saved.id))
  assert.equal(response.status, 409)
  const after = await prisma.canvas.findUnique({ where: { id: saved.id } })
  assert.equal(after.content, saved.content)
  assert.equal(after.updatedAt.toISOString(), saved.updatedAt.toISOString())
  assert.equal(after.title, saved.title)
  assert.equal((await prisma.node.findUnique({ where: { id: "foreign-global-node" } })).canvasId, foreign.id)
  assert.equal((await prisma.user.findUnique({ where: { id: currentUser } })).totalNodesCreated, before.totalNodesCreated)
}))

test("metadata-only updates remain compatible and preserve complete content and rows", async () => isolated(async () => {
  const saved = await fixture("metadata-only")
  const response = await routes.PUT(request({ title: "Renamed", description: null }), context(saved.id))
  assert.equal(response.status, 200)
  const metadata = await response.json()
  assert.equal(metadata.title, "Renamed")
  assert.equal(metadata.description, null)
  const after = await prisma.canvas.findUnique({ where: { id: saved.id } })
  assert.equal(after.content, saved.content)
  assert.ok(after.updatedAt > saved.updatedAt)
  assert.equal(await prisma.node.count({ where: { canvasId: saved.id } }), 1)
  assert.equal((await routes.PUT(request({ title: "old", expectedUpdatedAt: saved.updatedAt.toISOString() }), context(saved.id))).status, 409)
}))

test("title, description, expected stamp and malformed request shapes fail with normalized errors", async () => isolated(async () => {
  const saved = await fixture("validation-canvas")
  for (const body of [{ title: " " }, { title: false }, { title: "x".repeat(201) }, { description: {} }, { description: "x".repeat(10001) }, { title: "ok", expectedUpdatedAt: "not-a-date" }, [], null]) {
    const response = await routes.PUT(request(body), context(saved.id))
    assert.equal(response.status, 400)
    assert.equal(Object.hasOwn(await response.json(), "details"), false)
  }
  assert.equal((await listing.POST(request({ title: " " }, "POST"))).status, 400)
  const malformed = new Request("http://localhost/api/canvases", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{invalid" })
  assert.equal((await listing.POST(malformed)).status, 400)
}))

test("quota includes graph and mirrored Node bytes and permits non-growing saves above a reduced limit", async () => isolated(async () => {
  await prisma.user.create({ data: { id: "canvas-quota", email: "canvas-quota@example.invalid", storageLimitBytes: 1000000 } })
  const saved = await fixture("quota-graph", graph("quota-graph-node"), "canvas-quota")
  const baseline = await storage.checkStorageLimit("canvas-quota", 0)
  await prisma.user.update({ where: { id: "canvas-quota" }, data: { storageLimitBytes: baseline.currentUsage + 15000 } })
  currentUser = "canvas-quota"
  try {
    const response = await routes.PUT(request({ content: JSON.stringify(graph("quota-graph-node", "x".repeat(10000))), expectedUpdatedAt: saved.updatedAt.toISOString() }), context(saved.id))
    assert.equal(response.status, 403)
    assert.equal((await prisma.canvas.findUnique({ where: { id: saved.id } })).content, saved.content)
    await prisma.user.update({ where: { id: "canvas-quota" }, data: { storageLimitBytes: 1 } })
    const compact = await routes.PUT(request({ content: JSON.stringify(graph("quota-graph-node", "a")), expectedUpdatedAt: saved.updatedAt.toISOString() }), context(saved.id))
    assert.equal(compact.status, 200)
    assert.equal((await listing.POST(request({ title: "Denied" }, "POST"))).status, 403)
  } finally { currentUser = "canvas-owner" }
}))

test("DELETE enforces ownership and removes cascaded data, originals, frame trees and legacy assets", async () => isolated(async () => {
  const saved = await fixture("delete-canvas")
  await prisma.media.create({ data: { id: "delete-media", canvasId: saved.id, filename: "file.csv", filePath: `/uploads/canvases/${saved.id}/file.csv`, mimeType: "text/csv", fileSize: 7 } })
  await prisma.tokenUsage.create({ data: { canvasId: saved.id, operator: "custom", modelName: "fixture", totalTokens: 7 } })
  for (const namespace of ["uploads/canvases", "canvases"]) {
    const target = path.join(directory, "public", namespace, saved.id, "media", "frames")
    await fs.mkdir(target, { recursive: true })
    await fs.writeFile(path.join(target, "fixture.jpg"), "fixture")
  }
  currentUser = "canvas-foreign"
  try { assert.equal((await routes.DELETE(new Request("http://localhost/delete"), context(saved.id))).status, 404) } finally { currentUser = "canvas-owner" }
  assert.ok(await fs.stat(path.join(directory, "public/uploads/canvases", saved.id)))
  assert.equal((await routes.DELETE(new Request("http://localhost/delete"), context(saved.id))).status, 200)
  assert.equal(await prisma.canvas.count({ where: { id: saved.id } }), 0)
  assert.equal(await prisma.node.count({ where: { canvasId: saved.id } }), 0)
  assert.equal(await prisma.media.count({ where: { canvasId: saved.id } }), 0)
  assert.equal(await prisma.tokenUsage.count({ where: { canvasId: saved.id } }), 0)
  for (const namespace of ["uploads/canvases", "canvases"]) await assert.rejects(fs.stat(path.join(directory, "public", namespace, saved.id)), { code: "ENOENT" })
}))

test("canvas gateways reject anonymous and cross-user writes without disclosing content", async () => isolated(async () => {
  const saved = await fixture("ownership-canvas")
  currentUser = "canvas-foreign"
  try {
    assert.equal((await routes.GET(new Request("http://localhost/canvas"), context(saved.id))).status, 404)
    assert.equal((await routes.PUT(request({ content: saved.content, expectedUpdatedAt: saved.updatedAt.toISOString() }), context(saved.id))).status, 404)
  } finally { currentUser = null }
  try {
    assert.equal((await routes.GET(new Request("http://localhost/canvas"), context(saved.id))).status, 401)
    assert.equal((await routes.PUT(request({ title: "no" }), context(saved.id))).status, 401)
    assert.equal((await listing.POST(request({ title: "no" }, "POST"))).status, 401)
  } finally { currentUser = "canvas-owner" }
}))

test("canvas request budget rejects declared and chunked bodies exceeding 128 MiB", async () => {
  const declared = new Request("http://localhost/canvas", { method: "PUT", body: "{}", headers: { "Content-Length": String(persistence.MAX_CANVAS_REQUEST_BYTES + 1) } })
  await assert.rejects(persistence.readCanvasBody(declared), error => error.status === 413)
  const chunk = Buffer.alloc(64 * 1024, 32)
  let total = 0
  let cancelled = false
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(chunk); total += chunk.length }, cancel() { cancelled = true } })
  const streamed = new Request("http://localhost/canvas", { method: "PUT", body: stream, duplex: "half" })
  await assert.rejects(persistence.readCanvasBody(streamed), error => error.status === 413)
  assert.ok(total > persistence.MAX_CANVAS_REQUEST_BYTES)
  assert.equal(cancelled, true)
})

test("100 MiB legacy payload fits the bounded canvas JSON reader", async () => {
  const size = 100 * 1024 * 1024
  let remaining = size
  let started = false
  const chunk = Buffer.alloc(64 * 1024, 97)
  const stream = new ReadableStream({ pull(controller) {
    if (!started) { started = true; controller.enqueue(Buffer.from('{"content":"')); return }
    if (remaining) { const bytes = Math.min(remaining, chunk.length); controller.enqueue(chunk.subarray(0, bytes)); remaining -= bytes; return }
    controller.enqueue(Buffer.from('"}'))
    controller.close()
  } })
  const body = await persistence.readCanvasBody(new Request("http://localhost/canvas", { method: "PUT", body: stream, duplex: "half" }))
  assert.equal(body.content.length, size)
})
