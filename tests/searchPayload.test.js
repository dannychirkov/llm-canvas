const test = require("node:test")
const assert = require("node:assert/strict")
const { createLoader } = require("./loadSource")

test("search pages project canonical content fields without loading debug or stale Node rows", async () => {
  const queries = []
  const prisma = {
    $queryRaw: async query => { queries.push(query); return [{ id: "current", type: "notes", notes: "Canonical notes", truncated: 0, rawResponse: "must not leave server" }] },
    canvas: { findMany: async query => { assert.equal(query.take, 2); assert.equal(query.select.content, undefined); return [{ id: "first", title: "First" }, { id: "next", title: "Next" }] } }
  }
  const load = createLoader({ "@/lib/prisma": { prisma }, "@/lib/auth": { auth: async () => ({ user: { id: "owner" } }) } })
  const response = await load("src/app/api/search/route.ts").GET(new Request("http://fixture/api/search?limit=1"))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("X-Next-Cursor"), "first")
  const page = await response.json()
  assert.equal(page.length, 1)
  assert.equal(page[0].nodes[0].data.notes, "Canonical notes")
  assert.equal(page[0].nodes[0].data.rawResponse, undefined)
  assert.ok(queries[0].sql.includes("json_each"))
  assert.ok(!queries[0].sql.includes("rawResponse"))
})

test("search projection reports oversized text truncation instead of silently passing unbounded data", async () => {
  const load = createLoader({ "@/lib/prisma": { prisma: { $queryRaw: async () => [{ id: "large", type: "text", textContent: "large preview", truncated: 1 }] } } })
  const result = await load("src/lib/searchPayload.ts").searchableCanvasNodes("canvas", "owner")
  assert.equal(result.searchTruncated, true)
})

test("canonical search SQL runs on native SQLite and never selects large debug payloads", async context => {
  const { DatabaseSync } = require("node:sqlite")
  const database = new DatabaseSync(":memory:")
  context.after(() => database.close())
  database.exec("CREATE TABLE canvases (id TEXT, userId TEXT, content TEXT)")
  database.prepare("INSERT INTO canvases VALUES (?, ?, ?)").run("owned", "owner", JSON.stringify({ nodes: [{ id: "node", type: "text", data: { textContent: "Canonical", notes: "Search notes", debugInfo: { raw: "x".repeat(2000000) } } }], edges: [] }))
  const load = createLoader({ "@/lib/prisma": { prisma: { $queryRaw: async query => database.prepare(query.sql).all(...query.values) } } })
  const { searchableCanvasNodes } = load("src/lib/searchPayload.ts")
  const result = await searchableCanvasNodes("owned", "owner")
  assert.equal(result.nodes[0].data.notes, "Search notes")
  assert.ok(JSON.stringify(result).length < 1000)
  assert.deepEqual((await searchableCanvasNodes("owned", "other")).nodes, [])
})
