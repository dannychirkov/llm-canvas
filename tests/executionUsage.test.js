const test = require("node:test")
const assert = require("node:assert/strict")
const { createLoader } = require("./loadSource")

function fixture(initial = null) {
  const state = { total: initial, userTotal: 0, records: new Map(), updatedAt: new Date("2026-01-01") }
  const transaction = {
    canvas: {
      findFirst: async ({ where }) => where.userId === "owner" ? { id: "canvas", totalTokensUsed: state.total, updatedAt: state.updatedAt } : null,
      findUnique: async () => ({ totalTokensUsed: state.total }),
      updateMany: async ({ data }) => { if (state.total === null) state.total = data.totalTokensUsed; return { count: 1 } },
      update: async ({ data }) => { state.total += data.totalTokensUsed.increment; assert.equal(data.updatedAt, state.updatedAt); return { totalTokensUsed: state.total } }
    },
    tokenUsage: {
      findMany: async () => [...state.records.values()],
      findUnique: async ({ where }) => state.records.get(where.id),
      findFirst: async ({ where }) => state.records.get(where.id),
      aggregate: async () => ({ _sum: { totalTokens: [...state.records.values()].reduce((total, row) => total + (row.totalTokens ?? 0), 0) } }),
      create: async ({ data }) => { state.records.set(data.id, structuredClone(data)); return data }
    },
    user: { update: async ({ data }) => { state.userTotal += data.totalTokensCreated.increment; return {} } }
  }
  const load = createLoader({
    "@/lib/auth": { auth: async () => ({ user: { id: "owner" } }) },
    "@/lib/prisma": { prisma: { ...transaction, $transaction: callback => callback(transaction) } },
    "@/lib/providerCredentials": { requireUserId: async () => "owner", requireCanvasAccess: async () => {} }
  })
  return { state, load, usage: load("src/lib/executionUsage.ts") }
}

function request() {
  return new Request("http://fixture/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "custom", canvasId: "canvas", modelName: "fixture", finalPrompt: "Question", tokens: 999999 }) })
}

const output = { tokens: 170, tokenBreakdown: { inputTokens: 128, outputTokens: 42, cachedTokens: 80, reasoningTokens: 20 }, usageSource: "provider", responseText: "Answer" }

test("server persists actual usage without a client accounting request and initializes nullable counters", async () => {
  const setup = fixture()
  const response = await setup.usage.withExecutionAccounting(request(), async () => Response.json(output))
  const result = await response.json()
  assert.equal(result.tokens, 170)
  assert.equal(result.canvasTotalTokensUsed, 170)
  assert.equal(setup.state.userTotal, 170)
  assert.equal(setup.state.records.size, 1)
  assert.equal([...setup.state.records.values()][0].otherTools, 0)
  assert.equal([...setup.state.records.values()][0].usageSource, "provider")
})

test("history accepts new UUID canvas IDs as well as legacy CUIDs", async () => {
  const setup = fixture(0)
  const normalized = setup.usage.normalizeExecutionUsage({ provider: "custom" }, output)
  await setup.usage.recordExecutionUsage("owner", "canvas", "receipt", "custom", "fixture", normalized)
  const route = setup.load("src/app/api/canvas/[id]/token-statistics/route.ts")
  for (const id of ["355b769a-cbab-44fa-84f9-5dfc50e8998f", "cmgonp4x00001parentfixture"]) {
    const response = await route.GET(new Request("http://fixture/api"), { params: Promise.resolve({ id }) })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).custom.models.fixture.total, 170)
  }
  assert.equal((await route.GET(new Request("http://fixture/api"), { params: Promise.resolve({ id: "../foreign" }) })).status, 400)
})

test("nullable historical counters initialize from the existing ledger without charging history again", async () => {
  const setup = fixture()
  setup.state.records.set("legacy", { id: "legacy", canvasId: "canvas", totalTokens: 50 })
  const response = await setup.usage.withExecutionAccounting(request(), async () => Response.json(output))
  assert.equal((await response.json()).canvasTotalTokensUsed, 220)
  assert.equal(setup.state.userTotal, 170)
  assert.equal(setup.state.records.size, 2)
})

test("server receipt is idempotent and client acknowledgements cannot add forged usage", async () => {
  const setup = fixture(0)
  const normalized = setup.usage.normalizeExecutionUsage({ provider: "custom" }, output)
  await setup.usage.recordExecutionUsage("owner", "canvas", "receipt", "custom", "fixture", normalized)
  await setup.usage.recordExecutionUsage("owner", "canvas", "receipt", "custom", "fixture", normalized)
  const route = setup.load("src/app/api/canvas/[id]/add-tokens/route.ts")
  const send = body => route.POST(new Request("http://fixture/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "canvas" }) })
  assert.equal((await send({ tokens: 99999 })).status, 400)
  assert.equal((await send({ executionId: "receipt", tokens: 99999 })).status, 200)
  assert.equal((await send({ executionId: "receipt", tokens: 99999 })).status, 200)
  assert.equal((await send({ executionId: "missing" })).status, 404)
  assert.equal(setup.state.total, 170)
  assert.equal(setup.state.records.size, 1)
})

test("duplicate final stream events record only one execution", async () => {
  const setup = fixture(0)
  const frame = "data: " + JSON.stringify({ done: true, ...output }) + "\n\n"
  const response = await setup.usage.withExecutionAccounting(request(), async () => new Response(frame + frame, { headers: { "Content-Type": "text/event-stream" } }))
  const text = await response.text()
  assert.equal(text.match(/"done":true/g).length, 1)
  assert.equal(setup.state.total, 170)
  assert.equal(setup.state.records.size, 1)
})

test("partial EOF is an error, not a successful unreported execution", async () => {
  const setup = fixture(0)
  const response = await setup.usage.withExecutionAccounting(request(), async () => new Response('data: {"content":"partial"}\n\n', { headers: { "Content-Type": "text/event-stream" } }))
  const text = await response.text()
  assert.ok(text.includes("ended before completion"))
  assert.ok(!text.includes('"done":true'))
  assert.equal(setup.state.records.size, 0)
})

test("summary steps remain counted when a later provider call fails", async () => {
  const setup = fixture(0)
  const response = await setup.usage.withExecutionAccounting(request(), async () => {
    await setup.usage.observeProviderUsage(output, "First map prompt")
    await setup.usage.observeProviderUsage(output, "Second map prompt")
    throw new Error("Provider failed on reduce")
  })
  const result = await response.json()
  assert.equal(response.status, 502)
  assert.equal(result.partialUsageTokens, 340)
  assert.equal(setup.state.total, 340)
  assert.equal(setup.state.records.size, 2)
})

test("observed summary steps are not counted again by the final aggregate", async () => {
  const setup = fixture(0)
  const response = await setup.usage.withExecutionAccounting(request(), async () => {
    await setup.usage.observeProviderUsage(output)
    await setup.usage.observeProviderUsage(output)
    return Response.json({ ...output, tokens: 340, strategy: "map-reduce" })
  })
  const result = await response.json()
  assert.equal(result.tokens, 340)
  assert.equal(result.canvasTotalTokensUsed, 340)
  assert.equal(setup.state.records.size, 2)
})

test("unknown and estimated usage are not mislabeled as exact provider billing", () => {
  const { normalizeExecutionUsage } = fixture().usage
  assert.equal(normalizeExecutionUsage({ provider: "custom", finalPrompt: "input" }, { responseText: "answer" }).usageSource, "estimated")
  assert.equal(normalizeExecutionUsage({ provider: "custom" }, { tokens: 0, usageSource: "unreported" }).usageSource, "unreported")
  assert.equal(normalizeExecutionUsage({ provider: "custom" }, { tokens: 512, usageSource: "estimated", responseText: "answer" }).tokens, 512)
  assert.equal(normalizeExecutionUsage({ provider: "custom" }, { rawResponse: '{"usage":{}}', usageSource: "unreported" }).usageSource, "unreported")
  assert.equal(normalizeExecutionUsage({ provider: "custom" }, { rawResponse: '{"usage":{"total_tokens":0}}' }).usageSource, "provider")
})

test("bounded map-reduce never sends an over-budget reduce prompt", async () => {
  const prompts = []
  const { boundedSummary } = createLoader()("src/lib/providers/boundedSummary.ts")
  const result = await boundedSummary({ text: "a".repeat(5000), modelName: "fixture", summaryStyle: "preserve-details" }, 1024, async (prompt, maxOutput) => {
    prompts.push(prompt)
    assert.ok(Math.ceil(prompt.length / 4) + maxOutput + 32 <= 1024)
    return { responseText: "s".repeat(700), tokens: 11, usageSource: "provider" }
  })
  assert.ok(prompts.length > 2)
  assert.equal(result.tokens, prompts.length * 11)
})


test("accounting consumes execution JSON once and adapters reuse the same parsed request", async () => {
  const setup = fixture()
  const input = request()
  const response = await setup.usage.withExecutionAccounting(input, async current => {
    assert.equal(current.bodyUsed, true)
    const first = await setup.usage.executionRequestBody(current)
    assert.equal(first.finalPrompt, "Question")
    assert.equal(await setup.usage.executionRequestBody(current), first)
    return Response.json(output)
  })
  assert.equal(response.status, 200)
  await assert.rejects(setup.usage.executionRequestBody(input), error => error.status === 400)
})

test("execution overflow rejects before provider work and releases its admission slot", async () => {
  const setup = fixture()
  let providerCalls = 0
  const input = new Request("http://fixture/api", { method: "POST", headers: { "Content-Length": String(128 * 1024 * 1024 + 1) }, body: "{}" })
  const response = await setup.usage.withExecutionAccounting(input, async () => { providerCalls++; return Response.json(output) })
  assert.equal(response.status, 413)
  assert.equal(providerCalls, 0)
  assert.equal(setup.state.records.size, 0)
  assert.equal((await setup.usage.withExecutionAccounting(request(), async () => Response.json(output))).status, 200)
})
