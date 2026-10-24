const test = require("node:test")
const assert = require("node:assert/strict")
const { createLoader } = require("./loadSource")

test("registry includes the built-ins with consistent model ownership and capabilities", () => {
  const { providerRegistry, isProviderId } = createLoader()("src/lib/providers/registry.ts")
  assert.deepEqual(Object.keys(providerRegistry), ["openai", "gemini", "openrouter", "custom", "nanobanana"])
  for (const [id, provider] of Object.entries(providerRegistry)) {
    assert.equal(provider.id, id)
    assert.ok(isProviderId(provider.modelsProvider))
    assert.ok(provider.label)
    assert.equal(typeof provider.supportsStreaming, "boolean")
  }
  assert.equal(isProviderId("__proto__"), false)
  assert.equal(isProviderId(null), false)
  assert.equal(providerRegistry.nanobanana.modelsProvider, "gemini")
})

test("URL and header construction preserve built-in URLs and keep keys out of URLs", () => {
  const { providerUrl, providerHeaders } = createLoader()("src/lib/providers/registry.ts")
  assert.equal(providerUrl("openai", "/chat/completions"), "https://api.openai.com/v1/chat/completions")
  assert.equal(providerUrl("openrouter", "models"), "https://openrouter.ai/api/v1/models")
  assert.deepEqual(providerHeaders("openai", "SYNTHETIC_KEY"), { Authorization: "Bearer SYNTHETIC_KEY" })
  assert.deepEqual(providerHeaders("gemini", "SYNTHETIC_KEY"), { "x-goog-api-key": "SYNTHETIC_KEY" })
})

test("usage parser handles OpenAI SSE with detailed usage and Gemini metadata", () => {
  const { parseTokenUsageFromRawResponse } = createLoader()("src/lib/tokenParser.ts")
  const openai = parseTokenUsageFromRawResponse('data: {"usage":{"prompt_tokens":7,"completion_tokens":5,"total_tokens":12,"completion_tokens_details":{"reasoning_tokens":2}}}\r\n\r\ndata: [DONE]\r\n', "openai")
  assert.equal(openai.totalTokens, 12)
  assert.equal(openai.inputTokens, 7)
  assert.equal(openai.reasoningTokens, 2)
  const gemini = parseTokenUsageFromRawResponse('{"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":5,"totalTokenCount":14,"thoughtsTokenCount":2}}', "gemini")
  assert.equal(gemini.totalTokens, 14)
  assert.equal(gemini.reasoningTokens, 2)
  assert.equal(parseTokenUsageFromRawResponse("malformed", "openrouter"), null)
})

test("cancelling an SSE response aborts the upstream producer", async () => {
  let signal
  let started
  const ready = new Promise(resolve => { started = resolve })
  const { createProviderStream } = createLoader({
    "@/lib/providerRequest": { withProviderSignal: (requestSignal, callback) => { signal = requestSignal; return callback() } }
  })("src/lib/providers/stream.ts")
  const response = createProviderStream(new Request("http://localhost"), async () => {
    started()
    await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }))
  })
  await ready
  await response.body.cancel()
  assert.equal(signal.aborted, true)
})

test("request cancellation propagates through the provider fetch wrapper", async context => {
  let signal
  context.mock.method(globalThis, "fetch", async (input, options) => { signal = options.signal; return new Response("ok") })
  const { withProviderSignal, providerFetch } = createLoader()("src/lib/providerRequest.ts")
  const cancellation = new AbortController()
  await withProviderSignal(cancellation.signal, () => providerFetch("http://synthetic.invalid"))
  assert.equal(signal.aborted, false)
  cancellation.abort()
  assert.equal(signal.aborted, true)
})
