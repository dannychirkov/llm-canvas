const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const { createLoader } = require("./loadSource")

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTZkAAAAASUVORK5CYII="
const endpoint = { baseUrl: "http://fixture.invalid/v1", headers: { Authorization: "Bearer SYNTHETIC_PRIVATE_KEY" } }
const owner = { userId: "owner", canvasId: "canvas" }
const body = { mode: "image-generation", modelName: "fixture-model", finalPrompt: "A blue circle" }

async function fixture(context, response = { data: [{ b64_json: png }] }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "llm-canvas-images-"))
  context.after(() => fs.rm(root, { recursive: true, force: true }))
  const records = []
  const requests = []
  const reservations = []
  const observations = []
  let dbFails = false
  let quotaFails = false
  let nextResponse = response
  const transaction = {
    canvas: { findFirst: async ({ where }) => where.id === owner.canvasId && where.userId === owner.userId ? { id: owner.canvasId } : null },
    media: { create: async ({ data }) => {
      if (dbFails) throw new Error("SYNTHETIC_DATABASE_FAILURE")
      const record = { ...data, id: `persisted-${records.length + 1}` }
      records.push(record)
      return record
    } }
  }
  const load = createLoader({
    "node:path": { ...path, join: (...segments) => path.join(...(segments[0] === process.cwd() ? [root, ...segments.slice(1)] : segments)) },
    "@/lib/publicPath": { assertNoSymlinks: () => {} },
    "@/lib/storageUtils": { withStorageReservation: async (userId, bytes, callback) => {
      reservations.push({ userId, bytes })
      return callback({ verify: amount => {
        assert.equal(amount, bytes)
        if (quotaFails) throw new Error("Storage quota exceeded")
      } })
    } },
    "@/lib/prisma": { prisma: { ...transaction, $transaction: async callback => {
      const previous = records.length
      try { return await callback(transaction) } catch (error) { records.splice(previous); throw error }
    } } },
    "@/lib/providers/customStore": { resolveCustomEndpoint: async () => endpoint },
    "@/lib/usageObservation": { observeProviderUsage: async (usage, prompt) => { observations.push({ usage, prompt }) } },
    "@/lib/executionUsage": { executionRequestBody: req => req.json(), withExecutionAccounting: (request, execute) => execute(request) },
    "@/lib/providerCredentials": {
      requireUserId: async () => owner.userId, savedProviderKey: async () => "SYNTHETIC_PRIVATE_KEY",
      requireCanvasAccess: async (userId, canvasId) => { assert.equal(userId, owner.userId); assert.equal(canvasId, owner.canvasId) }, requireVideoAccess: async () => {}
    },
    "@/lib/videoAttachmentService": {},
    "@/lib/providerRequest": {
      withProviderSignal: (signal, callback) => callback(),
      providerFetch: async (url, options) => {
        requests.push({ url, ...options })
        return nextResponse instanceof Response ? nextResponse : Response.json(nextResponse)
      }
    }
  })
  return {
    root, load, records, requests, reservations, observations,
    images: load("src/lib/providers/customImages.ts"), media: load("src/lib/generatedMedia.ts"),
    setResponse: value => { nextResponse = value }, failDatabase: () => { dbFails = true }, failQuota: () => { quotaFails = true }
  }
}

test("Images API persists real raster bytes under uploads with owned Media ID and provider usage", async context => {
  const state = await fixture(context, { data: [{ b64_json: png }], usage: { input_tokens: 7, output_tokens: 11, total_tokens: 18, input_tokens_details: { image_tokens: 2, cached_tokens: 1 }, output_tokens_details: { image_tokens: 9 } } })
  const result = await state.images.customImages(endpoint, body, owner)
  assert.equal(state.requests[0].url, endpoint.baseUrl + "/images/generations")
  assert.deepEqual(JSON.parse(state.requests[0].body), { model: "fixture-model", prompt: body.finalPrompt, n: 1 })
  assert.equal(state.requests[0].redirect, "error")
  assert.equal(result.generatedImage.mediaId, state.records[0].id)
  assert.match(result.generatedImage.url, /^\/uploads\/canvases\/canvas\/generated_[a-z0-9-]+\.png$/)
  assert.equal(result.generatedImage.width, 1)
  assert.equal(result.generatedImage.height, 1)
  assert.equal(result.tokens, 18)
  assert.equal(result.usageSource, "provider")
  assert.deepEqual(state.observations, [{ usage: { tokens: 18, tokenBreakdown: result.tokenBreakdown, usageSource: "provider" }, prompt: body.finalPrompt }])
  assert.deepEqual(result.tokenBreakdown, { inputTokens: 7, outputTokens: 11, cachedTokens: 1, imageTokens: 11 })
  assert.deepEqual(state.reservations, [{ userId: owner.userId, bytes: Buffer.from(png, "base64").length + 4096 }])
  const saved = await fs.readFile(path.join(state.root, "public", result.generatedImage.url))
  assert.deepEqual(saved, Buffer.from(png, "base64"))
  assert.ok(!JSON.stringify(result).includes(png))
  assert.ok(!JSON.stringify(result).includes("SYNTHETIC_PRIVATE_KEY"))
})

for (const count of [1, 2]) test(`Images API editing sends ${count} actual image files as multipart and persists the result`, async context => {
  const state = await fixture(context, { data: [{ b64_json: png }], usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } })
  const images = Array.from({ length: count }, () => ({ dataUrl: `data:image/png;base64,${png}`, mimeType: "image/png" }))
  const result = await state.images.customImages(endpoint, { ...body, mode: "image-edit", images }, owner)
  const request = state.requests[0]
  assert.equal(request.url, endpoint.baseUrl + "/images/edits")
  assert.equal(request.headers["Content-Type"], undefined)
  assert.ok(request.body instanceof FormData)
  assert.equal(request.body.get("model"), body.modelName)
  assert.equal(request.body.get("prompt"), body.finalPrompt)
  const files = request.body.getAll(count === 1 ? "image" : "image[]")
  assert.equal(files.length, count)
  for (const file of files) assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(png, "base64"))
  assert.equal(result.tokens, 5)
  assert.equal(result.generatedImage.mediaId, state.records[0].id)
})

test("Images API editing rejects absent or invalid source images before any provider call", async context => {
  const state = await fixture(context)
  await assert.rejects(state.images.customImages(endpoint, { ...body, mode: "image-edit", images: [] }, owner), /at least one source image/)
  await assert.rejects(state.images.customImages(endpoint, { ...body, mode: "image-edit", images: [{ dataUrl: "https://fixture.invalid/image.png" }] }, owner), /base64|inline|remote image/)
  assert.equal(state.requests.length, 0)
})

test("explicit Chat image output accepts inline response parts and image inputs without guessing from model IDs", async context => {
  const dataUrl = `data:image/png;base64,${png}`
  const state = await fixture(context, { choices: [{ message: { content: [{ type: "text", text: "Blue circle" }, { type: "image_url", image_url: { url: dataUrl } }] } }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } })
  const result = await state.images.customImages(endpoint, { ...body, mode: "chat-image", images: [{ dataUrl }], temperature: 0.4, top_p: 0.7, max_tokens: 20 }, owner)
  assert.equal(state.requests[0].url, endpoint.baseUrl + "/chat/completions")
  const payload = JSON.parse(state.requests[0].body)
  assert.equal(payload.stream, false)
  assert.deepEqual(payload.modalities, ["text", "image"])
  assert.equal(payload.messages[0].content[1].image_url.url, dataUrl)
  assert.equal(payload.temperature, 0.4)
  assert.equal(payload.max_tokens, 20)
  assert.equal(result.responseText, "Blue circle")
  assert.equal(result.tokens, 7)
  assert.equal(result.usageSource, "provider")
  state.setResponse({ choices: [{ message: { content: "An image", images: [{ image_url: { url: dataUrl } }] } }] })
  assert.equal((await state.images.customImages(endpoint, { ...body, mode: "chat-image" }, owner)).generatedImage.width, 1)
})

test("missing usage remains unreported and streamed success contains only persisted metadata", async context => {
  const state = await fixture(context)
  const events = []
  const result = await state.images.customImages(endpoint, body, owner, { enqueue: bytes => events.push(JSON.parse(new TextDecoder().decode(bytes).slice(6))) })
  assert.equal(result.tokens, undefined)
  assert.equal(result.tokenBreakdown, undefined)
  assert.equal(result.usageSource, "unreported")
  assert.equal(result.generatedImage.usageSource, "unreported")
  assert.equal(events.length, 1)
  assert.equal(events[0].done, true)
  assert.equal(events[0].generatedImage.mediaId, state.records[0].id)
  assert.ok(!JSON.stringify(events).includes(png))
})

test("invalid/oversized rasters, MIME mismatch and excessive dimensions are rejected before writes", async context => {
  const state = await fixture(context)
  const { decodeGeneratedRaster, MAX_GENERATED_IMAGE_BYTES } = state.media
  assert.throws(() => decodeGeneratedRaster({ data: png, mimeType: "image/jpeg" }), /MIME/)
  for (const data of ["c3ludGhldGlj", "<svg/>", "AAAA!", "A", "", "A".repeat(Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4 + 4)]) assert.throws(() => decodeGeneratedRaster({ data }))
  const huge = Buffer.from(png, "base64")
  huge.writeUInt32BE(16385, 16)
  assert.throws(() => decodeGeneratedRaster({ data: huge.toString("base64") }), /dimensions/)
  const excessivePixels = Buffer.from(png, "base64")
  excessivePixels.writeUInt32BE(10000, 16)
  excessivePixels.writeUInt32BE(10000, 20)
  assert.throws(() => decodeGeneratedRaster({ data: excessivePixels.toString("base64") }), /dimensions/)
  assert.equal(state.records.length, 0)
})

test("remote URLs, text-only output and unsupported responses never report image success or fetch remote images", async context => {
  const state = await fixture(context)
  for (const response of [
    { data: [{ url: "http://127.0.0.1/private" }] },
    { data: [{ b64_json: "c3ludGhldGlj" }] },
    { choices: [{ message: { content: "Text only" } }] },
    { data: Array.from({ length: 5 }, () => ({ b64_json: png })) },
    { error: { message: "SYNTHETIC_PRIVATE_KEY" } },
    new Response("SYNTHETIC_PRIVATE_KEY", { status: 400 }),
    new Response("SYNTHETIC_PRIVATE_KEY", { status: 401 }),
    new Response("SYNTHETIC_PRIVATE_KEY", { status: 429 }),
    new Response("not json")
  ]) {
    state.setResponse(response)
    const events = []
    await assert.rejects(state.images.customImages(endpoint, body, owner, { enqueue: bytes => events.push(bytes) }), error => !error.message.includes("SYNTHETIC_PRIVATE_KEY"))
    assert.equal(events.length, 0)
  }
  assert.equal(state.records.length, 0)
  assert.ok(state.requests.every(request => request.url === endpoint.baseUrl + "/images/generations"))
})

test("image API does not silently ignore image/video attachments, invalid modes or missing canvas", async context => {
  const state = await fixture(context)
  await assert.rejects(state.images.customImages(endpoint, { ...body, images: [{ dataUrl: `data:image/png;base64,${png}` }] }, owner), /text only/)
  await assert.rejects(state.images.customImages(endpoint, { ...body, videos: [{}] }, owner), /video/)
  await assert.rejects(state.images.customImages(endpoint, { ...body, mode: "automatic" }, owner), /Select/)
  await assert.rejects(state.images.customImages(endpoint, body, { userId: owner.userId }), /owned canvas/)
  assert.equal(state.requests.length, 0)
})

test("storage creation is owned, quota checked, atomic on failure and never invents Media IDs", async context => {
  const state = await fixture(context)
  await assert.rejects(state.media.saveGeneratedImages([{ data: png }], { userId: "other", canvasId: owner.canvasId }), /Canvas not found/)
  await assert.rejects(state.media.saveGeneratedImages([{ data: png }], { userId: owner.userId, canvasId: "../escape" }), /owned canvas/)
  state.failDatabase()
  await assert.rejects(state.media.saveGeneratedImages([{ data: png }], owner), /DATABASE_FAILURE/)
  assert.equal(state.records.length, 0)
  assert.deepEqual(await fs.readdir(path.join(state.root, "public", "uploads", "canvases", "canvas")), [])
  const quotaState = await fixture(context)
  quotaState.failQuota()
  await assert.rejects(quotaState.media.saveGeneratedImages([{ data: png }], owner), /quota/)
  assert.equal(quotaState.records.length, 0)
  await assert.rejects(fs.stat(path.join(quotaState.root, "public")), { code: "ENOENT" })
})

test("provider usage is observed exactly once before a storage failure or final event", async context => {
  const state = await fixture(context, { data: [{ b64_json: png }], usage: { input_tokens: 2, output_tokens: 3 } })
  state.failDatabase()
  const events = []
  await assert.rejects(state.images.customImages(endpoint, body, owner, { enqueue: value => events.push(value) }), /DATABASE_FAILURE/)
  assert.equal(state.observations.length, 1)
  assert.equal(state.observations[0].usage.tokens, 5)
  assert.equal(events.length, 0)
  assert.equal(state.records.length, 0)
})

test("bounded provider response reader cancels oversized payloads", async context => {
  const state = await fixture(context)
  let cancelled = false
  const response = new Response(new ReadableStream({ cancel: () => { cancelled = true } }), { headers: { "Content-Length": String(200 * 1024 * 1024) } })
  await assert.rejects(state.images.readImageResponse(response), /size limit/)
  assert.equal(cancelled, true)
})

test("image usage never fabricates missing counts and includes Gemini reasoning in output totals", async context => {
  const state = await fixture(context)
  assert.deepEqual(state.images.imageUsage({ usage: {} }), { tokens: undefined, tokenBreakdown: undefined, usageSource: "unreported" })
  assert.deepEqual(state.images.imageUsage({ usageMetadata: {} }), { tokens: undefined, tokenBreakdown: undefined, usageSource: "unreported" })
  assert.deepEqual(state.images.imageUsage({ usage: { total_tokens: 9 } }), { tokens: 9, tokenBreakdown: undefined, usageSource: "provider" })
  const usage = state.images.imageUsage({ usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 4, thoughtsTokenCount: 3, totalTokenCount: 9 } })
  assert.equal(usage.tokens, 9)
  assert.deepEqual(usage.tokenBreakdown, { inputTokens: 2, outputTokens: 7, reasoningTokens: 3 })
  assert.equal(usage.usageSource, "provider")
})

test("native SQLite Media records and image bytes survive reconnect in an isolated temporary fixture", async context => {
  const { DatabaseSync } = require("node:sqlite")
  const { PrismaClient, Prisma } = require("@prisma/client")
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "llm-canvas-images-sqlite-"))
  const databasePath = path.join(root, "fixture.db")
  const sqlite = new DatabaseSync(databasePath)
  const canvasTable = Prisma.dmmf.datamodel.models.find(entry => entry.name === "Canvas").dbName
  sqlite.exec(`CREATE TABLE "${canvasTable}" (id TEXT PRIMARY KEY, userId TEXT NOT NULL)`)
  sqlite.prepare(`INSERT INTO "${canvasTable}" (id, userId) VALUES (?, ?)`).run(owner.canvasId, owner.userId)
  const model = Prisma.dmmf.datamodel.models.find(entry => entry.name === "Media")
  const columns = model.fields.filter(field => field.kind !== "object").map(field => {
    const type = ["Int", "Boolean"].includes(field.type) ? "INTEGER" : field.type === "Float" ? "REAL" : field.type === "DateTime" ? "DATETIME" : "TEXT"
    return `"${field.dbName || field.name}" ${type}${field.isId ? " PRIMARY KEY" : ""}${field.name === "createdAt" ? " DEFAULT CURRENT_TIMESTAMP" : ""}`
  })
  sqlite.exec(`CREATE TABLE "${model.dbName}" (${columns.join(", ")}, FOREIGN KEY(canvasId) REFERENCES "${canvasTable}"(id))`)
  sqlite.close()
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${databasePath}` } } })
  context.after(async () => { await prisma.$disconnect(); await fs.rm(root, { recursive: true, force: true }) })
  const media = createLoader({
    "node:path": { ...path, join: (...segments) => path.join(...(segments[0] === process.cwd() ? [root, ...segments.slice(1)] : segments)) },
    "@/lib/publicPath": { assertNoSymlinks: () => {} },
    "@/lib/prisma": { prisma },
    "@/lib/storageUtils": { withStorageReservation: async (userId, bytes, callback) => callback({ verify: () => {} }) }
  })("src/lib/generatedMedia.ts")
  const saved = (await media.saveGeneratedImages([{ data: png }], owner))[0]
  await prisma.$disconnect()
  const record = await prisma.media.findUniqueOrThrow({ where: { id: saved.mediaId } })
  assert.equal(record.canvasId, owner.canvasId)
  assert.equal(record.filePath, saved.url)
  assert.equal(record.mimeType, "image/png")
  assert.deepEqual(await fs.readFile(path.join(root, "public", record.filePath)), Buffer.from(png, "base64"))
  await assert.rejects(media.saveGeneratedImages([{ data: png }], { userId: "other", canvasId: owner.canvasId }), /Canvas not found/)
  assert.equal(await prisma.media.count(), 1)
})

for (const streamed of [false, true]) {
  test(`${streamed ? "streaming" : "nonstream"} custom and NanoBanana routes use identical persistent uploads storage`, async context => {
    const state = await fixture(context)
    const route = state.load(`src/app/api/canvas/execute-node${streamed ? "-stream" : ""}/route.ts`)
    const request = provider => new Request("http://localhost/api/fixture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, canvasId: owner.canvasId, provider }) })
    const customResponse = await route.POST(request("custom"))
    assert.equal(customResponse.status, 200)
    const customResult = streamed ? JSON.parse((await customResponse.text()).split("\n").find(line => line.startsWith("data: ")).slice(6)) : await customResponse.json()
    assert.equal(customResult.generatedImage.mediaId, state.records[0].id)
    assert.equal(customResult.usageSource, "unreported")
    state.setResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 } })
    const bananaResponse = await route.POST(request("nanobanana"))
    assert.equal(bananaResponse.status, 200)
    const bananaResult = streamed ? JSON.parse((await bananaResponse.text()).split("\n").find(line => line.startsWith("data: ")).slice(6)) : await bananaResponse.json()
    assert.equal(bananaResult.generatedImage.mediaId, state.records[1].id)
    assert.match(bananaResult.generatedImage.url, /^\/uploads\/canvases\//)
    assert.equal(bananaResult.usageSource, "provider")
    assert.ok(!JSON.stringify(bananaResult).includes(png))
  })
}

test("downstream context loads generated custom images by persisted Media ID and excludes the target's previous image", async () => {
  const generatedImage = { url: "/uploads/canvases/canvas/generated.png", mediaId: "persisted-media", width: 1, height: 1 }
  const nodes = [
    { id: "source", type: "custom", data: { mode: "image-generation", status: "done", generatedImage } },
    { id: "target", type: "custom", data: { mode: "chat-image", status: "done", generatedImage: { ...generatedImage, mediaId: "old-target-image" } } }
  ]
  const edges = [{ id: "edge", source: "source", target: "target" }]
  const calls = []
  const load = createLoader({
    "@/lib/prisma": { prisma: { media: { findUnique: async ({ where }) => { calls.push(where.id); return { ...generatedImage, canvasId: "canvas", filePath: generatedImage.url, mimeType: "image/webp", filename: "generated.webp", width: 1, height: 1 } } } } },
    fs: { lstatSync: require("node:fs").lstatSync, promises: { readFile: async () => Buffer.from(png, "base64") } }
  })
  const service = load("src/lib/contextService.ts")
  assert.deepEqual(service.getConnectedMediaNodes("target", nodes, edges).map(node => node.id), ["source"])
  const result = await service.assembleContextWithMedia("target", nodes, edges)
  assert.deepEqual(calls, ["persisted-media"])
  assert.equal(result.images[0].id, "persisted-media")
  assert.equal(result.images[0].mimeType, "image/webp")
  assert.match(result.images[0].dataUrl, /^data:image\/webp;base64,/)
})
