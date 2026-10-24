const test = require("node:test")
const assert = require("node:assert/strict")
const { createLoader } = require("./loadSource")

function fixture(bytes) {
  const frames = []
  const observations = []
  const controller = { enqueue: value => frames.push(new TextDecoder().decode(value)) }
  const load = createLoader({
    "@/lib/videoAttachmentService": { convertVideoFramesToImages: async () => [], prepareGeminiVideoParts: async () => [] },
    "@/lib/providerRequest": { providerFetch: async () => new Response(bytes) },
    "@/lib/usageObservation": { observeProviderUsage: async output => observations.push(output) }
  })
  return { controller, frames, load, observations }
}

test("custom stream EOF without a completion marker rejects and preserves observed usage", async () => {
  const setup = fixture('data: {"choices":[{"delta":{"content":"partial"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n')
  const { customChat } = setup.load("src/lib/providers/customChat.ts")
  await assert.rejects(customChat({ baseUrl: "http://fixture/v1", headers: {} }, { modelName: "model", finalPrompt: "Input" }, setup.controller), /before completion/)
  assert.equal(setup.observations[0].tokens, 5)
  assert.ok(!setup.frames.join("").includes('"done":true'))
})

test("Gemini completion preserves explicit zero totals and cached input metadata", async () => {
  const setup = fixture(JSON.stringify([{ candidates: [{ content: { parts: [{ text: "Answer" }] }, finishReason: "STOP" }], usageMetadata: { totalTokenCount: 0, promptTokenCount: 0, candidatesTokenCount: 0, cachedContentTokenCount: 0 } }]))
  await setup.load("src/lib/providers/adapters/geminiStream.ts").handleGeminiStream(setup.controller, { apiKey: "fixture", modelName: "model", finalPrompt: "Input", images: [], videos: [] })
  const done = setup.frames.map(frame => JSON.parse(frame.slice(6))).find(frame => frame.done)
  assert.equal(done.tokens, 0)
  assert.equal(done.usageSource, "provider")
  assert.equal(setup.observations.length, 1)
  assert.equal(setup.observations[0].tokens, 0)
})

test("Gemini premature EOF is an error without a successful final event", async () => {
  const setup = fixture(JSON.stringify([{ candidates: [{ content: { parts: [{ text: "Partial" }] } }], usageMetadata: { totalTokenCount: 5, promptTokenCount: 3, candidatesTokenCount: 2 } }]))
  await setup.load("src/lib/providers/adapters/geminiStream.ts").handleGeminiStream(setup.controller, { apiKey: "fixture", modelName: "model", finalPrompt: "Input", images: [], videos: [] })
  assert.ok(setup.frames.join("").includes("before completion"))
  assert.ok(!setup.frames.join("").includes('"done":true'))
  assert.equal(setup.observations[0].tokens, 5)
})
