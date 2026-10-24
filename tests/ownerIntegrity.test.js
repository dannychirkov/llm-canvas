const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const { Prisma, PrismaClient } = require("@prisma/client")
const bcrypt = require("bcryptjs")
const { createLoader } = require("./loadSource")

const password = "Fixture-Owner9!"
const accountPath = "src/app/api/account/delete/route.ts"
const storagePath = "src/app/api/users/[id]/storage/route.ts"
const authHardening = createLoader()("src/lib/authHardening.ts")
const authOverrides = { ...authHardening, enforceAuthRate() {}, withPasswordWork: work => work() }

function request(body, method = "DELETE") {
  return new Request("http://fixture.invalid/api/account", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  })
}

function accountFixture(options = {}) {
  const writes = []
  const cleanups = []
  const events = []
  let inTransaction = false
  const user = {
    id: "fixture-user", email: "fixture@example.invalid", passwordHash: "fixture-hash",
    isOwner: false, canvases: [{ id: "fixture-canvas" }], ...options.user
  }
  const persisted = options.persisted === undefined ? user : options.persisted
  const tx = { user: {
    findUnique: async () => {
      assert.equal(inTransaction, true)
      events.push("ownership")
      return persisted
    },
    count: async () => {
      assert.equal(inTransaction, true)
      events.push("count")
      if (options.countError) throw options.countError
      return options.count ?? 2
    },
    delete: async () => { writes.push("user") }
  } }
  for (const model of ["node", "media", "canvas", "userSettings", "inviteCode"]) {
    tx[model] = { deleteMany: async () => { writes.push(model); return { count: 1 } } }
  }
  const route = createLoader({
    "@/lib/auth": { auth: async () => options.anonymous ? null : { user: { id: user.id, isOwner: false } } },
    "@/lib/authHardening": authOverrides,
    "@/lib/prisma": { prisma: {
      user: { findUnique: async () => user },
      $transaction: async (callback, transactionOptions) => {
        assert.equal(transactionOptions.isolationLevel, Prisma.TransactionIsolationLevel.Serializable)
        inTransaction = true
        try { return await callback(tx) } finally { inTransaction = false }
      }
    } },
    "@/lib/safeMedia": { cleanupCanvasMedia: async id => { cleanups.push(id) } },
    "bcryptjs": { compare: async (value, hash) => value === password && hash === "fixture-hash" }
  })(accountPath)
  return { route, writes, cleanups, events, user }
}

test("persisted owner with any other user is guarded before all destructive writes", async () => {
  for (const count of [2, 3]) {
    const fixture = accountFixture({ persisted: { isOwner: true, email: "fixture@example.invalid", passwordHash: "fixture-hash" }, count })
    const response = await fixture.route.DELETE(request({ email: fixture.user.email, password }))
    assert.equal(response.status, 409)
    assert.match((await response.json()).error, /owner account while other users remain/)
    assert.deepEqual(fixture.events, ["ownership", "count"])
    assert.deepEqual(fixture.writes, [])
    assert.deepEqual(fixture.cleanups, [])
  }
})

test("sole owner and invited users can self-delete after password validation", async () => {
  for (const [isOwner, count] of [[true, 1], [false, 3]]) {
    const fixture = accountFixture({ user: { isOwner }, count })
    const response = await fixture.route.DELETE(request({ email: fixture.user.email, password }))
    assert.equal(response.status, 200)
    assert.deepEqual(fixture.events, isOwner ? ["ownership", "count"] : ["ownership"])
    assert.deepEqual(fixture.writes, ["node", "media", "canvas", "userSettings", "inviteCode", "user"])
    assert.deepEqual(fixture.cleanups, ["fixture-canvas"])
  }
})

test("deletion rejects incorrect email, password, absent credentials and anonymous requests before writes", async () => {
  for (const options of [{}, { user: { isOwner: true }, count: 1 }, { user: { passwordHash: null } }, { anonymous: true }]) {
    for (const body of [
      { email: "fixture@example.invalid", password: "incorrect" },
      { email: "other@example.invalid", password },
      { email: "fixture@example.invalid", password: "x".repeat(73) }
    ]) {
      const fixture = accountFixture(options)
      const response = await fixture.route.DELETE(request(body))
      assert.equal(response.status, options.anonymous ? 401 : 400)
      assert.deepEqual(fixture.events, [])
      assert.deepEqual(fixture.writes, [])
      assert.deepEqual(fixture.cleanups, [])
    }
  }
  const fixture = accountFixture({ user: { passwordHash: null } })
  assert.equal((await fixture.route.DELETE(request({ email: fixture.user.email, password }))).status, 400)
  assert.deepEqual(fixture.writes, [])
})

test("deleted accounts and credentials changed during password verification fail closed", async () => {
  for (const persisted of [null,
    { isOwner: false, email: "fixture@example.invalid", passwordHash: "new-hash" },
    { isOwner: false, email: "changed@example.invalid", passwordHash: "fixture-hash" }
  ]) {
    const fixture = accountFixture({ persisted })
    assert.equal((await fixture.route.DELETE(request({ email: fixture.user.email, password }))).status, 409)
    assert.deepEqual(fixture.writes, [])
    assert.deepEqual(fixture.cleanups, [])
  }
})

test("transaction conflicts during the owner count fail closed with a normalized response", async () => {
  for (const code of ["P2034", "P2028", "P2025"]) {
    const fixture = accountFixture({ user: { isOwner: true }, countError: new Prisma.PrismaClientKnownRequestError("private conflict details", { code, clientVersion: "test" }) })
    const response = await fixture.route.DELETE(request({ email: fixture.user.email, password }))
    assert.equal(response.status, 409)
    assert.ok(!(await response.text()).includes("private conflict details"))
    assert.deepEqual(fixture.writes, [])
    assert.deepEqual(fixture.cleanups, [])
  }
})

function storageFixture(options = {}) {
  const reads = []
  const writes = []
  const route = createLoader({
    "@/lib/middleware/ownerCheck": { requireOwner: async () => ({ isOwner: !options.unauthorized, userId: "owner" }) },
    "@/lib/storageUtils": {
      calculateUserStorageUsage: async () => { throw new Error("private storage details") },
      formatStorageSize: bytes => `${bytes} bytes`
    },
    "@/lib/prisma": { prisma: {
      user: {
        findUnique: async () => { reads.push("user"); return options.missing ? null : { id: "target", isOwner: !!options.isOwner } },
        update: async ({ data }) => {
          if (options.failUpdate) throw new Error("private update details")
          writes.push(data)
          return { id: "target", email: "target@example.invalid", ...data }
        }
      },
      canvas: { count: async () => 0, findMany: async () => [] },
      node: { count: async () => 0 }, media: { count: async () => 0 }
    } }
  })(storagePath)
  return { route, reads, writes }
}

const storageContext = () => ({ params: Promise.resolve({ id: "target" }) })

test("storage PATCH rejects missing, coerced, fractional and out-of-range limits before database access", async () => {
  const bodies = [{}, ...[
    "", "1", "12bytes", "1.5", "2147483648", true, false, [], [1], {},
    0, -1, -0, 0.1, 1.5, 2147483647.5, 2147483648, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE
  ].map(storageLimitBytes => ({ storageLimitBytes }))]
  for (const body of bodies) {
    const fixture = storageFixture()
    const response = await fixture.route.PATCH(request(body, "PATCH"), storageContext())
    assert.equal(response.status, 400, JSON.stringify(body))
    assert.deepEqual(fixture.reads, [])
    assert.deepEqual(fixture.writes, [])
  }
})

test("storage PATCH normalizes malformed bounded JSON errors without writes", async () => {
  for (const body of ["{", "[]", "null", "1", '{"storageLimitBytes":12tail}', '{"storageLimitBytes":NaN}', '{"storageLimitBytes":1e400}', '{"storageLimitBytes":9007199254740993}']) {
    const fixture = storageFixture()
    const response = await fixture.route.PATCH(new Request("http://fixture.invalid", { method: "PATCH", headers: { "Content-Type": "application/json" }, body }), storageContext())
    assert.equal(response.status, 400, body)
    assert.deepEqual(fixture.reads, [])
    assert.deepEqual(fixture.writes, [])
  }
  for (const declared of [false, true]) {
    const fixture = storageFixture()
    const response = await fixture.route.PATCH(new Request("http://fixture.invalid", {
      method: "PATCH", body: declared ? "{}" : " ".repeat(65537),
      headers: { "Content-Type": "application/json", ...(declared ? { "content-length": "65537" } : {}) }
    }), storageContext())
    assert.equal(response.status, 413)
    assert.deepEqual(fixture.reads, [])
    assert.deepEqual(fixture.writes, [])
  }
})

test("storage PATCH accepts null and exact supported positive integer boundaries", async () => {
  for (const storageLimitBytes of [null, 1, 1024, 2147483647]) {
    const fixture = storageFixture()
    const response = await fixture.route.PATCH(request({ storageLimitBytes }, "PATCH"), storageContext())
    assert.equal(response.status, 200)
    assert.equal((await response.json()).user.storageLimitBytes, storageLimitBytes)
    assert.deepEqual(fixture.writes, [{ storageLimitBytes }])
  }
})

test("storage PATCH preserves owner unlimited policy, authorization and missing-user checks", async () => {
  for (const [options, storageLimitBytes, status] of [
    [{ isOwner: true }, 1, 400], [{ isOwner: true }, null, 200],
    [{ unauthorized: true }, null, 401], [{ missing: true }, 1, 404]
  ]) {
    const fixture = storageFixture(options)
    assert.equal((await fixture.route.PATCH(request({ storageLimitBytes }, "PATCH"), storageContext())).status, status)
    assert.deepEqual(fixture.writes, status === 200 ? [{ storageLimitBytes: null }] : [])
  }
})

test("storage GET and PATCH return generic errors and log only structured events", async context => {
  const logs = []
  context.mock.method(console, "error", (...args) => logs.push(args))
  const fixture = storageFixture()
  const get = await fixture.route.GET(request({}, "POST"), storageContext())
  assert.equal(get.status, 500)
  assert.equal((await get.json()).error, "Internal server error")
  const patch = await storageFixture({ failUpdate: true }).route.PATCH(request({ storageLimitBytes: 1 }, "PATCH"), storageContext())
  assert.equal(patch.status, 500)
  assert.equal((await patch.json()).error, "Internal server error")
  assert.deepEqual(logs, [[{ event: "user_storage_fetch_failed" }], [{ event: "user_storage_update_failed" }]])
})

test("native disposable SQLite preserves owner data, rolls back conflicts and supports allowed deletions", async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "llm-canvas-owner-test-"))
  let prisma
  context.after(async () => {
    if (prisma) await prisma.$disconnect()
    await fs.rm(directory, { recursive: true, force: true })
  })
  const url = `file:${directory}/fixture.db`
  const schemaPath = path.join(directory, "schema.prisma")
  const schema = (await fs.readFile("prisma/schema.prisma", "utf8")).replace(/datasource db \{[\s\S]*?\}/, `datasource db {\n  provider = "sqlite"\n  url = "${url}"\n}`)
  await fs.writeFile(schemaPath, schema)
  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", schemaPath, "--skip-generate"], {
    stdio: "pipe", timeout: 30000, env: { ...process.env, DATABASE_URL: url }
  })
  prisma = new PrismaClient({ datasources: { db: { url } } })
  const hash = await bcrypt.hash(password, 4)
  for (const id of ["owner", "invited"]) {
    await prisma.user.create({ data: {
      id, email: `${id}@example.invalid`, isOwner: id === "owner", passwordHash: hash,
      settings: { create: { providers: {} } },
      accounts: { create: { type: "credentials", provider: "fixture", providerAccountId: id } },
      sessions: { create: { sessionToken: `session-${id}`, expires: new Date("2030-01-01") } },
      canvases: { create: {
        id: `canvas-${id}`, title: id,
        nodes: { create: { id: `node-${id}`, type: "text", position: { x: 0, y: 0 }, data: {} } },
        media: { create: { filename: "fixture.txt", filePath: `/fixture/${id}.txt`, mimeType: "text/plain", fileSize: 7 } },
        tokenUsage: { create: { operator: "fixture", modelName: "fixture", totalTokens: 3 } }
      } }
    } })
  }
  await prisma.inviteCode.create({ data: { code: "fixture-invite", createdBy: "owner", usedBy: "invited" } })
  const models = ["user", "account", "session", "canvas", "node", "media", "userSettings", "inviteCode", "tokenUsage"]
  const snapshot = async () => Object.fromEntries(await Promise.all(models.map(async model => [model, await prisma[model].findMany({ orderBy: { id: "asc" } })])))
  let currentUser = "owner"
  const cleanups = []
  const loadRoute = (client = prisma) => createLoader({
    "@/lib/prisma": { prisma: client },
    "@/lib/auth": { auth: async () => ({ user: { id: currentUser } }) },
    "@/lib/authHardening": authOverrides,
    "@/lib/safeMedia": { cleanupCanvasMedia: async id => { cleanups.push(id) } }
  })(accountPath)
  const route = loadRoute()
  const deleteRequest = (value = password) => request({ email: `${currentUser}@example.invalid`, password: value })

  const before = await snapshot()
  assert.equal((await route.DELETE(deleteRequest())).status, 409)
  assert.deepEqual(await snapshot(), before)
  assert.deepEqual(cleanups, [])

  const storage = createLoader({
    "@/lib/prisma": { prisma },
    "@/lib/middleware/ownerCheck": { requireOwner: async () => ({ isOwner: true, userId: "owner" }) },
    "@/lib/storageUtils": { formatStorageSize: bytes => `${bytes} bytes` }
  })(storagePath)
  const invitedContext = () => ({ params: Promise.resolve({ id: "invited" }) })
  for (const body of [{}, { storageLimitBytes: "12bytes" }, { storageLimitBytes: 1.5 }, { storageLimitBytes: 2147483648 }]) {
    assert.equal((await storage.PATCH(request(body, "PATCH"), invitedContext())).status, 400)
    assert.deepEqual(await snapshot(), before)
  }
  for (const storageLimitBytes of [1, 2147483647, null]) {
    assert.equal((await storage.PATCH(request({ storageLimitBytes }, "PATCH"), invitedContext())).status, 200)
    assert.equal((await prisma.user.findUnique({ where: { id: "invited" } })).storageLimitBytes, storageLimitBytes)
  }
  const beforeInvitedDeletion = await snapshot()

  currentUser = "invited"
  assert.equal((await route.DELETE(deleteRequest("wrong-password"))).status, 400)
  assert.deepEqual(await snapshot(), beforeInvitedDeletion)
  const conflictRoute = loadRoute({
    user: prisma.user,
    $transaction: (callback, options) => prisma.$transaction(tx => callback(new Proxy(tx, {
      get(target, name) {
        if (name !== "user") return target[name]
        return new Proxy(target.user, {
          get(delegate, operation) {
            if (operation !== "delete") return delegate[operation]
            return async () => { throw new Prisma.PrismaClientKnownRequestError("private write conflict", { code: "P2034", clientVersion: "test" }) }
          }
        })
      }
    })), options)
  })
  const conflict = await conflictRoute.DELETE(deleteRequest())
  assert.equal(conflict.status, 409)
  assert.ok(!(await conflict.text()).includes("private write conflict"))
  assert.deepEqual(await snapshot(), beforeInvitedDeletion)
  assert.deepEqual(cleanups, [])

  assert.equal((await route.DELETE(deleteRequest())).status, 200)
  for (const model of models.filter(model => model !== "inviteCode")) assert.equal(await prisma[model].count(), 1, model)
  assert.equal((await prisma.inviteCode.findUnique({ where: { code: "fixture-invite" } })).usedBy, null)
  assert.deepEqual(cleanups, ["canvas-invited"])

  currentUser = "owner"
  const soleOwner = await snapshot()
  assert.equal((await route.DELETE(deleteRequest("wrong-password"))).status, 400)
  assert.deepEqual(await snapshot(), soleOwner)
  assert.equal((await route.DELETE(deleteRequest())).status, 200)
  for (const model of models) assert.equal(await prisma[model].count(), 0, model)
  assert.deepEqual(cleanups, ["canvas-invited", "canvas-owner"])
})
