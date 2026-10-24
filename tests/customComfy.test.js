const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const { once } = require("node:events")
const { createLoader } = require("./loadSource")

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTZkAAAAASUVORK5CYII="
const pixel = Buffer.from(png, "base64")
const template = {
  text: { class_type: "CLIPTextEncode", inputs: { text: "PREFIX {{prompt}}", alias: "{{model}}", seed: "{{seed}}" } },
  save: { class_type: "SaveImage", inputs: { images: ["text", 0], filename_prefix: "test" } }
}
const body = { modelName: "qwen-alias", finalPrompt: "A blue circle", seed: 0 }
const owner = { userId: "owner", canvasId: "canvas" }
const output = image => ({ "fixture-prompt": { status: { completed: true, status_str: "success" }, outputs: { save: { images: [image || { filename: "result.png", subfolder: "batch", type: "output" }] } } } })

async function fixture(context, handler) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "llm-canvas-comfy-"))
  const requests = [], records = [], observations = []
  let saveFails = false
  const server = http.createServer(async (request, response) => {
    try {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const item = { method: request.method, path: request.url, headers: request.headers, bytes: Buffer.concat(chunks) }
      requests.push(item)
      if (handler && await handler(item, response, requests) === true) return
      if (request.url === "/native/qwen/prompt") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ prompt_id: "fixture-prompt", node_errors: {} })); return }
      if (request.url === "/native/qwen/history/fixture-prompt") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(output())); return }
      if (request.url.startsWith("/native/qwen/view?")) { response.setHeader("Content-Type", "image/png"); response.end(pixel); return }
      if (request.url === "/native/qwen/upload/image") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ name: "upload.png", subfolder: "fixture", type: "input" })); return }
      response.writeHead(404); response.end()
    } catch { response.destroy() }
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  context.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }) })
  const transaction = {
    canvas: { findFirst: async ({ where }) => where.id === owner.canvasId && where.userId === owner.userId ? { id: owner.canvasId } : null },
    media: { create: async ({ data }) => { if (saveFails) throw new Error("Synthetic storage failure"); const record = { ...data, id: "image-" + (records.length + 1) }; records.push(record); return record } }
  }
  const load = createLoader({
    "node:path": { ...path, join: (...segments) => path.join(...(segments[0] === process.cwd() ? [root, ...segments.slice(1)] : segments)) },
    "@/lib/publicPath": { assertNoSymlinks: () => {} },
    "@/lib/storageUtils": { withStorageReservation: async (userId, bytes, callback) => { assert.equal(userId, owner.userId); return callback({ verify: amount => assert.equal(amount, bytes) }) } },
    "@/lib/prisma": { prisma: { ...transaction, $transaction: async callback => { const previous = records.length; try { return await callback(transaction) } catch (error) { records.splice(previous); throw error } } } },
    "@/lib/usageObservation": { observeProviderUsage: async (usage, prompt) => observations.push({ usage, prompt }) }
  })
  return {
    root, requests, records, observations,
    endpoint: { baseUrl: "http://127.0.0.1:" + server.address().port + "/native/qwen", headers: { Authorization: "Bearer SYNTHETIC_KEY" }, workflow: structuredClone(template) },
    ...load("src/lib/providers/customComfy.ts"),
    ...load("src/lib/providers/comfyWorkflow.ts"),
    ...load("src/lib/providerRequest.ts"),
    saveFailure: () => { saveFails = true }
  }
}

test("native Comfy workflow uses the preserved base prefix, own history and private raster storage", async context => {
  const state = await fixture(context)
  const events = []
  const result = await state.customComfyImages(state.endpoint, body, owner, { enqueue: chunk => events.push(JSON.parse(new TextDecoder().decode(chunk).slice(6))) })
  assert.deepEqual(state.requests.map(r => r.method + " " + r.path.split("?")[0]), ["POST /native/qwen/prompt", "GET /native/qwen/history/fixture-prompt", "GET /native/qwen/view"])
  const sent = JSON.parse(state.requests[0].bytes)
  assert.match(sent.client_id, /^[a-f0-9-]{36}$/)
  assert.equal(sent.prompt.text.inputs.text, "PREFIX " + body.finalPrompt)
  assert.equal(sent.prompt.text.inputs.alias, body.modelName)
  assert.equal(sent.prompt.text.inputs.seed, 0)
  assert.equal(result.usageSource, "unreported")
  assert.equal(result.tokens, undefined)
  assert.equal(result.generatedImage.usageSource, "unreported")
  assert.equal(result.generatedImage.mediaId, state.records[0].id)
  assert.deepEqual(await fs.readFile(path.join(state.root, "public", result.generatedImage.url)), pixel)
  assert.equal(state.observations.length, 1)
  assert.equal(state.observations[0].usage.tokens, undefined)
  assert.equal(events.length, 1)
  assert.equal(events[0].done, true)
  assert.ok(!JSON.stringify(result).includes(png))
  assert.ok(!JSON.stringify(events).includes("SYNTHETIC_KEY"))
  assert.ok(state.requests.every(r => r.headers.authorization === "Bearer SYNTHETIC_KEY"))
})

test("prompt text is substituted as data once, including JSON and placeholder-shaped injection", async context => {
  const state = await fixture(context)
  const prompt = '"},"class_type":"Malicious","text":"{{seed}} {{image:0}} {{model}}\\n Ω'
  await state.customComfyImages(state.endpoint, { ...body, finalPrompt: prompt }, owner)
  const graph = JSON.parse(state.requests[0].bytes).prompt
  assert.equal(graph.text.inputs.text, "PREFIX " + prompt)
  assert.equal(graph.text.class_type, "CLIPTextEncode")
  assert.deepEqual(Object.keys(graph), ["text", "save"])
  assert.equal(graph.text.inputs.seed, 0)
})

test("random seeds are integers while supplied unsafe or nonnumeric seeds never submit", async context => {
  const state = await fixture(context)
  await state.customComfyImages(state.endpoint, { ...body, seed: undefined }, owner)
  assert.ok(Number.isSafeInteger(JSON.parse(state.requests[0].bytes).prompt.text.inputs.seed))
  const previous = state.requests.length
  for (const seed of [-1, 0.5, "1", null, Infinity, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(state.customComfyImages(state.endpoint, { ...body, seed }, owner), /seed/)
  assert.equal(state.requests.length, previous)
})

test("workflow validation bounds API shape, node count, bytes, depth and unsafe keys", async context => {
  const state = await fixture(context)
  const validate = state.validateComfyWorkflow
  assert.equal(validate({ "459:451": template.text })["459:451"].class_type, "CLIPTextEncode")
  assert.deepEqual(validate({ ...template, text: { ...template.text, _meta: { title: "layout only" } } }).text, template.text)
  for (const value of [undefined, null, [], {}, { nodes: [], links: [] }, { x: { type: "CLIPTextEncode", inputs: {} } }, { x: { class_type: "A", inputs: {} } }, { x: { class_type: "A", inputs: { prompt: "{{unknown}}" } } }, { x: { class_type: "A", inputs: { prompt: "{{prompt}}", seed: "seed={{seed}}" } } }, { x: { class_type: "A", inputs: { prompt: "{{prompt}}", image: "{{image:4}}" } } }, { x: { class_type: "A", inputs: { prompt: "{{prompt}}", image: "prefix/{{image:0}}" } } }, JSON.parse('{"__proto__":{"class_type":"A","inputs":{"prompt":"{{prompt}}"}}}'), JSON.parse('{"x":{"class_type":"A","inputs":{"prompt":"{{prompt}}","constructor":{}}}}')]) assert.throws(() => validate(value))
  assert.throws(() => validate({ ...template, text: { ...template.text, inputs: { text: "{{prompt}}" + "x".repeat(512 * 1024) } } }), /512 KiB/)
  assert.throws(() => validate(Object.fromEntries(Array.from({ length: 501 }, (_, i) => [String(i), template.text]))), /500/)
  let nested = "{{prompt}}"
  for (let i = 0; i < 21; i++) nested = { x: nested }
  assert.throws(() => validate({ x: { class_type: "A", inputs: nested } }), /nesting/)
  const circular = {}; circular.self = circular
  assert.throws(() => validate(circular), /Invalid/)
  assert.deepEqual(state.requests, [])
})

test("attachments upload validated rasters only to referenced slots, with multipart boundaries", async context => {
  const state = await fixture(context)
  const workflow = { ...template, image: { class_type: "LoadImage", inputs: { image: "{{image:0}}" } } }
  await state.customComfyImages({ ...state.endpoint, workflow, headers: { ...state.endpoint.headers, "Content-Type": "application/json" } }, { ...body, images: [{ dataUrl: `data:image/png;base64,${png}` }] }, owner)
  const upload = state.requests[0]
  assert.equal(upload.path, "/native/qwen/upload/image")
  assert.match(upload.headers["content-type"], /^multipart\/form-data; boundary=/)
  assert.ok(upload.bytes.includes(pixel))
  assert.ok(upload.bytes.includes(Buffer.from('name="type"\r\n\r\ninput')))
  const graph = JSON.parse(state.requests[1].bytes).prompt
  assert.equal(graph.image.inputs.image, "fixture/upload.png")
  assert.equal(state.observations.length, 1)
})

test("missing/extra/noncontiguous image bindings and videos fail before uploads or submission", async context => {
  const state = await fixture(context)
  const image = { dataUrl: `data:image/png;base64,${png}` }
  for (const images of [[image], [image, image, image, image, image], {}, null]) await assert.rejects(state.customComfyImages(state.endpoint, { ...body, images }, owner))
  for (const placeholder of ["{{image:0}}", "{{image:1}}", "{{image:3}}"]){
    const workflow = { ...template, image: { class_type: "LoadImage", inputs: { image: placeholder } } }
    await assert.rejects(state.customComfyImages({ ...state.endpoint, workflow }, body, owner), /matching/)
    if (placeholder !== "{{image:0}}") await assert.rejects(state.customComfyImages({ ...state.endpoint, workflow }, { ...body, images: [image] }, owner), /matching/)
  }
  for (const videos of [[{}], {}, null]) await assert.rejects(state.customComfyImages(state.endpoint, { ...body, videos }, owner), /video/)
  assert.equal(state.requests.length, 0)
})

test("invalid raster attachments are rejected locally rather than silently dropped", async context => {
  const state = await fixture(context)
  const endpoint = { ...state.endpoint, workflow: { ...template, image: { class_type: "LoadImage", inputs: { image: "{{image:0}}" } } } }
  for (const dataUrl of ["http://fixture.invalid/image.png", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,AAAA", `data:image/jpeg;base64,${png}`]) await assert.rejects(state.customComfyImages(endpoint, { ...body, images: [{ dataUrl }] }, owner), /image attachment/)
  assert.equal(state.requests.length, 0)
})

test("history is selected by returned prompt_id and never read from other jobs", async context => {
  let polls = 0
  const state = await fixture(context, async (request, response) => {
    if (request.path.includes("/history/")) {
      polls++
      response.end(JSON.stringify({ "some-other-job": { ...output()["fixture-prompt"], status: { status_str: "error", completed: true } }, ...(polls === 1 ? {} : output()) }))
      return true
    }
  })
  await state.customComfyImages(state.endpoint, body, owner)
  assert.ok(state.requests.every(r => !/\/queue|\/interrupt|\/history$/.test(r.path)))
  assert.equal(state.requests.filter(r => r.path.includes("/history/")).length, 2)
})

for (const badId of ["../other", "https://another.invalid/history", "x?secret=1", "a/b", "", 12]) test("invalid prompt id is rejected without polling: " + JSON.stringify(badId), async context => {
  const state = await fixture(context, async (request, response) => {
    if (request.path.endsWith("/prompt")) { response.end(JSON.stringify({ prompt_id: badId })); return true }
  })
  await assert.rejects(state.customComfyImages(state.endpoint, body, owner), /task identifier/)
  assert.equal(state.requests.length, 1)
  assert.equal(state.records.length, 0)
})

for (const status of [{ completed: true, status_str: "error", messages: [["execution_error", { exception_message: "SYNTHETIC_KEY" }]] }, { completed: false, status_str: "running", messages: [["execution_interrupted", {}]] }, { completed: true, status_str: "pending" }]) test("failed/incomplete terminal histories never become success: " + status.status_str, async context => {
  const state = await fixture(context, async (request, response) => {
    if (request.path.includes("/history/")) { response.end(JSON.stringify({ "fixture-prompt": { ...output()["fixture-prompt"], status } })); return true }
  })
  await assert.rejects(state.customComfyImages(state.endpoint, body, owner), error => !error.message.includes("SYNTHETIC_KEY"))
  assert.equal(state.records.length, 0)
  assert.equal(state.observations.length, 0)
})

for (const image of [{ filename: "../secret", subfolder: "", type: "output" }, { filename: "image.png", subfolder: "../private", type: "output" }, { filename: "https://other.invalid/image.png", type: "output" }, { filename: "%2e%2e%2fsecret", type: "output" }, { filename: "a\\b.png", type: "temp" }, { filename: "a.png", type: "input" }]) test("unsafe output descriptor cannot redirect image reads: " + JSON.stringify(image), async context => {
  const state = await fixture(context, async (request, response) => {
    if (request.path.includes("/history/")) { response.end(JSON.stringify(output(image))); return true }
  })
  await assert.rejects(state.customComfyImages(state.endpoint, body, owner), /invalid|unsupported/)
  assert.equal(state.requests.length, 2)
  assert.equal(state.records.length, 0)
})

test("too many images and outputs outside the submitted graph are rejected", async context => {
  for (const outputs of [{ save: { images: Array.from({ length: 5 }, () => ({ filename: "x.png", type: "output" })) } }, { foreign: { images: [{ filename: "private.png", type: "output" }] } }]) {
    const state = await fixture(context, async (request, response) => {
      if (request.path.includes("/history/")) { response.end(JSON.stringify({ "fixture-prompt": { status: { completed: true, status_str: "success" }, outputs } })); return true }
    })
    await assert.rejects(state.customComfyImages(state.endpoint, body, owner), /between 1 and 4/)
    assert.equal(state.requests.length, 2)
    assert.equal(state.records.length, 0)
  }
})

test("provider HTTP errors and redirect targets are not surfaced or followed", async context => {
  for (const code of [400, 401, 429, 500, 302]) {
    const state = await fixture(context, async (request, response) => { response.writeHead(code, code === 302 ? { Location: "http://private.invalid/SYNTHETIC_KEY" } : {}); response.end("SYNTHETIC_KEY"); return true })
    await assert.rejects(state.customComfyImages(state.endpoint, body, owner), error => !error.message.includes("SYNTHETIC_KEY"))
    assert.equal(state.requests.length, 1)
    assert.equal(state.records.length, 0)
  }
})

test("metadata and image body readers enforce bounds before persistence", async context => {
  for (const stage of ["prompt", "view"]) {
    const state = await fixture(context, async (request, response) => {
      if (request.path.includes("/" + stage)) { response.setHeader("Content-Length", 50 * 1024 * 1024); response.write("x"); return true }
    })
    await assert.rejects(state.customComfyImages(state.endpoint, body, owner), /size limit/)
    assert.equal(state.records.length, 0)
  }
})

test("chunked oversized image bytes are cancelled even without Content-Length", async context => {
  const state = await fixture(context, async (request, response) => {
    if (request.path.includes("/view?")) {
      response.setHeader("Content-Type", "image/png")
      response.write(Buffer.alloc(10 * 1024 * 1024))
      response.end(Buffer.alloc(10 * 1024 * 1024 + 1))
      return true
    }
  })
  await assert.rejects(state.customComfyImages(state.endpoint, body, owner), /size limit/)
  assert.equal(state.records.length, 0)
  assert.equal(state.observations.length, 0)
})

test("unsafe upload filenames or returned storage types never reach submission", async context => {
  for (const descriptor of [{ name: "../private.png", type: "input" }, { name: "x.png", subfolder: "%2e%2e", type: "input" }, { name: "x.png", type: "output" }]) {
    const state = await fixture(context, async (request, response) => {
      if (request.path.endsWith("/upload/image")) { response.end(JSON.stringify(descriptor)); return true }
    })
    const endpoint = { ...state.endpoint, workflow: { ...template, image: { class_type: "LoadImage", inputs: { image: "{{image:0}}" } } } }
    await assert.rejects(state.customComfyImages(endpoint, { ...body, images: [{ dataUrl: `data:image/png;base64,${png}` }] }, owner), /invalid/)
    assert.equal(state.requests.length, 1)
    assert.equal(state.records.length, 0)
  }
})

test("invalid JSON and non-raster image responses fail without success events", async context => {
  for (const stage of ["prompt", "view"]) {
    const state = await fixture(context, async (request, response) => { if (request.path.includes("/" + stage)) { response.end("SYNTHETIC_KEY"); return true } })
    const events = []
    await assert.rejects(state.customComfyImages(state.endpoint, body, owner, { enqueue: item => events.push(item) }), error => !error.message.includes("SYNTHETIC_KEY"))
    assert.equal(events.length, 0)
    assert.equal(state.observations.length, 0)
  }
})

test("request cancellation stops history polling without interrupting any backend job", async context => {
  const controller = new AbortController()
  const state = await fixture(context, async (request, response) => { if (request.path.includes("/history/")) { controller.abort(); response.end("{}"); return true } })
  await assert.rejects(state.withProviderSignal(controller.signal, () => state.customComfyImages(state.endpoint, body, owner)), error => ["AbortError", "TimeoutError"].includes(error.name))
  assert.ok(state.requests.every(r => !r.path.includes("interrupt") && !r.path.includes("queue")))
  assert.equal(state.records.length, 0)
})

test("one deadline bounds the full polling lifecycle, including empty histories", async context => {
  const original = AbortSignal.timeout
  AbortSignal.timeout = function (ms) { return original.call(AbortSignal, ms === 120_000 ? 25 : ms) }
  context.after(() => { AbortSignal.timeout = original })
  const state = await fixture(context, async (request, response) => { if (request.path.includes("/history/")) { response.end("{}"); return true } })
  await assert.rejects(state.customComfyImages(state.endpoint, body, owner), error => ["AbortError", "TimeoutError"].includes(error.name))
  assert.equal(state.records.length, 0)
  assert.equal(state.observations.length, 0)
})

test("storage failure preserves the single usage observation but emits no successful result", async context => {
  const state = await fixture(context)
  state.saveFailure()
  const events = []
  await assert.rejects(state.customComfyImages(state.endpoint, body, owner, { enqueue: value => events.push(value) }), /storage failure/)
  assert.equal(state.observations.length, 1)
  assert.equal(state.observations[0].usage.usageSource, "unreported")
  assert.equal(state.records.length, 0)
  assert.equal(events.length, 0)
})

test("missing ownership and malformed execution settings fail before paid work", async context => {
  const state = await fixture(context)
  await assert.rejects(state.customComfyImages(state.endpoint, body, { userId: owner.userId }), /owned canvas/)
  for (const change of [{ finalPrompt: "" }, { finalPrompt: "x".repeat(100_001) }, { modelName: "" }, { modelName: 1 }]) await assert.rejects(state.customComfyImages(state.endpoint, { ...body, ...change }, owner))
  for (const baseUrl of ["file:///private", "http://user:password@fixture.invalid", "http://fixture.invalid/?x=1", "http://fixture.invalid/#x"]) await assert.rejects(state.customComfyImages({ ...state.endpoint, baseUrl }, body, owner), /base URL/)
  assert.equal(state.requests.length, 0)
})
