const test = require("node:test")
const assert = require("node:assert/strict")
const { createLoader } = require("./loadSource")
const { saveNotes } = createLoader()("src/lib/notesClient.ts")

test("notes client retries an unrelated canvas revision change with the fresh stamp", async () => {
  const originalFetch = global.fetch
  const calls = []
  global.fetch = async (url, options) => {
    calls.push({ url, ...options })
    if (calls.length === 1) return Response.json({ error: "conflict" }, { status: 409 })
    if (calls.length === 2) return Response.json({ notes: "original", updatedAt: "2026-01-02T00:00:00.000Z" })
    return Response.json({ notes: "draft", baseUpdatedAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" })
  }
  try {
    const saved = await saveNotes("node", "canvas", "draft", { notes: "original", updatedAt: "2026-01-01T00:00:00.000Z" })
    assert.equal(saved.notes, "draft")
    assert.equal(saved.baseUpdatedAt, "2026-01-02T00:00:00.000Z")
    assert.equal(JSON.parse(calls[0].body).expectedUpdatedAt, "2026-01-01T00:00:00.000Z")
    assert.equal(JSON.parse(calls[2].body).expectedUpdatedAt, "2026-01-02T00:00:00.000Z")
  } finally { global.fetch = originalFetch }
})

test("notes client refuses to overwrite changed notes and preserves the caller draft", async () => {
  const originalFetch = global.fetch
  let calls = 0
  global.fetch = async () => ++calls === 1 ? Response.json({}, { status: 409 }) : Response.json({ notes: "another tab", updatedAt: "new" })
  try {
    await assert.rejects(saveNotes("node", "canvas", "draft", { notes: "original", updatedAt: "old" }), /draft is preserved/)
    assert.equal(calls, 2)
  } finally { global.fetch = originalFetch }
})

test("notes client surfaces non-conflict save failures", async () => {
  const originalFetch = global.fetch
  global.fetch = async () => Response.json({}, { status: 500 })
  try { await assert.rejects(saveNotes("node", "canvas", "draft", { notes: "original", updatedAt: "old" }), /Unable to save notes/) } finally { global.fetch = originalFetch }
})
