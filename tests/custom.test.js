const test = require("node:test")
const assert = require("node:assert/strict")
const { createLoader } = require("./loadSource")

function storageFixture(fetchResponse) {
  const users = new Map()
  const settings = {
    findUnique: async ({ where }) => users.has(where.userId) ? { providers: structuredClone(users.get(where.userId)) } : null,
    upsert: async ({ where, create, update }) => { users.set(where.userId, structuredClone(users.has(where.userId) ? update.providers : create.providers)); return {} },
    update: async ({ where, data }) => { users.set(where.userId, structuredClone(data.providers)); return {} }
  }
  const load = createLoader({
    "@/lib/prisma": { prisma: { user: { findUnique: async () => ({ isOwner: true }) }, userSettings: settings, $transaction: callback => callback({ userSettings: settings }) } },
    "@/lib/crypto": { encryptString: async value => "encrypted:" + Buffer.from(value).toString("base64"), decryptString: async value => Buffer.from(value.slice(10), "base64").toString() },
    "@/lib/providerRequest": { providerFetch: fetchResponse ?? (async () => Response.json({ data: [{ id: "test-model" }] })) }
  })
  return { store: load("src/lib/providers/customStore.ts"), users, load }
}

const endpointInput = { label: "Synthetic gateway", baseUrl: "http://gateway.invalid:20128/v1", apiKey: "SYNTHETIC_BEARER_KEY", models: ["test-model"], contextWindow: 64000 }

test("ComfyUI roots and reverse-proxy prefixes remain native while old OpenAI URLs retain v1 defaults", () => {
  const { normalizeBaseUrl } = createLoader()("src/lib/providers/customTypes.ts")
  assert.equal(normalizeBaseUrl("http://fixture.invalid/", "comfyui"), "http://fixture.invalid")
  assert.equal(normalizeBaseUrl("http://fixture.invalid/upstream/model///", "comfyui"), "http://fixture.invalid/upstream/model")
  assert.equal(normalizeBaseUrl("http://fixture.invalid/"), "http://fixture.invalid/v1")
})

test("Comfy workflows remain encrypted across edits/backups and never enter safe settings", async () => {
  const fixture = storageFixture()
  const workflow = { "1": { class_type: "Fixture", inputs: { text: "{{prompt}}", private_header: "WORKFLOW_PRIVATE_VALUE" } } }
  const input = { ...endpointInput, baseUrl: "http://comfy.invalid", apiType: "comfyui", workflow }
  const saved = await fixture.store.saveCustomEndpoint("owner", input)
  assert.equal(saved.baseUrl, "http://comfy.invalid")
  assert.equal(saved.apiType, "comfyui")
  assert.equal(saved.hasWorkflow, true)
  assert.ok(!JSON.stringify(saved).includes("WORKFLOW_PRIVATE_VALUE"))
  assert.equal(saved.encWorkflow, undefined)
  assert.ok(!JSON.stringify(fixture.users.get("owner")).includes("WORKFLOW_PRIVATE_VALUE"))
  const resolved = await fixture.store.resolveCustomEndpoint("owner", saved.id)
  assert.deepEqual(resolved.workflow, workflow)
  const encrypted = fixture.users.get("owner").custom[0].encWorkflow
  await fixture.store.saveCustomEndpoint("owner", { ...input, id: saved.id, workflow: undefined, apiKey: "" })
  assert.equal(fixture.users.get("owner").custom[0].encWorkflow, encrypted)
  const imported = await fixture.store.normalizeImportedProviders(fixture.users.get("owner"))
  assert.equal(imported.custom[0].encWorkflow, encrypted)
  assert.equal(imported.custom[0].apiType, "comfyui")
  assert.equal(imported.custom[0].baseUrl, "http://comfy.invalid")
  const cleared = await fixture.store.saveCustomEndpoint("owner", { ...input, id: saved.id, workflow: undefined, clearWorkflow: true })
  assert.equal(cleared.hasWorkflow, false)
})

test("Comfy validation checks native metadata and preserves configured workflow aliases", async () => {
  const requests = []
  const fixture = storageFixture(async (url, options) => { requests.push({ url, authorization: options.headers.Authorization }); return Response.json({ system: { comfyui_version: "fixture" }, devices: [] }) })
  const endpoint = await fixture.store.saveCustomEndpoint("owner", { ...endpointInput, baseUrl: "http://comfy.invalid/proxy", apiType: "comfyui", models: ["my-workflow"] })
  const result = await fixture.store.validateCustomConnection("owner", endpoint.id, new AbortController().signal)
  assert.deepEqual(result.models, ["my-workflow"])
  assert.equal(result.apiType, "comfyui")
  assert.equal(result.workflowConfigured, false)
  assert.deepEqual(requests, [{ url: "http://comfy.invalid/proxy/system_stats", authorization: "Bearer SYNTHETIC_BEARER_KEY" }])
})

test("chat API selection is validated and survives encrypted backup normalization", async () => {
  const fixture = storageFixture()
  const saved = await fixture.store.saveCustomEndpoint("owner", { ...endpointInput, chatApi: "responses" })
  assert.equal(saved.chatApi, "responses")
  const imported = await fixture.store.normalizeImportedProviders(fixture.users.get("owner"))
  assert.equal(imported.custom[0].chatApi, "responses")
  await assert.rejects(fixture.store.saveCustomEndpoint("owner", { ...endpointInput, chatApi: "arbitrary" }), /Chat Completions or Responses/)
  await assert.rejects(fixture.store.saveCustomEndpoint("owner", { ...endpointInput, apiType: "arbitrary" }), /OpenAI-compatible or ComfyUI/)
})

test("base URL normalization preserves versioned and nonstandard paths and rejects unsafe URLs", () => {
  const { normalizeBaseUrl } = createLoader()("src/lib/providers/customTypes.ts")
  assert.equal(normalizeBaseUrl("http://gateway.invalid"), "http://gateway.invalid/v1")
  assert.equal(normalizeBaseUrl("http://gateway.invalid/api/v1///"), "http://gateway.invalid/api/v1")
  assert.equal(normalizeBaseUrl("http://gateway.invalid/service"), "http://gateway.invalid/service")
  assert.throws(() => normalizeBaseUrl("http://gateway.invalid/v1?"))
  assert.throws(() => normalizeBaseUrl("http://gateway.invalid/v1#"))
  for (const value of ["file:///tmp/key", "ftp://gateway.invalid", "http://name:password@gateway.invalid/v1", "http://gateway.invalid/v1?key=secret", "http://gateway.invalid/#fragment", " http://gateway.invalid", "http://gate way.invalid"]) assert.throws(() => normalizeBaseUrl(value))
})

test("multiple endpoints preserve keys on edit and enforce per-user ownership", async () => {
  const fixture = storageFixture()
  fixture.users.set("owner", { openai: { enc: "encrypted-builtin-key", activeModels: ["builtin"] } })
  const first = await fixture.store.saveCustomEndpoint("owner", endpointInput)
  const second = await fixture.store.saveCustomEndpoint("owner", { ...endpointInput, label: "Second gateway", apiKey: "SECOND_SYNTHETIC_KEY" })
  assert.notEqual(first.id, second.id)
  assert.equal(first.hasKey, true)
  assert.equal(first.enc, undefined)
  assert.equal(first.apiKey, undefined)
  assert.ok(!JSON.stringify(fixture.users.get("owner")).includes("SYNTHETIC_BEARER_KEY"))
  const encrypted = fixture.users.get("owner").custom[0].enc
  await fixture.store.saveCustomEndpoint("owner", { ...endpointInput, id: first.id, label: "Renamed", apiKey: "" })
  assert.equal(fixture.users.get("owner").custom[0].enc, encrypted)
  assert.equal((await fixture.store.resolveCustomEndpoint("owner", second.id)).headers.Authorization, "Bearer SECOND_SYNTHETIC_KEY")
  await assert.rejects(fixture.store.resolveCustomEndpoint("other-user", first.id), /Endpoint not found/)
  await assert.rejects(fixture.store.saveCustomEndpoint("other-user", { ...endpointInput, id: first.id }), /Endpoint not found/)
  await fixture.store.deleteCustomEndpoint("owner", first.id)
  assert.equal(fixture.users.get("owner").custom.length, 1)
  assert.equal(fixture.users.get("owner").openai.enc, "encrypted-builtin-key")
})

test("custom headers are encrypted, preserved in backups and omitted from safe output", async () => {
  const fixture = storageFixture()
  const endpoint = await fixture.store.saveCustomEndpoint("owner", { ...endpointInput, headers: { "X-Private-Header": "SYNTHETIC_HEADER_SECRET" }, modelContextWindows: { "test-model": 12000 } })
  const stored = fixture.users.get("owner")
  assert.ok(!JSON.stringify(stored).includes("SYNTHETIC_HEADER_SECRET"))
  assert.equal(endpoint.encHeaders, undefined)
  const normalized = await fixture.store.normalizeImportedProviders(stored)
  assert.equal(normalized.custom[0].id, endpoint.id)
  assert.equal(normalized.custom[0].modelContextWindows["test-model"], 12000)
  assert.equal(normalized.custom[0].encHeaders, stored.custom[0].encHeaders)
  assert.equal((await fixture.store.resolveCustomEndpoint("owner", endpoint.id)).headers["X-Private-Header"], "SYNTHETIC_HEADER_SECRET")
  await assert.rejects(fixture.store.saveCustomEndpoint("owner", { ...endpointInput, headers: { Authorization: "override" } }), /Invalid custom header/)
  await assert.rejects(fixture.store.saveCustomEndpoint("owner", { ...endpointInput, headers: { "X-Test": "value\r\nInjected: yes" } }), /Invalid custom header/)
})

test("old providers JSON without custom is compatible and plaintext import credentials become encrypted", async () => {
  const fixture = storageFixture()
  const normalized = await fixture.store.normalizeImportedProviders({ openai: { activeModels: ["old-model"], enc: "old-ciphertext" }, unknown: { apiKey: "MUST_NOT_EXPORT" } })
  assert.equal(normalized.custom, undefined)
  assert.equal(normalized.openai.enc, "old-ciphertext")
  assert.deepEqual(normalized.gemini.activeModels, [])
  assert.ok(!JSON.stringify(normalized).includes("MUST_NOT_EXPORT"))
  const imported = await fixture.store.normalizeImportedProviders({ custom: [{ ...endpointInput, id: "imported-endpoint", headers: { "X-Test": "NEW_HEADER_SECRET" } }] })
  assert.ok(imported.custom[0].enc)
  assert.ok(imported.custom[0].encHeaders)
  assert.ok(!JSON.stringify(imported).includes("SYNTHETIC_BEARER_KEY"))
  assert.ok(!JSON.stringify(imported).includes("NEW_HEADER_SECRET"))
})

test("validation returns models and latency and normalizes auth, missing models and timeout errors", async () => {
  let status = 200
  let timeout = false
  const fixture = storageFixture(async () => {
    if (timeout) throw new DOMException("SYNTHETIC_SECRET_IN_TIMEOUT", "TimeoutError")
    return status === 200 ? Response.json({ data: [{ id: "discovered-model" }] }) : new Response("SYNTHETIC_SECRET_IN_ERROR", { status })
  })
  const endpoint = await fixture.store.saveCustomEndpoint("owner", endpointInput)
  const result = await fixture.store.validateCustomConnection("owner", endpoint.id, new AbortController().signal)
  assert.deepEqual(result.models, ["discovered-model"])
  assert.ok(result.latencyMs >= 0)
  status = 401
  await assert.rejects(fixture.store.validateCustomConnection("owner", endpoint.id, new AbortController().signal), /Provider rejected the credentials/)
  status = 404
  await assert.rejects(fixture.store.validateCustomConnection("owner", endpoint.id, new AbortController().signal), /enter models manually/)
  timeout = true
  await assert.rejects(fixture.store.validateCustomConnection("owner", endpoint.id, new AbortController().signal), error => error.status === 504 && !error.message.includes("SYNTHETIC_SECRET"))
})

test("discovered context windows persist per endpoint without overwriting explicit model overrides", async () => {
  const fixture = storageFixture(async () => Response.json({ data: [{ id: "test-model", context_length: 200000 }, { id: "small-model", context_length: 4096 }] }))
  const endpoint = await fixture.store.saveCustomEndpoint("owner", { ...endpointInput, modelContextWindows: { "test-model": 64000 } })
  const discovered = await fixture.store.validateCustomConnection("owner", endpoint.id, new AbortController().signal)
  assert.equal(discovered.modelContextWindows["test-model"], 200000)
  const stored = fixture.users.get("owner").custom[0]
  assert.deepEqual(stored.discoveredModelContextWindows, { "test-model": 200000, "small-model": 4096 })
  assert.equal(stored.modelContextWindows["test-model"], 64000)
  const imported = await fixture.store.normalizeImportedProviders(fixture.users.get("owner"))
  assert.equal(imported.custom[0].discoveredModelContextWindows["small-model"], 4096)
  const safe = fixture.load("src/lib/providers/customTypes.ts").safeCustomEndpoint(stored)
  assert.equal(safe.discoveredModelContextWindows["test-model"], 200000)
  assert.equal(safe.enc, undefined)
  await fixture.store.saveCustomEndpoint("owner", { ...endpointInput, id: endpoint.id, baseUrl: "http://other.invalid/v1" })
  assert.equal(fixture.users.get("owner").custom[0].discoveredModelContextWindows, undefined)
})

test("custom streaming accepts split UTF-8 chunks, images and generation settings and reports actual usage", async () => {
  let sent
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Привет"}}]}\r\n\r\ndata: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":5,"total_tokens":12}}\r\n\r\ndata: [DONE]\r\n\r\n')
  const load = createLoader({
    "@/lib/videoAttachmentService": { convertVideoFramesToImages: async () => [] },
    "@/lib/providerRequest": { providerFetch: async (url, options) => {
      sent = { url, ...options }
      return new Response(new ReadableStream({ start(controller) { for (let index = 0; index < bytes.length; index += 13) controller.enqueue(bytes.slice(index, index + 13)); controller.close() } }))
    } }
  })
  const events = []
  const result = await load("src/lib/providers/customChat.ts").customChat({ ...endpointInput, id: "endpoint", authStyle: "bearer", headers: { Authorization: "Bearer SERVER_KEY" } }, { finalPrompt: "probe", modelName: "test-model", temperature: 0.3, top_p: 0.7, max_tokens: 23, images: [{ dataUrl: "data:image/png;base64,c3ludGhldGlj", mimeType: "image/png" }] }, { enqueue: bytes => events.push(new TextDecoder().decode(bytes)) })
  assert.equal(sent.url, "http://gateway.invalid:20128/v1/chat/completions")
  const payload = JSON.parse(sent.body)
  assert.equal(payload.temperature, 0.3)
  assert.equal(payload.top_p, 0.7)
  assert.equal(payload.max_tokens, 23)
  assert.equal(payload.messages[0].content[1].image_url.url, "data:image/png;base64,c3ludGhldGlj")
  assert.equal(result.responseText, "Привет")
  assert.equal(result.tokens, 12)
  assert.equal(result.tokenBreakdown.inputTokens, 7)
  assert.ok(events.join("").includes('"done":true'))
  assert.ok(!events.join("").includes("SERVER_KEY"))
})

test("non-stream custom chat and in-stream errors preserve usage and do not expose provider error bodies", async () => {
  let response = Response.json({ choices: [{ message: { content: "answer" } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } })
  const { customChat } = createLoader({ "@/lib/videoAttachmentService": { convertVideoFramesToImages: async () => [] }, "@/lib/providerRequest": { providerFetch: async () => response } })("src/lib/providers/customChat.ts")
  const endpoint = { ...endpointInput, id: "endpoint", headers: {} }
  assert.equal((await customChat(endpoint, { finalPrompt: "prompt", modelName: "model" })).tokens, 5)
  response = new Response('data: {"error":{"message":"FAKE_SECRET"}}\n\n')
  await assert.rejects(customChat(endpoint, { finalPrompt: "prompt", modelName: "model" }, { enqueue() {} }), error => error.message === "Provider request failed")
})

test("custom summarization uses manual context windows and accumulates map/reduce usage", async () => {
  let calls = 0
  const { customSummary } = createLoader({
    "@/lib/providers/customChat": { customChat: async () => { calls++; return { responseText: "summary", tokens: 11 } } }
  })("src/lib/providers/customSummary.ts")
  const result = await customSummary({ ...endpointInput, headers: {}, contextWindow: 1024 }, { modelName: "test-model", text: "long input. ".repeat(600), summaryStyle: "preserve-details" })
  assert.equal(result.strategy, "map-reduce")
  assert.ok(calls > 1)
  assert.equal(result.tokens, calls * 11)
})

test("summary chunk sizes stay bounded for long words, sentences and Unicode", () => {
  const { splitTextIntoChunks } = createLoader()("src/lib/smartSummarizer.ts")
  for (const text of ["aa. " + "b".repeat(100), "😀".repeat(30), "word. ".repeat(30)]) {
    const chunks = splitTextIntoChunks(text, 10)
    assert.ok(chunks.every(chunk => chunk.length <= 10))
    assert.ok(chunks.length > 1)
    assert.ok(chunks.every(chunk => !/[\ud800-\udbff]$/.test(chunk)))
  }
})
