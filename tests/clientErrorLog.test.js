const test = require("node:test")
const assert = require("node:assert/strict")
const { NextRequest } = require("next/server")
const { createLoader } = require("./loadSource")

function fixture(context, enabled = true) {
  const names = ["NODE_ENV", "AUTH_URL", "NEXT_PUBLIC_APP_URL", "ENABLE_CLIENT_ERROR_LOGS", "ERROR_LOG_API_SECRET"]
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  context.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
  process.env.NODE_ENV = "production"
  process.env.AUTH_URL = "https://fixture.example"
  delete process.env.NEXT_PUBLIC_APP_URL
  delete process.env.ERROR_LOG_API_SECRET
  if (enabled) process.env.ENABLE_CLIENT_ERROR_LOGS = "true"
  else delete process.env.ENABLE_CLIENT_ERROR_LOGS
  const logs = []
  context.mock.method(console, "error", (...args) => logs.push(args))
  // The real limiter remains active; its periodic housekeeping is unnecessary in a short fixture.
  const interval = global.setInterval
  let route
  global.setInterval = () => ({})
  try { route = createLoader()("src/app/api/error-log/route.ts") } finally { global.setInterval = interval }
  function request(body, headers = {}) {
    return new NextRequest("https://fixture.example/api/error-log", {
      method: "POST", headers: { origin: "https://fixture.example", "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  }
  return { route, logs, request }
}

test("client error ingestion is disabled by default without reading or logging payloads", async context => {
  const f = fixture(context, false)
  const request = f.request({ message: "x".repeat(20000) })
  const response = await f.route.POST(request)
  assert.equal(response.status, 204)
  assert.equal(await response.text(), "")
  assert.equal(request.bodyUsed, false)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(f.logs.length, 0)
})

test("enabled ingestion measures actual bytes without trusting Content-Length", async context => {
  const f = fixture(context)
  const request = f.request({ message: "x".repeat(20000) })
  assert.equal(request.headers.get("content-length"), null)
  assert.equal((await f.route.POST(request)).status, 413)
  assert.equal((await f.route.POST(f.request("{"))).status, 400)
  assert.equal((await f.route.POST(f.request({ message: {} }))).status, 400)
  assert.equal(f.logs.length, 0)
})

test("forwarded IP rotation cannot bypass the global client log admission limit", async context => {
  const f = fixture(context)
  for (let index = 0; index < 10; index++) {
    assert.equal((await f.route.POST(f.request({ message: "fixture" }, { "x-forwarded-for": `fixture-${index}` }))).status, 200)
  }
  const blocked = await f.route.POST(f.request({ message: "fixture" }, { "x-forwarded-for": "another-fixture", "x-real-ip": "another-real-fixture" }))
  assert.equal(blocked.status, 429)
  assert.equal(blocked.headers.get("retry-after"), "60")
  assert.equal(f.logs.length, 10)
})

test("enabled logs clip allowlisted fields and redact credentials and URL parameters", async context => {
  const f = fixture(context)
  const response = await f.route.POST(f.request({
    name: "N".repeat(300), message: 'Authorization: Bearer SYNTHETIC_CREDENTIAL apiKey="SYNTHETIC_API_KEY" password=SYNTHETIC_PASSWORD ' + "M".repeat(1200),
    stack: "https://user:pass@fixture.example/failed?token=SYNTHETIC_QUERY#secret\n" + "S".repeat(2300),
    digest: "D".repeat(300), userAgent: "U".repeat(300),
    url: "https://user:pass@fixture.example/path?key=SYNTHETIC_URL#fragment",
    extra: { apiKey: "SYNTHETIC_EXTRA" }, timestamp: "untrusted timestamp",
  }))
  assert.equal(response.status, 200)
  assert.equal(f.logs.length, 1)
  const logged = f.logs[0][1]
  for (const [key, limit] of [["name", 128], ["message", 1024], ["stack", 2048], ["digest", 128], ["userAgent", 256]]) assert.ok(logged[key].length <= limit)
  assert.equal(logged.url, "https://fixture.example/path")
  assert.notEqual(logged.timestamp, "untrusted timestamp")
  assert.ok(!JSON.stringify(logged).includes("SYNTHETIC_"))
  assert.ok(!JSON.stringify(logged).includes("user:pass"))
  assert.equal(logged.extra, undefined)
})

test("enabled ingestion rejects a browser from a foreign origin before reading the body", async context => {
  const f = fixture(context)
  const request = f.request({ message: "fixture" }, { origin: "https://foreign.example" })
  assert.equal((await f.route.POST(request)).status, 403)
  assert.equal(request.bodyUsed, false)
  assert.equal(f.logs.length, 0)
})

test("redaction expansion cannot exceed the final log field budget", async context => {
  const f = fixture(context)
  assert.equal((await f.route.POST(f.request({ message: "password=a ".repeat(110) }))).status, 200)
  const message = f.logs[0][1].message
  assert.ok(message.length <= 1024)
  assert.ok(!message.includes("password=a"))
})
