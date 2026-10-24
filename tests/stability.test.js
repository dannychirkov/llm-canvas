const test = require("node:test")
const assert = require("node:assert/strict")
const { createLoader } = require("./loadSource")

const credentials = {
  requireUserId: async () => "fixture-user",
  savedProviderKey: async () => "SYNTHETIC_SERVER_KEY",
  requireCanvasAccess: async () => {},
  requireVideoAccess: async () => {}
}

function request(body) {
  return new Request("http://localhost/api/fixture", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  })
}

for (const streamed of [false, true]) {
  for (const strategy of ["single", "map-reduce", "refine"]) {
    test(`${streamed ? "streamed" : "nonstream"} ${strategy} summary counts every provider request`, async () => {
      let calls = 0
      const smart = createLoader()("src/lib/smartSummarizer.ts")
      const route = createLoader({
        "@/lib/providerCredentials": credentials,
        "@/lib/providers/customStore": {},
        "@/lib/providers/customSummary": {},
        "@/lib/smartSummarizer": { ...smart, getContextWindow: () => 1024, determineStrategy: () => strategy },
        "@/lib/providerContext": { getDynamicContextWindow: async () => 1024 },
        "@/lib/providerRequest": {
          withProviderSignal: (signal, callback) => callback(),
          providerFetch: async () => {
            calls++
            return Response.json({ choices: [{ message: { content: "summary" } }], usage: { total_tokens: 11 }, candidates: [{ content: { parts: [{ text: "summary" }] } }], usageMetadata: { totalTokenCount: 11, promptTokenCount: 7, candidatesTokenCount: 4 } })
          }
        }
      })(`src/app/api/canvas/smart-summarizer${streamed ? "-stream" : ""}/route.ts`)
      const response = await route.POST(request({ provider: strategy === "single" ? "gemini" : "openai", modelName: "fixture", text: "context ".repeat(300), summaryStyle: "preserve-details" }))
      assert.equal(response.status, 200)
      const result = streamed
        ? (await response.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6))).find(event => event.type === "done")
        : await response.json()
      assert.ok(result, "Summary did not complete")
      assert.equal(result.tokens, calls * 11)
      assert.equal(result.strategy, strategy)
      assert.ok(strategy === "single" ? calls === 1 : calls > 1)
    })
  }
}

test("generated image returns the persisted media ID", async () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aTZkAAAAASUVORK5CYII="
  let saved
  const media = createLoader({ "@/lib/prisma": { prisma: {} } })("src/lib/generatedMedia.ts")
  const route = createLoader({
    "@/lib/providerCredentials": credentials,
    "@/lib/providers/customStore": {},
    "@/lib/providers/customChat": {},
    "@/lib/videoAttachmentService": {},
    "@/lib/generatedMedia": { ...media, saveGeneratedImages: async (images, owner) => {
      assert.equal(images[0].data, png)
      const raster = media.decodeGeneratedRaster(images[0])
      saved = owner
      return [{ url: "/uploads/canvases/fixture-canvas/generated.png", mediaId: "db-media-id", width: raster.width, height: raster.height }]
    } },
    "@/lib/executionUsage": { executionRequestBody: req => req.json(), withExecutionAccounting: (req, execute) => execute(req) },
    "@/lib/usageObservation": { observeProviderUsage: async () => {} },
    "@/lib/providerRequest": {
      withProviderSignal: (signal, callback) => callback(),
      providerFetch: async () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png } }] } }] })
    }
  })("src/app/api/canvas/execute-node/route.ts")
  const response = await route.POST(request({ provider: "nanobanana", canvasId: "fixture-canvas", finalPrompt: "fixture" }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).generatedImage.mediaId, "db-media-id")
  assert.equal(saved.canvasId, "fixture-canvas")
  assert.equal(saved.userId, "fixture-user")
})

test("encryption retains the existing AES-GCM payload format", async () => {
  const { encryptString, decryptString } = createLoader()("src/lib/crypto.ts")
  const { webcrypto } = require("node:crypto")
  const secret = process.env.AUTH_SECRET || "fallback-secret-for-development"
  const hash = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(secret))
  const key = await webcrypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"])
  const iv = new Uint8Array(12).fill(3)
  const encrypted = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("legacy fixture"))
  const legacy = Buffer.concat([Buffer.from(iv), Buffer.from(encrypted)]).toString("base64")
  assert.equal(await decryptString(legacy), "legacy fixture")
  const current = Buffer.from(await encryptString("current fixture"), "base64")
  const plain = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: current.subarray(0, 12) }, key, current.subarray(12))
  assert.equal(new TextDecoder().decode(plain), "current fixture")
})
