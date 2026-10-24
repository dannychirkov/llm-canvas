const test = require("node:test")
const assert = require("node:assert/strict")
const { mountEditor, completion } = require("./helpers/editorCommunicationHarness")
const { createLoader } = require("./loadSource")

const node = (id, type, data) => ({ id, type, position: { x: 0, y: 0 }, data })
const edge = (source, target) => ({ id: source + "-" + target, source, target })
const model = (id, type = "custom", extra = {}) => node(id, type, { modelName: id + "-model", promptText: id + "-instruction", ...extra })
const occurrences = (text, part) => text.split(part).length - 1

test("manual cross-provider A → B → C carries committed model replies into subsequent requests", async context => {
  const editor = await mountEditor({
    nodes: [model("a", "openai"), model("b", "gemini"), model("c", "custom", { status: "done", responseText: "OWN_OLD_RESPONSE" })],
    edges: [edge("a", "b"), edge("b", "c")],
    fetch: async (url, init, request) => completion({ "a-model": "A_REPLY_MARKER", "b-model": "B_REPLY_MARKER", "c-model": "C_REPLY_MARKER" }[request.body.modelName])
  })
  context.after(() => editor.dispose())
  await editor.run("a")
  await editor.run("b")
  await editor.run("c")
  assert.deepEqual(editor.requests.map(value => value.body.provider), ["openai", "gemini", "custom"])
  assert.ok(editor.requests[1].body.finalPrompt.includes("A_REPLY_MARKER"))
  assert.ok(editor.requests[2].body.finalPrompt.includes("A_REPLY_MARKER"))
  assert.ok(editor.requests[2].body.finalPrompt.includes("B_REPLY_MARKER"))
  assert.ok(!editor.requests[2].body.finalPrompt.includes("OWN_OLD_RESPONSE"))
  for (const id of ["a", "b", "c"]) assert.equal(editor.state(id).responseText, id.toUpperCase() + "_REPLY_MARKER")
})

test("fork and merge retain both branch replies and include shared ancestors and global memory once", async context => {
  const editor = await mountEditor({
    nodes: [node("memory", "memory", { value: "MEMORY_MARKER" }), node("source", "text", { textContent: "SHARED_SOURCE" }), model("a"), model("b"), model("c"), model("d"), node("unrelated", "text", { textContent: "UNCONNECTED_MARKER" })],
    edges: [edge("source", "a"), edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")],
    fetch: async (url, init, request) => completion(request.body.modelName.toUpperCase() + "_REPLY")
  })
  context.after(() => editor.dispose())
  for (const id of ["a", "b", "c", "d"]) await editor.run(id)
  const prompt = editor.requests[3].body.finalPrompt
  for (const part of ["MEMORY_MARKER", "SHARED_SOURCE", "A-MODEL_REPLY", "B-MODEL_REPLY", "C-MODEL_REPLY"]) assert.equal(occurrences(prompt, part), 1)
  assert.ok(!prompt.includes("UNCONNECTED_MARKER"))
  assert.equal(editor.requests.length, 4)
})

test("a manual upstream rerun replaces its old reply in the next downstream request", async context => {
  let run = 0
  const editor = await mountEditor({
    nodes: [model("a"), model("b")], edges: [edge("a", "b")],
    fetch: async (url, init, request) => completion(request.body.modelName === "a-model" ? (++run === 1 ? "OLD_UPSTREAM_REPLY" : "FRESH_UPSTREAM_REPLY") : "DOWNSTREAM_REPLY")
  })
  context.after(() => editor.dispose())
  for (const id of ["a", "b", "a", "b"]) await editor.run(id)
  assert.ok(editor.requests[1].body.finalPrompt.includes("OLD_UPSTREAM_REPLY"))
  assert.ok(editor.requests[3].body.finalPrompt.includes("FRESH_UPSTREAM_REPLY"))
  assert.ok(!editor.requests[3].body.finalPrompt.includes("OLD_UPSTREAM_REPLY"))
  assert.ok(!editor.requests[3].body.finalPrompt.includes("DOWNSTREAM_REPLY"))
})

test("alternating manual runs of connected models pass each other's latest replies without an autonomous loop", async context => {
  const turns = { "a-model": 0, "b-model": 0 }
  const editor = await mountEditor({
    nodes: [model("a"), model("b")], edges: [edge("a", "b"), edge("b", "a")],
    fetch: async (url, init, request) => completion(request.body.modelName.toUpperCase() + "_TURN_" + ++turns[request.body.modelName])
  })
  context.after(() => editor.dispose())
  for (const id of ["a", "b", "a", "b"]) await editor.run(id)
  assert.equal(editor.requests.length, 4)
  assert.ok(editor.requests[1].body.finalPrompt.includes("A-MODEL_TURN_1"))
  assert.ok(editor.requests[2].body.finalPrompt.includes("B-MODEL_TURN_1"))
  assert.ok(editor.requests[3].body.finalPrompt.includes("A-MODEL_TURN_2"))
  assert.ok(!editor.requests[3].body.finalPrompt.includes("B-MODEL_TURN_1"))
})

test("edges control reuse of prior replies and running a consumer never automatically reruns producers", async context => {
  const editor = await mountEditor({
    nodes: [model("a", "custom", { status: "done", responseText: "SAVED_UPSTREAM_REPLY" }), model("b")],
    fetch: async () => completion("B_REPLY")
  })
  context.after(() => editor.dispose())
  await editor.run("b")
  assert.ok(!editor.requests[0].body.finalPrompt.includes("SAVED_UPSTREAM_REPLY"))
  await editor.edges([edge("a", "b")])
  await editor.run("b")
  assert.ok(editor.requests[1].body.finalPrompt.includes("SAVED_UPSTREAM_REPLY"))
  assert.deepEqual(editor.requests.map(value => value.body.modelName), ["b-model", "b-model"])
})

test("editing a prompt during an in-flight run preserves its original input snapshot and marks the result edited", async context => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const editor = await mountEditor({ nodes: [model("a")], fetch: () => pending })
  context.after(() => editor.dispose())
  const handle = await editor.beginRun("a")
  await editor.update("a", { promptText: "NEW_INPUT_MARKER" })
  release(completion("ORIGINAL_INPUT_REPLY"))
  await editor.finish(handle)
  assert.equal(editor.requests[0].body.finalPrompt, "a-instruction")
  assert.equal(editor.state("a").promptText, "NEW_INPUT_MARKER")
  assert.equal(editor.state("a").lastExecutionState.promptText, "a-instruction")
  assert.equal(editor.state("a").status, "edited")
})

test("model-to-node streaming preserves Unicode across split UTF-8 and SSE boundaries", async context => {
  const text = "Ответ🙂 — café"
  const bytes = new TextEncoder().encode("data: " + JSON.stringify({ content: text }) + "\n\ndata: " + JSON.stringify({ done: true, fullResponse: text, tokens: 0, usageSource: "provider" }) + "\n\n")
  const editor = await mountEditor({ nodes: [model("a")], fetch: async () => new Response(new ReadableStream({ start(controller) { for (let offset = 0; offset < bytes.length; offset += 3) controller.enqueue(bytes.slice(offset, offset + 3)); controller.close() } })) })
  context.after(() => editor.dispose())
  await editor.run("a")
  assert.equal(editor.state("a").responseText, text)
  assert.equal(editor.state("a").status, "done")
})

test("the actual API and compatible-chat adapter pass A's reply in B's provider request", async context => {
  const providerRequests = []
  const load = createLoader({
    "@/lib/prisma": { prisma: new Proxy({}, { get() { throw new Error("Unexpected database access in communication fixture") } }) },
    "@/lib/providerCredentials": { requireUserId: async () => "fixture", requireCanvasAccess: async () => {}, requireVideoAccess: async () => {}, savedProviderKey: async () => "SYNTHETIC" },
    "@/lib/providers/customStore": { resolveCustomEndpoint: async () => ({ baseUrl: "https://fixture.invalid/v1", apiKey: "SYNTHETIC", headers: {} }) },
    "@/lib/executionUsage": { executionRequestBody: req => req.json(), withExecutionAccounting: (request, execute) => execute(request) },
    "@/lib/providerRequest": { withProviderSignal: (signal, callback) => callback(), providerFetch: async (url, init) => {
      const payload = JSON.parse(init.body)
      providerRequests.push(payload)
      const content = payload.model === "a-model" ? "REPLY_FROM_PROVIDER_A" : "REPLY_FROM_PROVIDER_B"
      return new Response("data: " + JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] }) + "\n\ndata: " + JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) + "\n\ndata: [DONE]\n\n")
    } }
  })
  const route = load("src/app/api/canvas/execute-node-stream/route.ts")
  const editor = await mountEditor({
    nodes: [model("a"), model("b")], edges: [edge("a", "b")],
    fetch: (url, init) => route.POST(new Request("http://fixture.invalid" + url, init))
  })
  context.after(() => editor.dispose())
  await editor.run("a")
  await editor.run("b")
  assert.equal(providerRequests.length, 2)
  assert.deepEqual(providerRequests.map(value => value.model), ["a-model", "b-model"])
  assert.equal(providerRequests[1].messages[0].role, "user")
  assert.ok(providerRequests[1].messages[0].content.includes("REPLY_FROM_PROVIDER_A"))
  assert.equal(editor.state("b").responseText, "REPLY_FROM_PROVIDER_B")
})
