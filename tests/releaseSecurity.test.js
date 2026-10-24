const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const os = require("node:os")
const AdmZip = require("adm-zip")
const { NextRequest } = require("next/server")
const { createLoader } = require("./loadSource")
const authHardening = createLoader()("src/lib/authHardening.ts")

function proxyFixture() {
  return createLoader({
    "@/lib/auth": { auth: async () => { throw new Error("API proxy must not authenticate or redirect") } },
    "@/lib/prisma": { prisma: new Proxy({}, { get() { throw new Error("API proxy must not query the database") } }) },
  })("src/proxy.ts").proxy
}

function mutation(url = "http://localhost/api/settings", headers = {}, body = "{}") {
  return new NextRequest(url, { method: "PUT", headers: { "content-type": "application/json", ...headers }, body })
}

test("actual API boundary blocks foreign and opaque origins before settings can be written", async () => {
  let writes = 0
  const transaction = { userSettings: {
    findUnique: async () => ({ providers: {} }),
    upsert: async () => { writes++ },
  } }
  const route = createLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: "settings-fixture" } }) },
    "@/lib/prisma": { prisma: { $transaction: callback => callback(transaction) } },
    "@/lib/crypto": {},
  })("src/app/api/settings/route.ts")
  for (const headers of [
    { origin: "http://foreign.example", "sec-fetch-site": "same-site" },
    { origin: "null" },
    { origin: "http://localhost", "sec-fetch-site": "cross-site" },
  ]) {
    const request = mutation(undefined, headers, '{"openai":{"activeModels":["fixture"]}}')
    const response = await route.PUT(request)
    assert.equal(response.status, 403)
    assert.equal(response.headers.get("cache-control"), "no-store")
  }
  assert.equal(writes, 0)
})

test("API boundary allows canonical TLS origin, candidate origin, and originless tools", async context => {
  const previous = process.env.AUTH_URL
  process.env.AUTH_URL = "https://canvas.example"
  context.after(() => previous === undefined ? delete process.env.AUTH_URL : process.env.AUTH_URL = previous)
  const proxy = request => createLoader()("src/lib/apiBoundary.ts").withApiBoundary(request, () => new Response(null, { headers: { "x-middleware-next": "1" } }))
  for (const request of [
    mutation("http://127.0.0.1:4250/api/settings", { origin: "https://canvas.example" }),
    mutation(),
    new NextRequest("http://localhost/api/auth/session"),
    new NextRequest("http://localhost/api/health"),
  ]) assert.equal((await proxy(request)).headers.get("x-middleware-next"), "1")
  process.env.AUTH_URL = "http://127.0.0.1:4252"
  assert.equal((await proxy(mutation("http://127.0.0.1:4252/api/settings", { origin: "http://127.0.0.1:4252" }))).headers.get("x-middleware-next"), "1")
})

test("API boundary rejects simple text JSON and permits upload and NextAuth form protocols", async () => {
  const proxy = request => createLoader()("src/lib/apiBoundary.ts").withApiBoundary(request, () => new Response(null, { headers: { "x-middleware-next": "1" } }))
  for (const headers of [
    { "content-type": "text/plain" },
    { "content-type": "application/x-www-form-urlencoded" },
  ]) assert.equal((await proxy(mutation(undefined, headers))).status, 415)
  const form = new FormData()
  form.set("avatar", new File(["fixture"], "fixture.png", { type: "image/png" }))
  for (const request of [
    new NextRequest("http://localhost/api/profile/avatar", { method: "POST", body: form }),
    new NextRequest("http://localhost/api/auth/callback/credentials", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "csrfToken=synthetic" }),
    new NextRequest("http://localhost/api/init-cache", { method: "POST" }),
  ]) assert.equal((await proxy(request)).headers.get("x-middleware-next"), "1")
})

function deletionFixture(id, options = {}) {
  let comparisons = 0
  let removed = false
  const empty = { deleteMany: async () => ({ count: 0 }) }
  const user = { id, email: `${id}@example.invalid`, passwordHash: "fixture-hash", canvases: [] }
  const transaction = { node: empty, media: empty, canvas: empty, userSettings: empty, inviteCode: empty, user: { findUnique: async () => user, count: async () => 1, delete: async () => { removed = true } } }
  const route = createLoader({
    "@/lib/auth": { auth: async () => ({ user: { id } }) },
    "@/lib/authHardening": authHardening,
    "@/lib/prisma": { prisma: { user: { findUnique: async () => user }, $transaction: callback => callback(transaction) } },
    "bcryptjs": { compare: async (...args) => { comparisons++; return options.compare ? options.compare(...args) : false } },
    "@/lib/safeMedia": { cleanupCanvasMedia: async () => { throw new Error("No canvas fixture should be cleaned") } },
  })("src/app/api/account/delete/route.ts")
  const request = (password = "Fixture-Test9!", headers = {}) => new Request("http://localhost/api/account/delete", { method: "DELETE", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ email: user.email, password }) })
  return { route, request, comparisons: () => comparisons, removed: () => removed }
}

test("account deletion rejects oversized bodies and bcrypt truncation before password work", async () => {
  const fixture = deletionFixture("delete-bounded")
  assert.equal((await fixture.route.DELETE(fixture.request("x".repeat(100000)))).status, 413)
  assert.equal((await fixture.route.DELETE(fixture.request("x".repeat(73)))).status, 400)
  assert.equal((await fixture.route.DELETE(fixture.request({ password: "wrong type" }))).status, 400)
  assert.equal((await fixture.route.DELETE(fixture.request("valid", { "content-length": "9000" }))).status, 413)
  assert.equal(fixture.comparisons(), 0)
  assert.equal(fixture.removed(), false)
})

test("account deletion limits repeated guesses and shares the bounded password work pool", async () => {
  const fixture = deletionFixture("delete-rate")
  for (let index = 0; index < 10; index++) assert.equal((await fixture.route.DELETE(fixture.request())).status, 400)
  const rejected = await fixture.route.DELETE(fixture.request())
  assert.equal(rejected.status, 429)
  assert.equal(rejected.headers.get("retry-after"), "60")
  assert.equal(fixture.comparisons(), 10)
  const releases = []
  const busy = deletionFixture("delete-concurrent", { compare: () => new Promise(resolve => releases.push(resolve)) })
  const first = busy.route.DELETE(busy.request())
  const second = busy.route.DELETE(busy.request())
  while (releases.length < 2) await new Promise(resolve => setImmediate(resolve))
  assert.equal((await busy.route.DELETE(busy.request())).status, 429)
  releases.forEach(resolve => resolve(false))
  assert.deepEqual((await Promise.all([first, second])).map(response => response.status), [400, 400])
  assert.equal(busy.comparisons(), 2)
})

test("account deletion still requires the right password and completes an authorized deletion", async () => {
  const fixture = deletionFixture("delete-valid", { compare: async password => password === "Fixture-Test9!" })
  assert.equal((await fixture.route.DELETE(fixture.request("incorrect"))).status, 400)
  assert.equal(fixture.removed(), false)
  assert.equal((await fixture.route.DELETE(fixture.request())).status, 200)
  assert.equal(fixture.removed(), true)
})

test("actual backup import preserves every usage provenance and rejects invalid labels before writes", async context => {
  const repository = process.cwd()
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "llm-canvas-import-provenance-"))
  context.after(async () => { process.chdir(repository); await fs.rm(directory, { recursive: true, force: true }) })
  let writes = []
  const transaction = {
    canvas: { create: async () => ({}) },
    node: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
    tokenUsage: { create: async ({ data }) => { writes.push(data) } },
    user: { update: async () => ({}) },
  }
  const route = createLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: "import-fixture" } }) },
    "@/lib/prisma": { prisma: { ...transaction, $transaction: callback => callback(transaction) } },
    "@/lib/storageUtils": { withStorageReservation: async (id, bytes, operation) => operation({ verify() {} }) },
    "@/lib/providers/customStore": { normalizeImportedProviders: async value => value },
  })("src/app/api/import-data/route.ts")
  function request(sources) {
    const zip = new AdmZip()
    zip.addFile("user.json", Buffer.from("{}"))
    zip.addFile("settings.json", Buffer.from("{}"))
    zip.addFile("canvases.json", Buffer.from(JSON.stringify([{
      id: "backup-canvas", title: "Fixture", content: { nodes: [], edges: [] },
      tokenUsage: sources.map(usageSource => ({ operator: "custom", modelName: "fixture", totalTokens: 100, usageSource })),
    }])))
    const form = new FormData()
    form.set("file", new File([zip.toBuffer()], "backup.zip", { type: "application/zip" }))
    form.set("action", "import")
    form.set("selectedCanvasIds", '["backup-canvas"]')
    return new Request("http://localhost/api/import-data", { method: "POST", body: form })
  }
  process.chdir(directory)
  const sources = ["provider", "estimated", "unreported", "legacy", null]
  const response = await route.POST(request(sources))
  assert.equal(response.status, 200, JSON.stringify(await response.json()))
  assert.deepEqual(writes.map(row => row.usageSource), sources)
  writes = []
  const invalid = await route.POST(request(["invented-source"]))
  assert.equal(invalid.status, 400)
  assert.equal(writes.length, 0)
})
