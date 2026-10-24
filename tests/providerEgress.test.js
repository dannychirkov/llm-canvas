const test = require("node:test")
const assert = require("node:assert/strict")
const { createLoader } = require("./loadSource")

function fixture(isOwner) {
  return createLoader({ "@/lib/prisma": { prisma: { user: { findUnique: async () => isOwner === null ? null : { isOwner } } } } })("src/lib/providers/providerEgress.ts")
}

test("non-owner custom egress is denied by default; installation owner may use a private gateway", async () => {
  await assert.rejects(fixture(false).requireProviderEgress("user", "http://127.0.0.1:20128/v1"), error => error.status === 403)
  await fixture(true).requireProviderEgress("owner", "http://omniroute:20128/v1")
  await assert.rejects(fixture(null).requireProviderEgress("deleted", "http://omniroute:20128/v1"), error => error.status === 401)
})

test("owner egress allowlist uses exact scheme, host and port, never URL prefixes", () => {
  const { allowedProviderOrigin } = fixture(false)
  const list = "http://omniroute:20128, https://gateway.example"
  assert.ok(allowedProviderOrigin("http://omniroute:20128/v1", list))
  assert.ok(allowedProviderOrigin("https://gateway.example/api/v1", list))
  for (const value of ["http://omniroute:20129/v1", "https://omniroute:20128/v1", "https://gateway.example.evil/v1", "http://169.254.169.254/v1"]) assert.equal(allowedProviderOrigin(value, list), false)
  assert.equal(allowedProviderOrigin("http://omniroute:20128/v1", "http://omniroute:20128/v1"), false)
})

test("provider transport refuses redirects that could escape an allowed origin", async context => {
  let options
  context.mock.method(globalThis, "fetch", async (url, input) => { options = input; return new Response() })
  await createLoader()("src/lib/providerRequest.ts").providerFetch("http://fixture/v1", { redirect: "follow" })
  assert.equal(options.redirect, "error")
})
