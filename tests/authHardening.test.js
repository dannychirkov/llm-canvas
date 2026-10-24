const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { createLoader } = require("./loadSource")

function jsonRequest(body, url = "http://localhost/api/auth/register") {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}

function authFixture() {
  let config
  let current = { email: "fixture@example.test", name: "Fixture", image: null, analyticsEnabled: false, authVersion: 0 }
  const load = createLoader({
    "next-auth": options => { config = options; return { handlers: {} } },
    "next-auth/providers/credentials": options => options,
    "./prisma": { prisma: { user: { findUnique: async () => current } } },
  })
  const previous = process.env.AUTH_SECRET
  process.env.AUTH_SECRET = "isolated-test-secret"
  try { load("src/lib/auth.ts") } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = previous
  }
  return { config, setUser: value => { current = value } }
}

test("legacy JWTs survive profile and usage updates, and fail after password rotation", async () => {
  const fixture = authFixture()
  const legacy = { id: "fixture-user" }
  const valid = await fixture.config.callbacks.jwt({ token: legacy })
  assert.equal(valid.authVersion, 0)
  fixture.setUser({ email: "fixture@example.test", authVersion: 0, updatedAt: new Date(), analyticsEnabled: true })
  assert.ok(await fixture.config.callbacks.jwt({ token: { ...legacy }, trigger: "update" }))
  fixture.setUser({ authVersion: 1 })
  assert.equal(await fixture.config.callbacks.jwt({ token: { ...legacy } }), null)
  assert.equal(await fixture.config.callbacks.jwt({ token: { ...legacy }, trigger: "update" }), null)
  assert.equal((await fixture.config.callbacks.jwt({ token: { id: "fixture-user", authVersion: 1 } })).authVersion, 1)
})

test("new sign-ins record the current version and deleted users fail closed", async () => {
  const fixture = authFixture()
  fixture.setUser({ authVersion: 3, analyticsEnabled: false })
  const token = await fixture.config.callbacks.jwt({ token: {}, user: { id: "fixture-user", authVersion: 3 } })
  assert.equal(token.authVersion, 3)
  fixture.setUser(null)
  assert.equal(await fixture.config.callbacks.jwt({ token }), null)
})

test("auth limiter bounds identities, retains exhausted buckets, and expires entries", () => {
  let timestamp = 0
  const { createAuthLimiter } = createLoader()("src/lib/authHardening.ts")
  const limit = createAuthLimiter(2, () => timestamp)
  limit("login", "first", 1, 1000)
  assert.throws(() => limit("login", "first", 1, 1000), error => error.statusCode === 429)
  limit("login", "second", 1, 1000)
  assert.throws(() => limit("login", "third", 1, 1000), error => error.statusCode === 429)
  timestamp = 1001
  assert.doesNotThrow(() => limit("login", "third", 1, 1000))
})

test("password inputs reject non-strings and bcrypt truncation at UTF-8 byte boundaries", () => {
  const { validPasswordInput } = createLoader()("src/lib/authHardening.ts")
  assert.equal(validPasswordInput({}), false)
  assert.equal(validPasswordInput("a".repeat(73)), false)
  assert.equal(validPasswordInput("é".repeat(37)), false)
  assert.equal(validPasswordInput("é".repeat(36)), true)
})

test("password work admits two operations, rejects excess, and releases slots on failure", async () => {
  const { withPasswordWork } = createLoader()("src/lib/authHardening.ts")
  let releaseFirst
  let releaseSecond
  const first = withPasswordWork(() => new Promise(resolve => { releaseFirst = resolve }))
  const second = withPasswordWork(() => new Promise(resolve => { releaseSecond = resolve }))
  await assert.rejects(withPasswordWork(async () => true), error => error.statusCode === 429)
  releaseFirst()
  releaseSecond()
  await Promise.all([first, second])
  await assert.rejects(withPasswordWork(async () => { throw new Error("fixture") }))
  assert.equal(await withPasswordWork(async () => true), true)
})

test("auth body budgets reject declared and chunked oversized bodies and malformed JSON", async () => {
  const { readAuthJson, readAuthBody } = createLoader()("src/lib/authHardening.ts")
  await assert.rejects(readAuthBody(new Request("http://localhost", { method: "POST", headers: { "Content-Length": "9000" }, body: "x" })), error => error.statusCode === 413)
  await assert.rejects(readAuthBody(new Request("http://localhost", { method: "POST", body: "x".repeat(8193) })), error => error.statusCode === 413)
  await assert.rejects(readAuthJson(new Request("http://localhost", { method: "POST", body: "{" })), error => error.statusCode === 400)
  await assert.rejects(readAuthJson(jsonRequest([])), error => error.statusCode === 400)
})

test("registration rejects ineligible invites before bcrypt or a transaction", async () => {
  let hashes = 0
  let transactions = 0
  const route = createLoader({
    "@/lib/prisma": { prisma: {
      user: { findUnique: async () => null, count: async () => 1, findFirst: async () => ({ id: "owner" }) },
      inviteCode: { findUnique: async () => null },
      $transaction: async () => { transactions += 1 },
    } },
    "bcryptjs": { hash: async () => { hashes += 1 } },
  })("src/app/api/auth/register/route.ts")
  const response = await route.POST(jsonRequest({ email: "invalid-invite@example.test", password: "Fixture-Test9!", inviteCode: "invalid" }))
  assert.equal(response.status, 400)
  assert.equal(hashes, 0)
  assert.equal(transactions, 0)
})

test("first registration still claims ownership and disables analytics for new accounts", async () => {
  let created
  const tx = { user: {
    findUnique: async () => null,
    count: async () => 0,
    findFirst: async () => null,
    create: async ({ data }) => { created = { ...data, id: "first-owner" }; return created },
    update: async () => ({}),
  } }
  const prisma = { ...tx, $transaction: async callback => callback(tx) }
  const route = createLoader({ "@/lib/prisma": { prisma }, "bcryptjs": { hash: async () => "fixture-hash" } })("src/app/api/auth/register/route.ts")
  const response = await route.POST(jsonRequest({ email: "bootstrap@example.test", password: "Fixture-Test9!" }))
  assert.equal(response.status, 200)
  assert.equal(created.isOwner, true)
  assert.equal(created.storageLimitBytes, null)
  assert.equal(created.analyticsEnabled, false)
})

test("password rotation atomically compares the old credential and increments authVersion", async () => {
  let update
  const route = createLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: "fixture-user" } }) },
    "@/lib/prisma": { prisma: { user: {
      findUnique: async () => ({ passwordHash: "old-hash", authVersion: 2 }),
      updateMany: async options => { update = options; return { count: 1 } },
    } } },
    "bcryptjs": { compare: async value => value === "Fixture-Old9!", hash: async () => "new-hash" },
  })("src/app/api/auth/change-password/route.ts")
  const response = await route.POST(jsonRequest({ currentPassword: "Fixture-Old9!", newPassword: "Fixture-New9!" }))
  assert.equal(response.status, 200)
  assert.deepEqual(update.where, { id: "fixture-user", passwordHash: "old-hash", authVersion: 2 })
  assert.deepEqual(update.data.authVersion, { increment: 1 })
})

test("concurrent password rotations return a conflict rather than overwriting a newer password", async () => {
  const route = createLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: "fixture-user-concurrent" } }) },
    "@/lib/prisma": { prisma: { user: { findUnique: async () => ({ passwordHash: "old-hash", authVersion: 0 }), updateMany: async () => ({ count: 0 }) } } },
    "bcryptjs": { compare: async value => value === "Fixture-Old9!", hash: async () => "new-hash" },
  })("src/app/api/auth/change-password/route.ts")
  const response = await route.POST(jsonRequest({ currentPassword: "Fixture-Old9!", newPassword: "Fixture-New9!" }))
  assert.equal(response.status, 409)
})

test("proxy protects anonymous direct paths and rewrites authenticated media through ownership checks", async () => {
  const { NextRequest } = require("next/server")
  let session = null
  const { proxy } = createLoader({
    "@/lib/auth": { auth: async () => session },
    "@/lib/prisma": { prisma: { user: { count: async () => 1, findUnique: async () => ({ image: "/uploads/avatars/own.png" }) } } },
  })("src/proxy.ts")
  for (const pathname of ["/uploads/canvases/foreign/private.png", "/canvases/foreign/private.png", "/%75ploads/canvases/foreign/private.png", "/uploads/avatars/own.png"]) {
    assert.equal((await proxy(new NextRequest("http://localhost" + pathname))).status, 401)
  }
  assert.equal((await proxy(new NextRequest("http://localhost/_next/image?url=%2Fuploads%2Fcanvases%2Fprivate.png&w=64&q=75"))).status, 404)
  session = { user: { id: "fixture-user" } }
  const response = await proxy(new NextRequest("http://localhost/uploads/canvases/foreign/private.png"))
  assert.equal(response.headers.get("x-middleware-rewrite"), "http://localhost/api/media/serve/uploads/canvases/foreign/private.png")
  assert.equal((await proxy(new NextRequest("http://localhost/uploads/avatars/foreign.png"))).status, 404)
  assert.equal((await proxy(new NextRequest("http://localhost/uploads/avatars/own.png"))).headers.get("Cache-Control"), "private, no-store")
})

test("proxy fails closed when authentication or bootstrap lookup is unavailable", async () => {
  const { NextRequest } = require("next/server")
  const { proxy } = createLoader({
    "@/lib/auth": { auth: async () => null },
    "@/lib/prisma": { prisma: { user: { count: async () => { throw new Error("private database failure") } } } },
  })("src/proxy.ts")
  const response = await proxy(new NextRequest("http://localhost/dashboard"))
  assert.equal(response.status, 503)
  assert.ok(!(await response.text()).includes("private database failure"))
})

test("Next compiles the proxy matcher for private files and image optimization", () => {
  const { unstable_doesMiddlewareMatch } = require("next/experimental/testing/server")
  const { config } = createLoader({ "@/lib/auth": {}, "@/lib/prisma": {} })("src/proxy.ts")
  for (const url of ["/uploads/canvases/private.png", "/canvases/private.png", "/_next/image?url=%2Fuploads%2Fprivate.png", "/dashboard"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }), true)
  }
  for (const url of ["/_next/static/test.js", "/api/health", "/api/auth/session"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }), false)
  }
})

test("analytics makes no SDK calls until installation and session both opt in, and stops after opt-out", async context => {
  const previous = { window: global.window, enabled: process.env.NEXT_PUBLIC_ANALYTICS_ENABLED, key: process.env.NEXT_PUBLIC_POSTHOG_KEY, host: process.env.NEXT_PUBLIC_POSTHOG_HOST }
  context.after(() => {
    if (previous.window === undefined) delete global.window
    else global.window = previous.window
    for (const [name, value] of [["NEXT_PUBLIC_ANALYTICS_ENABLED", previous.enabled], ["NEXT_PUBLIC_POSTHOG_KEY", previous.key], ["NEXT_PUBLIC_POSTHOG_HOST", previous.host]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
  global.window = {}
  const calls = []
  const sdk = Object.fromEntries(["init", "capture", "opt_in_capturing", "opt_out_capturing", "reset"].map(name => [name, (...args) => calls.push({ name, args })]))
  const load = createLoader({ "posthog-js": sdk })
  const analytics = load("src/lib/analytics.ts")
  const { initPostHog } = load("src/lib/posthog.ts")
  delete process.env.NEXT_PUBLIC_ANALYTICS_ENABLED
  initPostHog(true)
  analytics.trackPageView("/dashboard")
  assert.equal(calls.length, 0)
  process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = "true"
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "fixture-project"
  process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://analytics.example.test"
  initPostHog(false)
  assert.equal(calls.length, 0)
  initPostHog(true)
  analytics.trackPageView("/dashboard")
  assert.deepEqual(calls.map(call => call.name), ["init", "capture"])
  assert.equal(calls[0].args[1].autocapture, false)
  assert.equal(calls[0].args[1].disable_session_recording, true)
  initPostHog(false)
  const count = calls.length
  analytics.trackPageView("/settings")
  assert.equal(calls.length, count)
})

test("readiness checks an isolated database and uploads, cleans probes, and fails on unavailable storage", async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "llm-canvas-readiness-"))
  const previous = { database: process.env.DATABASE_URL, uploads: process.env.UPLOADS_DIR }
  context.after(async () => {
    for (const [name, value] of [["DATABASE_URL", previous.database], ["UPLOADS_DIR", previous.uploads]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await fs.rm(root, { recursive: true, force: true })
  })
  const database = path.join(root, "test.db")
  const uploads = path.join(root, "uploads")
  await fs.writeFile(database, "fixture")
  await fs.mkdir(uploads)
  process.env.DATABASE_URL = "file:" + database
  process.env.UPLOADS_DIR = uploads
  let reads = 0
  const overrides = { "@/lib/prisma": { prisma: { user: { findFirst: async () => { reads += 1; return null } } } } }
  const ready = createLoader(overrides)("src/app/api/health/route.ts")
  assert.equal((await ready.GET()).status, 200)
  assert.equal((await ready.GET()).status, 200)
  assert.equal(reads, 1)
  assert.deepEqual(await fs.readdir(uploads), [])
  assert.deepEqual((await fs.readdir(root)).sort(), ["test.db", "uploads"])
  process.env.UPLOADS_DIR = path.join(root, "missing")
  assert.equal((await createLoader(overrides)("src/app/api/health/route.ts").GET()).status, 503)
  process.env.DATABASE_URL = "file:" + path.join(root, "absent.db")
  const missing = await createLoader(overrides)("src/app/api/health/route.ts").GET()
  assert.equal(missing.status, 503)
  assert.equal(missing.headers.get("Cache-Control"), "no-store")
  await assert.rejects(fs.access(path.join(root, "absent.db")))
})

test("real SQLite copy and Auth.js reject a saved JWT after an actual password change", async context => {
  const { PrismaClient } = require("@prisma/client")
  const bcrypt = require("bcryptjs")
  const { Auth } = await import("@auth/core")
  const { encode } = await import("next-auth/jwt")
  const { default: Credentials } = await import("next-auth/providers/credentials")
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "llm-canvas-auth-sqlite-"))
  const baselinePath = path.join(root, "baseline.db")
  const copyPath = path.join(root, "copy.db")
  const baseline = new PrismaClient({ datasources: { db: { url: "file:" + baselinePath } } })
  const copy = new PrismaClient({ datasources: { db: { url: "file:" + copyPath } } })
  context.after(async () => {
    await baseline.$disconnect()
    await copy.$disconnect()
    await fs.rm(root, { recursive: true, force: true })
  })
  const initial = await fs.readFile("prisma/migrations/20251129041707_init/migration.sql", "utf8")
  for (const statement of initial.replace(/^\s*--.*$/gm, "").split(";").filter(part => part.trim())) await baseline.$executeRawUnsafe(statement)
  const passwordHash = await bcrypt.hash("Fixture-Old9!", 4)
  await baseline.$executeRawUnsafe('INSERT INTO users (id, email, passwordHash, updatedAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP)', "sqlite-fixture-user", "sqlite-fixture@example.test", passwordHash)
  const before = await baseline.$queryRawUnsafe('SELECT id, email, passwordHash, analyticsEnabled, updatedAt FROM users')
  await baseline.$disconnect()
  await fs.copyFile(baselinePath, copyPath)
  const additive = await fs.readFile("prisma/migrations/20261023000100_auth_version/migration.sql", "utf8")
  for (const statement of additive.split(";").filter(part => part.trim())) await copy.$executeRawUnsafe(statement)
  assert.deepEqual(await copy.$queryRawUnsafe('SELECT id, email, passwordHash, analyticsEnabled, updatedAt FROM users'), before)
  assert.equal((await copy.user.findUnique({ where: { id: "sqlite-fixture-user" } })).authVersion, 0)
  let config
  const previousSecret = process.env.AUTH_SECRET
  process.env.AUTH_SECRET = "isolated-test-secret"
  try {
    createLoader({
      "next-auth": options => { config = options; return { handlers: {} } },
      "next-auth/providers/credentials": Credentials,
      "./prisma": { prisma: copy },
    })("src/lib/auth.ts")
  } finally {
    if (previousSecret === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = previousSecret
  }
  config = { ...config, basePath: "/api/auth", logger: { error() {}, warn() {}, debug() {} } }
  const cookieName = "authjs.session-token"
  const oldJwt = await encode({ token: { id: "sqlite-fixture-user", email: "sqlite-fixture@example.test" }, secret: config.secret, salt: cookieName })
  async function session(jwt) {
    const response = await Auth(new Request("http://localhost/api/auth/session", { headers: { cookie: cookieName + "=" + jwt } }), config)
    assert.equal(response.status, 200)
    return response.json()
  }
  assert.equal((await session(oldJwt)).user.id, "sqlite-fixture-user")
  await copy.user.update({ where: { id: "sqlite-fixture-user" }, data: { name: "Updated fixture", totalTokensCreated: { increment: 10 } } })
  assert.equal((await session(oldJwt)).user.id, "sqlite-fixture-user")
  const route = createLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: "sqlite-fixture-user" } }) },
    "@/lib/prisma": { prisma: copy },
  })("src/app/api/auth/change-password/route.ts")
  const changed = await route.POST(jsonRequest({ currentPassword: "Fixture-Old9!", newPassword: "Fixture-New9!" }))
  assert.equal(changed.status, 200)
  assert.equal(await session(oldJwt), null)
  const user = await config.providers[0].options.authorize({ email: "sqlite-fixture@example.test", password: "Fixture-New9!" })
  assert.equal(user.authVersion, 1)
  const freshJwt = await encode({ token: { id: user.id, email: user.email, authVersion: user.authVersion }, secret: config.secret, salt: cookieName })
  assert.equal((await session(freshJwt)).user.id, user.id)
})

test("readiness times out in two seconds and keeps only one database probe in flight", async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "llm-canvas-readiness-timeout-"))
  const previous = process.env.DATABASE_URL
  context.after(async () => {
    if (previous === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previous
    await fs.rm(root, { recursive: true, force: true })
  })
  const database = path.join(root, "test.db")
  await fs.writeFile(database, "fixture")
  process.env.DATABASE_URL = "file:" + database
  let reads = 0
  let release
  const route = createLoader({ "@/lib/prisma": { prisma: { user: { findFirst: () => {
    reads += 1
    return new Promise((resolve, reject) => { release = () => reject(new Error("fixture timeout")) })
  } } } } })("src/app/api/health/route.ts")
  const started = Date.now()
  const responses = await Promise.all([route.GET(), route.GET(), route.GET()])
  assert.ok(Date.now() - started < 3000)
  assert.equal(reads, 1)
  assert.ok(responses.every(response => response.status === 503))
  release()
  await new Promise(resolve => setImmediate(resolve))
})
