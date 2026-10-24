const test = require("node:test")
const assert = require("node:assert/strict")
const { createLoader } = require("./loadSource")
const { readBoundedJson } = createLoader()("src/lib/requestBody.ts")

test("settings JSON is bounded by actual streamed bytes without trusting Content-Length", async () => {
  let cancelled = false
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(32)) }, cancel() { cancelled = true } })
  const request = new Request("http://fixture.invalid", { method: "POST", body, duplex: "half" })
  await assert.rejects(readBoundedJson(request, 64), error => error.status === 413)
  assert.equal(cancelled, true)
})

test("settings JSON rejects malformed UTF-8, oversized declared sizes and non-object documents", async () => {
  for (const body of [new Uint8Array([255]), "[]", "null", "invalid"]) await assert.rejects(readBoundedJson(new Request("http://fixture.invalid", { method: "POST", body })), error => error.status === 400)
  await assert.rejects(readBoundedJson(new Request("http://fixture.invalid", { method: "POST", body: "{}", headers: { "content-length": "1000" } }), 64), error => error.status === 413)
  assert.deepEqual(await readBoundedJson(new Request("http://fixture.invalid", { method: "POST", body: '{"label":"Example"}' })), { label: "Example" })
})
