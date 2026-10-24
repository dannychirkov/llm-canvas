const test = require("node:test")
const assert = require("node:assert/strict")
const { createLoader } = require("./loadSource")
const node = (id, type, data) => ({ id, type, position: { x: 0, y: 0 }, data })

test("video preview preserves frame estimates for both legacy arrays and wrapped metadata", async () => {
  const { calculateTokenPreview } = createLoader()("src/lib/tokenPreviewCalculator.ts")
  const frames = [{ width: 512, height: 512, mimeType: "image/jpeg", path: "/uploads/canvases/fixture/frame.jpg" }]
  const nodes = [node("video", "media", { mediaId: "fixture-media", filename: "fixture.mp4", mimeType: "video/mp4", durationMs: 1000, videoFrames: { frames } }), node("target", "custom", { promptText: "Describe" })]
  const edges = [{ id: "edge", source: "video", target: "target" }]
  const wrapped = await calculateTokenPreview("target", nodes, edges, "Describe")
  nodes[0].data.videoFrames = frames
  const legacy = await calculateTokenPreview("target", nodes, edges, "Describe")
  assert.ok(wrapped.contextTokens.openai.imageTokens > 0)
  assert.deepEqual(legacy.totalTokens, wrapped.totalTokens)
})

test("video execution context preserves wrapped frames and their actual paths", async () => {
  const { assembleContextWithMedia } = createLoader()("src/lib/contextService.ts")
  const frame = { width: 512, height: 512, timestampMs: 0, mimeType: "image/jpeg", path: "/uploads/canvases/fixture/frame.jpg" }
  const nodes = [node("video", "media", { mediaId: "video-media", filePath: "/uploads/canvases/fixture/video.mp4", mimeType: "video/mp4", fileSize: 128, durationMs: 1000, thumbnailPath: frame.path, videoFrames: { frames: [frame] } }), node("target", "custom", {})]
  const context = await assembleContextWithMedia("target", nodes, [{ id: "edge", source: "video", target: "target" }])
  assert.deepEqual(context.videos[0].frames, [frame])
  assert.equal(context.videos[0].frameCount, 1)
})

test("custom-only canvas includes estimated prompt and actual input instead of caching zero", async () => {
  const { calculateCanvasMetrics } = createLoader()("src/lib/canvasMetrics.ts")
  const metrics = await calculateCanvasMetrics({ nodes: [node("gateway", "custom", { promptText: "hello", status: "done", tokens: 170, tokenBreakdown: { inputTokens: 128, outputTokens: 42 } })], edges: [] })
  assert.equal(metrics.nodeCount, 1)
  assert.equal(metrics.largestContextTokens, 128)
})

test("preview counts completed ancestors, global memory and transitive edits but excludes own old answer", async () => {
  const { calculateTokenPreview } = createLoader()("src/lib/tokenPreviewCalculator.ts")
  const nodes = [node("memory", "memory", { value: "Remember this" }), node("ancestor", "custom", { status: "done", promptText: "Question", responseText: "A long completed response".repeat(20), tokens: 170 }), node("target", "custom", { status: "done", responseText: "OLD RESPONSE".repeat(100), promptText: "Next" })]
  const edges = [{ id: "link", source: "ancestor", target: "target" }]
  const first = await calculateTokenPreview("target", nodes, edges, "Next")
  assert.ok(first.contextTokens.openai.totalTokens > 100)
  assert.equal(first.executedTokens.openai, 170)
  nodes[2].data.responseText = "Different old response".repeat(500)
  assert.equal((await calculateTokenPreview("target", nodes, edges, "Next")).totalTokens.openai, first.totalTokens.openai)
  nodes[0].data.value += " Longer global memory".repeat(30)
  assert.ok((await calculateTokenPreview("target", nodes, edges, "Next")).totalTokens.openai > first.totalTokens.openai)
})

test("usage preserves explicit totals and never adds cached/reasoning subsets twice", () => {
  const { usageTotal, aggregateNodeUsage } = createLoader()("src/lib/tokenUsage.ts")
  const breakdown = { inputTokens: 100, outputTokens: 70, cachedTokens: 80, reasoningTokens: 50, audioTokens: 10 }
  assert.equal(usageTotal(undefined, breakdown, "custom"), 170)
  assert.equal(usageTotal(0, breakdown, "custom"), 0)
  assert.equal(usageTotal(undefined, breakdown, "gemini"), 220)
  const stats = aggregateNodeUsage([node("custom", "custom", { status: "done", modelName: "__proto__", tokenBreakdown: breakdown }), node("summary", "summarizer", { status: "done", provider: "custom", tokens: 11 })])
  assert.equal(stats.custom.total, 181)
  assert.equal(stats.custom.models.__proto__.total, 170)
  assert.equal(stats.custom.models.__proto__.categories.otherTools, undefined)
})

test("usage parser accepts pretty JSON, Responses-style details, explicit zero and Gemini cache", () => {
  const { parseTokenUsageFromRawResponse } = createLoader()("src/lib/tokenParser.ts")
  const parsed = parseTokenUsageFromRawResponse(JSON.stringify({ usage: { input_tokens: 100, output_tokens: 70, total_tokens: 170, input_tokens_details: { cached_tokens: 80 }, output_tokens_details: { reasoning_tokens: 50 } } }, null, 2), "custom")
  assert.equal(parsed.totalTokens, 170)
  assert.equal(parsed.cachedTokens, 80)
  assert.equal(parsed.reasoningTokens, 50)
  assert.equal(parseTokenUsageFromRawResponse('{"usage":{"total_tokens":0,"prompt_tokens":100}}').totalTokens, 0)
  const gemini = parseTokenUsageFromRawResponse('{"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":70,"thoughtsTokenCount":50,"cachedContentTokenCount":80}}', "gemini")
  assert.equal(gemini.totalTokens, 220)
  assert.equal(gemini.cachedTokens, 80)
})

test("malformed graph JSON and duplicate node IDs are rejected instead of persisted", () => {
  const { parseCanvasDocument } = createLoader()("src/lib/canvasMetrics.ts")
  assert.throws(() => parseCanvasDocument("{broken"), /Invalid canvas JSON/)
  assert.throws(() => parseCanvasDocument('{"nodes":{},"edges":[]}'), /arrays/)
  assert.throws(() => parseCanvasDocument(JSON.stringify({ nodes: [node("same", "text", {}), node("same", "custom", {})], edges: [] })), /duplicate/)
})
