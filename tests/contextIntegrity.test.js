const test = require("node:test")
const assert = require("node:assert/strict")
const { createLoader } = require("./loadSource")
const { mountEditor, completion } = require("./helpers/editorCommunicationHarness")

const node = (id, type, data = {}) => ({ id, type, position: { x: 0, y: 0 }, data })
const edge = (source, target) => ({ id: source + target, source, target })
const csv = { filename: "sample.csv", csvData: "header\nUNIQUE_CSV_ROW\nOMITTED_ROW", csvRows: 3, csvColumns: 1, caption: "CSV caption" }
const csvNode = extra => node("csv", "media", { mediaId: "csv-media", mimeType: "text/csv", ...csv, ...extra })
const target = node("target", "custom", { promptText: "Describe", modelName: "fixture-model" })
const count = (text, part) => text.split(part).length - 1

function browser(context, response) {
  const previous = new Map()
  for (const [name, value] of Object.entries({ window: {}, fetch: response })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  context.after(() => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
}

test("CSV graph text, structured API input and preview contain each row once, with the same row limit", async context => {
  browser(context, async () => Response.json({ ...csv, mimeType: "text/csv" }))
  const load = createLoader()
  const { assembleContextWithMedia } = load("src/lib/contextService.ts")
  const { appendCsvContext } = load("src/lib/csvContext.ts")
  const nodes = [csvNode({ csvLimitEnabled: true, csvMaxRows: 2 }), target]
  const edges = [edge("csv", "target")]
  const result = await assembleContextWithMedia("target", nodes, edges)
  const prompt = appendCsvContext(result.text, result.csvFiles)
  assert.equal(count(prompt, "UNIQUE_CSV_ROW"), 1)
  assert.ok(!prompt.includes("OMITTED_ROW"))
  assert.equal(count(prompt, "truncated to 2 rows"), 1)
  const preview = await load("src/lib/tokenPreviewCalculator.ts").calculateTokenPreview("target", nodes, edges)
  const expected = load("src/lib/tokenCalculator.ts").calculateTokensForBothProviders({ text: prompt, images: [], videoFrames: [], videoDurationMs: 0 })
  assert.deepEqual(preview.contextTokens, expected)
})

test("loaded CSV replaces stale node cache, including text used by the summarizer", async context => {
  browser(context, async () => Response.json({ ...csv, mimeType: "text/csv" }))
  const { assembleContextWithMedia } = createLoader()("src/lib/contextService.ts")
  const result = await assembleContextWithMedia("target", [csvNode({ csvData: "STALE_ROWS" }), target], [edge("csv", "target")])
  assert.equal(count(result.text, "UNIQUE_CSV_ROW"), 1)
  assert.ok(!result.text.includes("STALE_ROWS"))
})

test("CSV direct API compatibility accepts structured, canonical and legacy inline content", () => {
  const { appendCsvContext, formatCsvContext } = createLoader()("src/lib/csvContext.ts")
  for (const prompt of ["Describe", "Describe\n" + formatCsvContext(csv), `Media: ${csv.filename} - CSV Data:\n${csv.csvData} - Caption: ${csv.caption}`]) {
    assert.equal(count(appendCsvContext(prompt, [csv]), "UNIQUE_CSV_ROW"), 1)
  }
  const distinct = { ...csv, filename: "second.csv" }
  assert.equal(count(appendCsvContext("Describe", [csv, distinct]), "UNIQUE_CSV_ROW"), 2)
})

for (const stream of [false, true]) test(`actual ${stream ? "stream" : "non-stream"} route sends CSV once for graph and direct structured inputs`, async () => {
  const sent = []
  const load = createLoader({
    "@/lib/prisma": { prisma: new Proxy({}, { get() { throw new Error("Unexpected DB access") } }) },
    "@/lib/providerCredentials": { requireUserId: async () => "fixture", savedProviderKey: async () => "SYNTHETIC", requireCanvasAccess: async () => {}, requireVideoAccess: async () => {} },
    "@/lib/providers/customStore": { resolveCustomEndpoint: async () => ({ baseUrl: "https://fixture.invalid/v1", apiKey: "SYNTHETIC", headers: {} }) },
    "@/lib/executionUsage": { executionRequestBody: req => req.json(), withExecutionAccounting: (req, execute) => execute(req) },
    "@/lib/providerRequest": { withProviderSignal: (signal, callback) => callback(), providerFetch: async (url, init) => {
      sent.push(JSON.parse(init.body))
      return stream ? new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n') : Response.json({ choices: [{ message: { content: "ok" } }] })
    } }
  })
  const { formatCsvContext } = load("src/lib/csvContext.ts")
  const route = load(`src/app/api/canvas/execute-node${stream ? "-stream" : ""}/route.ts`)
  for (const provider of ["custom", "openai", "openrouter"]) for (const finalPrompt of ["Describe", formatCsvContext(csv)]) {
    const result = await route.POST(new Request("http://fixture.invalid/api/execute", { headers: { "Content-Type": "application/json" }, method: "POST", body: JSON.stringify({ provider, modelName: "fixture-model", finalPrompt, csvFiles: [csv] }) }))
    assert.equal(result.status, 200)
    assert.ok(!(await result.text()).includes('"error":'))
    const content = sent.at(-1).messages[0].content
    assert.equal(count(typeof content === "string" ? content : content[0].text, "UNIQUE_CSV_ROW"), 1)
  }
  assert.equal(sent.length, 6)
})

for (const scenario of ["not-found", "forbidden", "network", "bad-json", "empty-image", "missing-csv-rows", "missing-reference"]) test(`required attachment ${scenario} rejects with a useful safe error`, async context => {
  browser(context, async () => {
    if (scenario === "network") throw new Error("/private/files/secret.png")
    if (scenario === "bad-json") return new Response("/private/raw/error")
    if (scenario === "not-found" || scenario === "forbidden") return new Response("/private/raw/error", { status: scenario === "not-found" ? 404 : 403 })
    return Response.json(scenario === "missing-csv-rows" ? { mimeType: "text/csv", filename: "sample.csv" } : { mimeType: "image/png", dataUrl: "data:image/png;base64," })
  })
  const { assembleContextWithMedia } = createLoader()("src/lib/contextService.ts")
  const attachment = node("attachment", "media", { mediaId: scenario === "missing-reference" ? undefined : "fixture", mimeType: "image/png" })
  await assert.rejects(assembleContextWithMedia("target", [attachment, target], [edge("attachment", "target")]), error => {
    assert.match(error.message, /connected attachment could not be loaded/)
    assert.match(error.message, /Re-upload/)
    assert.ok(!error.message.includes("/private"))
    return true
  })
})

test("server media lookup and file read errors are never silently filtered out", async () => {
  for (const found of [false, true]) {
    const load = createLoader({
      "@/lib/prisma": { prisma: { media: { findUnique: async () => found ? { mimeType: "image/png", filePath: "/private/missing.png", canvasId: "fixture" } : null } } },
      "@/lib/publicPath": { resolvePublicPath: () => "/private/missing.png" },
      fs: { promises: { readFile: async () => { throw new Error("ENOENT /private/missing.png") } } }
    })
    const { assembleContextWithMedia } = load("src/lib/contextService.ts")
    await assert.rejects(assembleContextWithMedia("target", [node("image", "media", { mediaId: "fixture" }), target], [edge("image", "target")]), /connected attachment could not be loaded/)
  }
})

test("Hidden still cuts missing media branches, while global Memory survives", async context => {
  browser(context, () => { throw new Error("Hidden media must not be fetched") })
  const { assembleContextWithMedia } = createLoader()("src/lib/contextService.ts")
  const nodes = [node("memory", "memory", { value: "GLOBAL_MEMORY" }), node("image", "media", { mediaId: "missing" }), node("hidden", "text", { hidden: true }), target]
  const result = await assembleContextWithMedia("target", nodes, [edge("image", "hidden"), edge("hidden", "target")])
  assert.equal(result.text, "Persistent Memory: GLOBAL_MEMORY")
  assert.equal(result.images.length, 0)
})

test("failed partial LLM and summary outputs are labeled rather than ordinary Assistant replies", () => {
  const { assembleContext } = createLoader()("src/lib/contextService.ts")
  for (const type of ["custom", "openai", "summarizer"]) {
    const parent = node("parent", type, { promptText: "PARENT_INPUT", status: "error", responseText: "PARTIAL_RESULT", error: "/private/provider/error" })
    const text = assembleContext("target", [parent, target], [edge("parent", "target")])
    assert.match(text, /partial output \(failed execution; incomplete and unverified\): PARTIAL_RESULT/)
    assert.ok(!text.includes("Assistant: PARTIAL_RESULT"))
    assert.ok(!text.includes("/private"))
    parent.data.status = "edited"
    assert.ok(!assembleContext("target", [parent, target], [edge("parent", "target")]).includes("failed execution"))
  }
})

test("summaries prefer current responseText, preserve legacy fallback and retain raw ancestors", () => {
  const { assembleContext } = createLoader()("src/lib/contextService.ts")
  for (const [data, expected] of [[{ responseText: "FRESH_SUMMARY", summaryText: "OLD_SUMMARY" }, "FRESH_SUMMARY"], [{ summaryText: "OLD_SUMMARY" }, "OLD_SUMMARY"], [{ responseText: "", summaryText: "OLD_SUMMARY" }, null]]) {
    const nodes = [node("source", "text", { textContent: "RAW_SOURCE" }), node("summary", "summarizer", data), target]
    const text = assembleContext("target", nodes, [edge("source", "summary"), edge("summary", "target")])
    assert.ok(text.includes("RAW_SOURCE"))
    if (expected) assert.ok(text.includes("Assistant Summary: " + expected))
    if (expected !== "OLD_SUMMARY") assert.ok(!text.includes("OLD_SUMMARY"))
  }
})

test("actual summary completion then selected consumer forwards the fresh reply and remains done", async context => {
  const editor = await mountEditor({
    nodes: [node("source", "text", { textContent: "RAW_SOURCE" }), node("summary", "summarizer", { provider: "custom", modelName: "summary-model", summaryText: "OLD_SUMMARY" }), target],
    edges: [edge("source", "summary"), edge("summary", "target")],
    fetch: async url => String(url).includes("smart-summarizer")
      ? completion("FRESH_SUMMARY", { type: "done", responseText: "FRESH_SUMMARY", strategy: "single", contextWindow: 4096, textLength: 10 })
      : completion("CONSUMER_REPLY")
  })
  context.after(() => editor.dispose())
  await editor.run("summary")
  assert.equal(editor.state("summary").status, "done")
  const handle = await editor.beginBatch(["target"])
  await editor.finish(handle)
  assert.equal(editor.state("target").status, "done")
  assert.equal(editor.requests.length, 2)
  assert.ok(editor.requests[1].body.finalPrompt.includes("Assistant Summary: FRESH_SUMMARY"))
  assert.ok(editor.requests[1].body.finalPrompt.includes("RAW_SOURCE"))
  assert.ok(!editor.requests[1].body.finalPrompt.includes("OLD_SUMMARY"))
})

test("missing image aborts the actual editor before a provider request", async context => {
  let providerCalls = 0
  const editor = await mountEditor({
    nodes: [node("image", "media", { mediaId: "absent", mimeType: "image/png" }), target], edges: [edge("image", "target")],
    fetch: async url => {
      if (String(url).includes("/api/media/")) return new Response("missing", { status: 404 })
      providerCalls++
      return completion("SHOULD_NOT_RUN")
    }
  })
  context.after(() => editor.dispose())
  await editor.run("target")
  assert.equal(providerCalls, 0)
  assert.equal(editor.state("target").status, "error")
  assert.match(editor.state("target").error, /connected attachment could not be loaded/)
})
