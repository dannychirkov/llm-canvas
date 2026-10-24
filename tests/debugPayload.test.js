const test = require("node:test")
const assert = require("node:assert/strict")
const { createLoader } = require("./loadSource")
const { compactCanvasDocument, debugPreview } = createLoader()("src/lib/debugPayload.ts")

test("debug compaction preserves actual user inputs, outputs and restore state", () => {
  const responseText = "answer".repeat(20000)
  const promptText = "prompt".repeat(20000)
  const source = { nodes: [{ id: "node", data: { promptText, responseText, tokens: 170, rawResponse: "x".repeat(2000000), structuredResponse: "x".repeat(2000000), debugInfo: { requestPayload: { images: [{ dataUrl: "data:image/png;base64," + "x".repeat(2000000) }], finalPrompt: promptText } }, lastExecutionState: { promptText, responseText, mode: "chat", finalPrompt: promptText } } }], edges: [] }
  const result = compactCanvasDocument(source)
  assert.equal(result.nodes[0].data.promptText, promptText)
  assert.equal(result.nodes[0].data.responseText, responseText)
  assert.equal(result.nodes[0].data.lastExecutionState.responseText, responseText)
  assert.equal(result.nodes[0].data.tokens, 170)
  assert.ok(JSON.stringify(result).length < JSON.stringify(source).length / 5)
  assert.ok(JSON.parse(result.nodes[0].data.rawResponse).truncated)
  assert.ok(result.nodes[0].data.lastExecutionState.debugPromptTruncated)
  assert.equal(source.nodes[0].data.rawResponse.length, 2000000)
})

test("debug previews redact secrets and explicitly omit inline media", () => {
  const value = debugPreview({ apiKey: "secret", Authorization: "secret", image: "data:image/png;base64,AAAA" })
  assert.equal(value.apiKey, "[redacted]")
  assert.equal(value.Authorization, "[redacted]")
  assert.ok(value.image.includes("omitted"))
})
