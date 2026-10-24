const test = require("node:test")
const assert = require("node:assert/strict")
const { mountEditor, completion } = require("./helpers/editorCommunicationHarness")

const node = (id, type = "custom", data = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { modelName: id, promptText: id + " instruction", ...data } })
const edge = (source, target) => ({ id: source + target, source, target })

test("selected dependent nodes wait for fresh results even before React commits, through intermediate text nodes", async t => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const editor = await mountEditor({
    nodes: [node("a", "openai", { responseText: "OLD_REPLY", status: "done" }), node("text", "text", { textContent: "source" }), node("b", "gemini"), node("c")],
    edges: [edge("a", "text"), edge("text", "b"), edge("b", "c")],
    fetch: async (url, init, request) => request.body.modelName === "a" ? pending : completion(request.body.modelName + " FRESH_REPLY")
  })
  t.after(() => editor.dispose())
  const handle = await editor.beginBatch(["c", "text", "b", "a"])
  assert.equal(editor.requests.length, 1)
  release(completion("A_FRESH_REPLY"))
  await editor.finish(handle)
  assert.deepEqual(editor.requests.map(request => request.body.modelName), ["a", "b", "c"])
  assert.ok(editor.requests[1].body.finalPrompt.includes("A_FRESH_REPLY"))
  assert.ok(editor.requests[2].body.finalPrompt.includes("b FRESH_REPLY"))
  assert.ok(!editor.requests[1].body.finalPrompt.includes("OLD_REPLY"))
  for (const id of ["a", "b", "c"]) assert.equal(editor.state(id).status, "done")
})

test("forks run concurrently then merge with both fresh replies; unselected ancestors are reused", async t => {
  const releases = {}
  const editor = await mountEditor({
    nodes: [node("saved", "custom", { responseText: "SAVED_REPLY", status: "done" }), node("left"), node("right"), node("merge")],
    edges: [edge("saved", "left"), edge("saved", "right"), edge("left", "merge"), edge("right", "merge")],
    fetch: async (url, init, request) => request.body.modelName === "merge" ? completion("MERGED") : new Promise(resolve => { releases[request.body.modelName] = resolve })
  })
  t.after(() => editor.dispose())
  const handle = await editor.beginBatch(["merge", "left", "right"])
  assert.deepEqual(editor.requests.map(request => request.body.modelName).sort(), ["left", "right"])
  releases.left(completion("LEFT_REPLY"))
  releases.right(completion("RIGHT_REPLY"))
  await editor.finish(handle)
  const prompt = editor.requests[2].body.finalPrompt
  for (const marker of ["LEFT_REPLY", "RIGHT_REPLY", "SAVED_REPLY"]) assert.ok(prompt.includes(marker))
  assert.equal(editor.requests.length, 3)
})

test("selected dependency cycles make no paid calls; individual cyclic runs remain possible", async t => {
  const messages = []
  const editor = await mountEditor({ nodes: [node("a"), node("b")], edges: [edge("a", "b"), edge("b", "a")], fetch: async () => completion("REPLY"), onToast: message => messages.push(message) })
  t.after(() => editor.dispose())
  await editor.finish(await editor.beginBatch(["a", "b"]))
  assert.equal(editor.requests.length, 0)
  assert.match(messages[0], /cycle/)
  await editor.run("a")
  await editor.run("b")
  assert.equal(editor.requests.length, 2)
})

test("failed selected parents skip dependents while independent branches complete", async t => {
  const messages = []
  const editor = await mountEditor({
    nodes: [node("failed"), node("dependent"), node("independent")], edges: [edge("failed", "dependent")],
    fetch: async (url, init, request) => request.body.modelName === "failed" ? new Response("Unavailable", { status: 503 }) : completion("SUCCESS"), onToast: value => messages.push(value)
  })
  t.after(() => editor.dispose())
  await editor.finish(await editor.beginBatch(["failed", "dependent", "independent"]))
  assert.equal(editor.state("failed").status, "error")
  assert.equal(editor.state("independent").status, "done")
  assert.ok(!editor.requests.some(request => request.body.modelName === "dependent"))
  assert.match(messages[0], /skipped/)
})

test("Hidden cuts batch dependencies just as it cuts text and image context", async t => {
  const editor = await mountEditor({ nodes: [node("a", "custom", { hidden: true }), node("b")], edges: [edge("a", "b"), edge("b", "a")], fetch: async () => completion("REPLY") })
  t.after(() => editor.dispose())
  await editor.finish(await editor.beginBatch(["a", "b"]))
  assert.equal(editor.requests.length, 2)
})

test("successful built-in results remain done and generated Nano images reach downstream requests", async t => {
  const image = { mediaId: "image-fixture", url: "/uploads/fixture.png", width: 1, height: 1 }
  const editor = await mountEditor({
    nodes: [node("openai", "openai"), node("gemini", "gemini"), node("openrouter", "openrouter"), node("nano", "nanobanana"), node("consumer")],
    edges: [edge("nano", "consumer")],
    fetch: async (url, init, request) => String(url).includes("/api/media/") ? Response.json({ mimeType: "image/png", dataUrl: "data:image/png;base64,AA==", width: 1, height: 1 }) : completion("REPLY", request.body.provider === "nanobanana" ? { generatedImage: image } : {})
  })
  t.after(() => editor.dispose())
  for (const id of ["openai", "gemini", "openrouter", "nano", "consumer"]) await editor.run(id)
  for (const id of ["openai", "gemini", "openrouter", "nano", "consumer"]) assert.equal(editor.state(id).status, "done")
  assert.equal(editor.requests.find(request => request.body?.modelName === "consumer").body.images[0].id, image.mediaId)
  await editor.update("nano", { mode: "image-edit" })
  assert.equal(editor.state("nano").status, "edited")
  await editor.update("nano", { mode: "text-to-image" })
  assert.equal(editor.state("nano").status, "done")
})

for (const legacy of [false, true]) test(`a selected summary forwards its new response and clears legacy output (${legacy})`, async t => {
  const editor = await mountEditor({
    nodes: [node("raw", "text", { textContent: "RAW_SOURCE" }), node("summary", "summarizer", { provider: "custom", endpointId: "gateway", summaryLength: "medium", summaryStyle: "key-ideas", ...(legacy ? { summaryText: "OLD_SUMMARY" } : {}) }), node("consumer")],
    edges: [edge("raw", "summary"), edge("summary", "consumer")],
    fetch: async url => String(url).includes("smart-summarizer") ? completion("FRESH_SUMMARY", { type: "done", responseText: "FRESH_SUMMARY", strategy: "single", contextWindow: 4096, textLength: 10 }) : completion("DONE")
  })
  t.after(() => editor.dispose())
  await editor.finish(await editor.beginBatch(["consumer", "summary"]))
  assert.equal(editor.state("summary").status, "done")
  assert.equal(editor.state("consumer").status, "done")
  assert.ok(editor.requests[1].body.finalPrompt.includes("FRESH_SUMMARY"))
  assert.ok(!editor.requests[1].body.finalPrompt.includes("OLD_SUMMARY"))
})

test("batch Nano execution derives iterative mode from a newly completed parent without waiting for UI effects", async t => {
  const image = { mediaId: "image-fixture", url: "/uploads/fixture.png", width: 1, height: 1 }
  const editor = await mountEditor({
    nodes: [node("producer", "custom", { mode: "chat-image" }), node("nano", "nanobanana", { mode: "text-to-image" })],
    edges: [edge("producer", "nano")],
    fetch: async (url, init, request) => String(url).includes("/api/media/") ? Response.json({ mimeType: "image/png", dataUrl: "data:image/png;base64,AA==", width: 1, height: 1 }) : completion("IMAGE", { generatedImage: image })
  })
  t.after(() => editor.dispose())
  await editor.finish(await editor.beginBatch(["nano", "producer"]))
  const request = editor.requests.find(request => request.body?.provider === "nanobanana")
  assert.equal(request.body.mode, "iterative")
  assert.equal(request.body.images.length, 1)
  assert.equal(editor.state("nano").status, "done")
})

test("overlapping manual and batch runs cannot duplicate a paid node request or overwrite its result", async t => {
  let release
  const messages = []
  const pending = new Promise(resolve => { release = resolve })
  const editor = await mountEditor({ nodes: [node("a"), node("b")], edges: [edge("a", "b")], fetch: () => pending, onToast: value => messages.push(value) })
  t.after(() => editor.dispose())
  const first = await editor.beginRun("a")
  await editor.run("a")
  await editor.finish(await editor.beginBatch(["a", "b"]))
  assert.equal(editor.requests.length, 1)
  assert.equal(editor.state("a").status, "processing")
  assert.ok(messages.some(message => message.includes("already running")))
  release(completion("ONLY_REPLY"))
  await editor.finish(first)
  assert.equal(editor.state("a").responseText, "ONLY_REPLY")
  assert.equal(editor.state("a").status, "done")
  await editor.run("a")
  assert.equal(editor.requests.length, 2, "lock releases when a run finishes")
})

test("explicit processing and error states survive comparison with an old execution snapshot", async t => {
  const editor = await mountEditor({ nodes: [node("a")], fetch: async () => completion("OLD_REPLY") })
  t.after(() => editor.dispose())
  await editor.run("a")
  await editor.update("a", { status: "processing", responseText: "" })
  assert.equal(editor.state("a").status, "processing")
  await editor.update("a", { promptText: "Changed", status: "done" })
  assert.equal(editor.state("a").status, "edited")
  await editor.update("a", { promptText: "a instruction", responseText: "OLD_REPLY", status: "error" })
  assert.equal(editor.state("a").status, "error")
})

test("Restore returns a summary provider and unset numeric parameters to its actual execution inputs", async t => {
  const editor = await mountEditor({
    nodes: [node("raw", "text", { textContent: "SOURCE" }), node("summary", "summarizer", { provider: "custom", endpointId: "gateway" })],
    edges: [edge("raw", "summary")],
    fetch: async () => completion("SUMMARY", { type: "done", responseText: "SUMMARY", strategy: "single", contextWindow: 4096, textLength: 6 })
  })
  t.after(() => editor.dispose())
  await editor.run("summary")
  await editor.update("summary", { provider: "gemini", temperature: 0.9, max_tokens: 1024, top_p: 0.8, seed: 42 })
  assert.equal(editor.state("summary").status, "edited")
  await editor.restore("summary")
  const restored = editor.state("summary")
  assert.equal(restored.provider, "custom")
  assert.equal(restored.endpointId, "gateway")
  for (const field of ["temperature", "max_tokens", "top_p", "seed"]) assert.equal(restored[field], undefined)
  assert.equal(restored.status, "done")
})
