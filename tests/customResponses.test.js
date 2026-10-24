const test = require("node:test")
const assert = require("node:assert/strict")
const { createLoader } = require("./loadSource")

const endpoint = { baseUrl: "https://responses.invalid/custom/v1", headers: { Authorization: "Bearer SERVER_ONLY", "X-Private": "HEADER_ONLY" } }
const input = { modelName: "synthetic-model", finalPrompt: "Explain this graph" }
const encoder = new TextEncoder()
const usage = { input_tokens: 12, output_tokens: 8, total_tokens: 20, input_tokens_details: { cached_tokens: 7 }, output_tokens_details: { reasoning_tokens: 3 } }
const message = text => ({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] })
const completed = (text = "Answer", counters = usage) => ({ id: "resp_fixture", object: "response", status: "completed", output: [message(text)], ...(counters === undefined ? {} : { usage: counters }) })
const event = (type, extra = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`
const terminal = (text = "Answer", counters = usage) => event("response.completed", { response: completed(text, counters) })

function fixture(response, options = {}) {
  const requests = []
  const frames = []
  const observations = []
  const order = []
  const videoInputs = []
  const overrides = {
    "@/lib/videoAttachmentService": { convertVideoFramesToImages: async videos => { videoInputs.push(videos); return options.videoImages ?? [] } }
  }
  if (!options.realFetch) overrides["@/lib/providerRequest"] = { providerFetch: async (url, init) => { requests.push({ url, ...init }); return response } }
  const load = createLoader(overrides)
  const { customResponses } = load("src/lib/providers/customResponses.ts")
  const { withUsageObserver } = load("src/lib/usageObservation.ts")
  const controller = { enqueue(bytes) {
    const value = JSON.parse(new TextDecoder().decode(bytes).slice(6))
    order.push(value.done ? "done" : "content")
    if (options.failDelivery && value.done) throw new Error("PRIVATE_DELIVERY_DETAIL")
    frames.push(value)
  } }
  const run = (stream = false, patch = {}, customController) => withUsageObserver(async (output, prompt) => {
    observations.push({ output, prompt }); order.push("usage")
  }, () => customResponses(endpoint, { ...input, ...patch }, stream ? customController ?? controller : undefined))
  return { run, load, requests, frames, observations, order, videoInputs }
}

function streaming(text, width = 17) {
  const bytes = typeof text === "string" ? encoder.encode(text) : text
  return new Response(new ReadableStream({ start(controller) {
    for (let index = 0; index < bytes.length; index += width) controller.enqueue(bytes.slice(index, index + width))
    controller.close()
  } }))
}

test("Responses nonstream payload uses stateless user input, images/video frames, CSV and translated options", async () => {
  const video = { mediaId: "video-id", frames: [{ path: "synthetic-frame" }] }
  const image = { dataUrl: "data:image/png;base64,aW1hZ2U=", mimeType: "image/png", width: 40, height: 40 }
  const frame = { ...image, dataUrl: "data:image/png;base64,ZnJhbWU=" }
  const setup = fixture(Response.json(completed()), { videoImages: [frame] })
  const result = await setup.run(false, { images: [image], videos: [video], csvFiles: [{ filename: "fixture.csv", csvData: "a,b\n1,2", csvRows: 1, csvColumns: 2 }], temperature: 0, top_p: 0.8, max_tokens: 99 })
  const sent = setup.requests[0]
  const payload = JSON.parse(sent.body)
  assert.equal(sent.url, endpoint.baseUrl + "/responses")
  assert.equal(sent.method, "POST")
  assert.equal(sent.headers.Authorization, "Bearer SERVER_ONLY")
  assert.equal(sent.headers["X-Private"], "HEADER_ONLY")
  assert.equal(sent.headers["Content-Type"], "application/json")
  assert.deepEqual(payload, {
    model: input.modelName, store: false,
    input: [{ role: "user", content: [{ type: "input_text", text: 'Explain this graph\n\nCSV Data from file "fixture.csv":\na,b\n1,2' }, { type: "input_image", image_url: image.dataUrl, detail: "auto" }, { type: "input_image", image_url: frame.dataUrl, detail: "auto" }] }],
    temperature: 0, top_p: 0.8, max_output_tokens: 99
  })
  assert.deepEqual(setup.videoInputs, [[video]])
  assert.deepEqual(result.providerRequestPayload, payload)
  assert.equal(result.responseText, "Answer")
  assert.equal(result.fullResponse, "Answer")
  assert.equal(JSON.parse(result.rawResponse).id, "resp_fixture")
  assert.equal(result.tokens, 20)
  assert.equal(result.usageSource, "provider")
  assert.equal(result.tokenBreakdown.cachedTokens, 7)
  assert.equal(result.tokenBreakdown.reasoningTokens, 3)
  assert.equal(result.tokenBreakdown.inputTokens, 12)
  assert.equal(result.tokenBreakdown.outputTokens, 8)
  assert.deepEqual(setup.observations, [{ output: result, prompt: payload.input[0].content[0].text }])
  assert.ok(!JSON.stringify(result).includes("SERVER_ONLY"))
  assert.ok(!JSON.stringify(result).includes("HEADER_ONLY"))
})

test("Responses concatenates text parts across messages and ignores private reasoning", async () => {
  const body = completed()
  body.output = [{ type: "reasoning", summary: [{ type: "summary_text", text: "PRIVATE_REASONING" }] }, message("First"), message(" second")]
  const setup = fixture(Response.json(body))
  assert.equal((await setup.run()).responseText, "First second")
})

test("Responses stream emits semantic text, then accounts before done without duplicating final text", async () => {
  const setup = fixture(streaming(event("response.created", { response: { status: "in_progress" } }) + event("response.output_text.delta", { delta: "An" }) + event("response.output_text.done", { text: "Answer" }) + event("response.output_text.delta", { delta: "swer" }) + terminal()))
  const result = await setup.run(true)
  assert.equal(result.responseText, "Answer")
  assert.deepEqual(setup.frames.slice(0, -1), [{ content: "An" }, { content: "swer" }])
  assert.equal(setup.frames.at(-1).done, true)
  assert.equal(setup.frames.at(-1).tokens, 20)
  assert.equal(setup.frames.at(-1).tokenBreakdown.cachedTokens, 7)
  assert.equal(setup.frames.at(-1).tokenBreakdown.reasoningTokens, 3)
  assert.deepEqual(setup.order, ["content", "content", "usage", "done"])
  assert.equal(setup.observations.length, 1)
  const payload = JSON.parse(setup.requests[0].body)
  assert.equal(payload.stream, true)
  assert.equal(payload.store, false)
  assert.equal(payload.stream_options, undefined)
  assert.equal(payload.messages, undefined)
  assert.equal(payload.max_tokens, undefined)
  assert.ok(result.rawResponse.includes('"type":"response.completed"'))
})

test("Responses completed snapshot supplies missing delta suffix or the whole text", async () => {
  for (const prefix of ["", event("response.output_text.delta", { delta: "An" })]) {
    const setup = fixture(streaming(prefix + terminal()))
    assert.equal((await setup.run(true)).responseText, "Answer")
    assert.equal(setup.frames.filter(value => value.content).map(value => value.content).join(""), "Answer")
  }
})

for (const stream of [false, true]) {
  test(`Responses preserves authoritative zero usage (${stream ? "stream" : "JSON"})`, async () => {
    const zero = { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }
    const setup = fixture(stream ? streaming(terminal("", zero)) : Response.json(completed("", zero)))
    const result = await setup.run(stream)
    assert.equal(result.tokens, 0)
    assert.equal(result.usageSource, "provider")
    assert.equal(result.tokenBreakdown.cachedTokens, 0)
    assert.equal(result.tokenBreakdown.reasoningTokens, 0)
    assert.equal(setup.observations[0].output.tokens, 0)
  })

  test(`Responses marks missing usage estimated with image cost (${stream ? "stream" : "JSON"})`, async () => {
    const body = completed()
    delete body.usage
    const setup = fixture(stream ? streaming(event("response.completed", { response: body })) : Response.json(body))
    const image = { dataUrl: "data:image/png;base64,eA==", mimeType: "image/png", width: 100, height: 100 }
    const result = await setup.run(stream, { images: [image] })
    const imageTokens = setup.load("src/lib/tokenCalculator.ts").calculateImageTokens([{ width: 100, height: 100, mimeType: "image/png" }], "openai")
    assert.equal(result.tokens, Math.ceil((input.finalPrompt.length + "Answer".length) / 4) + imageTokens)
    assert.equal(result.usageSource, "estimated")
    assert.equal(result.tokenBreakdown, null)
    assert.equal(setup.observations.length, 1)
  })

  for (const status of ["failed", "incomplete", "in_progress"]) {
    test(`Responses ${status} never succeeds and preserves usage (${stream ? "stream" : "JSON"})`, async () => {
      const body = { ...completed("Partial"), status, error: status === "failed" ? { message: "PRIVATE_PROVIDER_DETAIL" } : null }
      const type = status === "in_progress" ? "response.completed" : `response.${status}`
      const setup = fixture(stream ? streaming(event(type, { response: body })) : Response.json(body))
      await assert.rejects(setup.run(stream), error => error.status === 502 && !error.message.includes("PRIVATE_PROVIDER_DETAIL"))
      assert.equal(setup.observations.length, 1)
      assert.equal(setup.observations[0].output.tokens, 20)
      assert.ok(!setup.frames.some(value => value.done))
    })
  }

  test(`Responses refusal is explicit and keeps measured usage (${stream ? "stream" : "JSON"})`, async () => {
    const body = completed()
    body.output[0].content = [{ type: "refusal", refusal: "PRIVATE_REFUSAL_DETAIL" }]
    const setup = fixture(stream ? streaming(event("response.refusal.delta", { delta: "PRIVATE_REFUSAL_DETAIL" }) + event("response.completed", { response: body })) : Response.json(body))
    await assert.rejects(setup.run(stream), { message: "Provider refused the request", status: 502 })
    assert.equal(setup.observations[0].output.tokens, 20)
    assert.equal(setup.frames.length, 0)
  })
}

test("Responses derives total from input/output without adding cached/reasoning subsets", async () => {
  const counters = { ...usage }
  delete counters.total_tokens
  const setup = fixture(Response.json(completed("Answer", counters)))
  assert.equal((await setup.run()).tokens, 20)
})

test("Responses requires a prompt/model and rejects unsupported seed including zero before requests", async () => {
  for (const patch of [{ modelName: "" }, { finalPrompt: " " }, { seed: 0 }, { seed: 42 }]) {
    const setup = fixture(Response.json(completed()))
    await assert.rejects(setup.run(false, patch), error => error.status === 400)
    assert.equal(setup.requests.length, 0)
    assert.equal(setup.observations.length, 0)
  }
})

test("Responses HTTP errors cancel bodies and normalize credential/rate-limit/generic details", async () => {
  for (const [status, expected] of [[401, "Provider rejected the credentials"], [429, "Provider rate limit exceeded"], [404, "Provider model or endpoint was not found"], [500, "Provider request failed"]]) {
    let cancelled = false
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode("PRIVATE_UPSTREAM_ERROR")) }, cancel() { cancelled = true } }), { status })
    const setup = fixture(response)
    await assert.rejects(setup.run(), { message: expected, status: 502 })
    assert.equal(cancelled, true)
    assert.equal(setup.observations.length, 0)
  }
})

test("Responses stream handles bytewise UTF-8, CRLF/bare CR, comments and multiline data", async () => {
  const text = "Привет 😀 漢字"
  const delta = 'event: response.output_text.delta\r\n: heartbeat\r\ndata: {"type":"response.output_text.delta",\r\ndata: "delta":' + JSON.stringify(text) + "}\r\n\r\n"
  const setup = fixture(streaming(delta + terminal(text).replace(/\n/g, "\r"), 1))
  assert.equal((await setup.run(true)).responseText, text)
  assert.equal(setup.frames.filter(value => value.content).map(value => value.content).join(""), text)
})

test("Responses strict UTF-8 rejects corrupt/truncated sequences and keeps earlier observed usage", async () => {
  for (const invalid of [new Uint8Array([0xff]), new Uint8Array([0xe2, 0x82])]) {
    const prefix = encoder.encode(event("response.in_progress", { response: { usage } }))
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(prefix); controller.enqueue(invalid); controller.close() } }))
    const setup = fixture(response)
    await assert.rejects(setup.run(true), /invalid UTF-8/)
    assert.equal(setup.observations[0].output.tokens, 20)
    assert.equal(response.body.locked, false)
    assert.ok(!setup.frames.some(value => value.done))
  }
})

test("Responses JSON requires valid UTF-8/JSON and typed text output", async () => {
  for (const body of [new Uint8Array([0xff]), "{bad", "null", JSON.stringify({ ...completed(), output: [] }), JSON.stringify({ ...completed(), output: [message(5)] })]) {
    const setup = fixture(new Response(body))
    await assert.rejects(setup.run(), error => error.status === 502)
  }
})

test("Responses stream malformed/error events and EOF retain prior usage without done", async () => {
  const prefix = event("response.in_progress", { response: { usage } }) + event("response.output_text.delta", { delta: "Partial" })
  for (const suffix of ["data: {bad}\n\n", "data: []\n\n", 'data: {"type":"response.output_text.delta","delta":4}\n\n', event("error", { message: "PRIVATE_STREAM_ERROR", code: "PRIVATE_CODE" }), "", "data: [DONE]\n\n", terminal().trimEnd()]) {
    const setup = fixture(streaming(prefix + suffix))
    await assert.rejects(setup.run(true), error => error.status === 502 && !error.message.includes("PRIVATE_"))
    assert.equal(setup.observations.length, 1)
    assert.equal(setup.observations[0].output.tokens, 20)
    assert.deepEqual(setup.frames, [{ content: "Partial" }])
  }
})

test("Responses inconsistent final text fails after retaining the final usage", async () => {
  const setup = fixture(streaming(event("response.output_text.delta", { delta: "Different" }) + terminal()))
  await assert.rejects(setup.run(true), /inconsistent response text/)
  assert.equal(setup.observations[0].output.tokens, 20)
  assert.ok(!setup.frames.some(value => value.done))
})

test("Responses stops and cancels upstream immediately at completion, without waiting for EOF", async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(terminal())) }, cancel() { cancelled = true } }))
  const setup = fixture(response)
  assert.equal((await setup.run(true)).responseText, "Answer")
  assert.equal(cancelled, true)
  assert.equal(response.body.locked, false)
})

test("Responses downstream cancellation retains observed usage, cancels upstream and never emits done", async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(event("response.in_progress", { response: { usage } }) + event("response.output_text.delta", { delta: "Partial" }))) }, cancel() { cancelled = true } }))
  const setup = fixture(response)
  await assert.rejects(setup.run(true, {}, { enqueue() { throw new TypeError("PRIVATE_CANCELLED_CONTROLLER") } }), { message: "Provider request failed" })
  assert.equal(cancelled, true)
  assert.equal(response.body.locked, false)
  assert.equal(setup.observations[0].output.tokens, 20)
})

test("Responses final delivery failure does not record observed usage twice", async () => {
  const setup = fixture(streaming(terminal()), { failDelivery: true })
  await assert.rejects(setup.run(true), { message: "Provider request failed" })
  assert.equal(setup.observations.length, 1)
})

test("Responses reuses providerFetch abort signal and normalizes cancellation without secrets", async () => {
  const originalFetch = global.fetch
  const abort = new AbortController()
  let signal
  global.fetch = async (url, init) => {
    signal = init.signal
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("PRIVATE_ABORT_DETAIL", "AbortError")), { once: true })
      abort.abort()
    })
  }
  try {
    const setup = fixture(null, { realFetch: true })
    await assert.rejects(setup.load("src/lib/providerRequest.ts").withProviderSignal(abort.signal, () => setup.run(true)), { message: "Provider request timed out or was cancelled" })
    assert.equal(signal.aborted, true)
    assert.equal(setup.observations.length, 0)
  } finally { global.fetch = originalFetch }
})

test("Responses declared oversized bodies are rejected and cancelled in both modes", async () => {
  for (const stream of [false, true]) {
    let cancelled = false
    const response = new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { "Content-Length": String(32 * 1024 * 1024 + 1) } })
    const setup = fixture(response)
    await assert.rejects(setup.run(stream), /32 MiB limit/)
    assert.equal(cancelled, true)
    assert.ok(!setup.frames.some(value => value.done))
  }
})

test("Responses actual stream bytes are bounded even when no Content-Length is present", async () => {
  let cancelled = false
  let index = 0
  const chunks = [encoder.encode(event("response.in_progress", { response: { usage } })), new Uint8Array(32 * 1024 * 1024)]
  const response = new Response(new ReadableStream({ pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]) }, cancel() { cancelled = true } }))
  const setup = fixture(response)
  await assert.rejects(setup.run(true), /32 MiB limit/)
  assert.equal(cancelled, true)
  assert.equal(response.body.locked, false)
  assert.equal(setup.observations[0].output.tokens, 20)
})

test("Responses missing bodies fail cleanly without an execution receipt", async () => {
  for (const stream of [false, true]) {
    const setup = fixture(new Response(null))
    await assert.rejects(setup.run(stream), error => error.status === 502)
    assert.equal(setup.observations.length, 0)
  }
})
