const test = require("node:test")
const assert = require("node:assert/strict")
const { createLoader } = require("./loadSource")

function execution(overrides = {}) {
  let sent
  const load = createLoader({
    "@/lib/providerCredentials": {
      requireUserId: async () => "test-user",
      savedProviderKey: async () => "SERVER_ONLY_KEY",
      requireCanvasAccess: async () => {},
      requireVideoAccess: async () => {},
      ...overrides.credentials
    },
    "@/lib/videoAttachmentService": {},
    "@/lib/providerRequest": {
      withProviderSignal: (signal, callback) => callback(),
      providerFetch: async (url, options) => {
        sent = { url, ...options }
        return overrides.response ?? new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\r\n\r\ndata: [DONE]\r\n\r\n')
      }
    }
  })
  return { route: load("src/app/api/canvas/execute-node-stream/route.ts"), sent: () => sent, load }
}

function request(body) {
  return new Request("http://localhost/api/canvas/execute-node-stream", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "openai", finalPrompt: "hello", ...body })
  })
}

test("execution uses the server credential and completes a CRLF SSE stream", async () => {
  const fixture = execution()
  const response = await fixture.route.POST(request({ apiKey: "UNTRUSTED_CLIENT_KEY" }))
  const text = await response.text()
  assert.equal(fixture.sent().headers.Authorization, "Bearer SERVER_ONLY_KEY")
  assert.ok(text.includes('"done":true'))
  assert.ok(!text.includes("SERVER_ONLY_KEY"))
  assert.ok(!text.includes("UNTRUSTED_CLIENT_KEY"))
})

test("execution rejects a missing session before making a provider request", async () => {
  const fixture = execution({ credentials: { requireUserId: async () => { throw new (fixture.load("src/lib/apiErrors.ts").ApiError)("Unauthorized", 401) } } })
  const response = await fixture.route.POST(request())
  assert.equal(response.status, 401)
  assert.equal(fixture.sent(), undefined)
})

test("upstream failures never reveal raw provider errors", async () => {
  const fixture = execution({ response: new Response("FAKE_SECRET_IN_ERROR", { status: 401 }) })
  const response = await fixture.route.POST(request())
  const text = await response.text()
  assert.ok(text.includes("Provider rejected the credentials"))
  assert.ok(!text.includes("FAKE_SECRET_IN_ERROR"))
})

test("unknown errors are normalized and do not become public error messages", () => {
  const { publicError } = createLoader()("src/lib/apiErrors.ts")
  assert.equal(publicError(new Error("FAKE_SECRET_IN_ERROR")), "Provider request failed")
})

test("HTML escaping treats tags, attributes and entities as text", () => {
  const { escapeHtml } = createLoader()("src/lib/htmlEscape.ts")
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">&'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;")
})

test("public file resolution rejects traversal but accepts ordinary media paths", () => {
  const { resolvePublicPath } = createLoader()("src/lib/publicPath.ts")
  assert.throws(() => resolvePublicPath("../outside.txt"), /Invalid media path/)
  assert.ok(resolvePublicPath("/uploads/canvases/test/image.png").endsWith("/public/uploads/canvases/test/image.png"))
})

test("canvas and video guards reject foreign records and forged frames", async () => {
  let foundMedia = null
  const credentials = createLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: "test-user" } }) },
    "@/lib/crypto": {},
    "@/lib/prisma": { prisma: { canvas: { findFirst: async () => null }, media: { findFirst: async () => foundMedia } } }
  })("src/lib/providerCredentials.ts")
  await assert.rejects(credentials.requireCanvasAccess("test-user", "other-canvas"), /Canvas not found/)
  await assert.rejects(credentials.requireCanvasAccess("test-user", "../../outside"), /Invalid canvas ID/)
  await assert.rejects(credentials.requireVideoAccess("test-user", [{ mediaId: "foreign" }]), /Video not found/)
  foundMedia = { filePath: "/uploads/video.mp4", videoFrames: { frames: [{ path: "/uploads/frame.png" }] } }
  await assert.rejects(credentials.requireVideoAccess("test-user", [{ mediaId: "owned", frames: [{ path: "../outside" }] }]), /Invalid video frame/)
})

test("reveal is an authenticated POST with no-store, without GET", async () => {
  const route = createLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: "test-user" } }) },
    "@/lib/providerCredentials": { requireUserId: async () => "test-user", savedProviderKey: async () => "SYNTHETIC_REVEALED_KEY" }
  })("src/app/api/settings/keys/route.ts")
  assert.equal(route.GET, undefined)
  const response = await route.POST(request({ provider: "openai" }))
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal((await response.json()).apiKey, "SYNTHETIC_REVEALED_KEY")
})
