const test = require("node:test")
const assert = require("node:assert/strict")
const { join } = require("node:path")
const { createLoader } = require("./loadSource")

const canvasId = "video-fixture"
const filePath = `/uploads/canvases/${canvasId}/video.mp4`
const framePath = `/uploads/canvases/${canvasId}/frame.jpg`
const fullPath = relative => join(process.cwd(), "public", relative.replace(/^\//, ""))
const bytes = Buffer.from("synthetic video bytes")
const frameBytes = Buffer.from("synthetic frame bytes")
const frame = { path: framePath, mimeType: "image/jpeg", width: 640, height: 360, timestampMs: 1200 }
const video = overrides => ({ mediaId: "video-media", canvasId, filePath, mimeType: "video/mp4", fileSize: bytes.length, durationMs: 2000, frames: [frame], ...overrides })
const LARGE_SIZE = 20 * 1024 * 1024
const secret = "fixture-secret-must-not-leak"

function fixture(context, options = {}) {
  const calls = { reads: [], streams: [], uploads: [], updates: [], lookups: [] }
  const files = new Map([[fullPath(filePath), bytes], [fullPath(framePath), frameBytes]])
  const read = async path => {
    calls.reads.push(path)
    if (options.readFailure || !files.has(path)) throw new Error("ENOENT private filesystem details " + secret)
    return options.readBytes ?? files.get(path)
  }
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch")
  context.after(() => {
    if (originalFetch) Object.defineProperty(globalThis, "fetch", originalFetch)
    else delete globalThis.fetch
  })
  globalThis.fetch = async (url, request) => {
    calls.uploads.push({ url, request })
    if (options.upload) return options.upload(url, request)
    return { ok: true, json: async () => ({ file: { uri: "https://generativelanguage.googleapis.com/v1beta/files/fixture" } }) }
  }
  const load = createLoader({
    fs: {
      promises: { readFile: read },
      lstatSync: () => ({ isSymbolicLink: () => false }),
      createReadStream: path => (async function* () {
        calls.streams.push(path)
        yield await read(path)
      })()
    },
    "@/lib/prisma": { prisma: { media: {
      findUnique: async query => {
        calls.lookups.push(query)
        return options.missingMedia ? null : {
          id: "video-media", canvasId, filePath, fileSize: bytes.length,
          mimeType: "video/mp4", filename: "fixture.mp4", ...options.media
        }
      },
      update: async query => { calls.updates.push(query) }
    } } }
  })
  return { ...load("src/lib/videoAttachmentService.ts"), ...load("src/lib/apiErrors.ts"), calls }
}

async function rejectsNormalized(api, promise, message) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof api.ApiError)
    assert.equal(api.publicError(error), error.message)
    assert.match(error.message, message)
    assert.ok(!error.message.includes(secret))
    assert.ok(!error.message.includes("private filesystem"))
    assert.ok(!error.message.includes("/uploads/"))
    return true
  })
}

test("video frames retain their image bytes and metadata", async context => {
  const api = fixture(context)
  const images = await api.convertVideoFramesToImages([video()])
  assert.deepEqual(images, [{ dataUrl: `data:image/jpeg;base64,${frameBytes.toString("base64")}`, mimeType: "image/jpeg", mediaId: "video-media", timestampMs: 1200, width: 640, height: 360, filePath: framePath }])
  assert.deepEqual(api.calls.reads, [fullPath(framePath)])
  assert.equal(api.calls.uploads.length, 0)
})

for (const frames of [undefined, [], {}]) {
  test(`frame-based providers reject absent frames (${JSON.stringify(frames)})`, async context => {
    const api = fixture(context)
    await rejectsNormalized(api, api.convertVideoFramesToImages([video({ frames })]), /no extracted frames/)
    assert.equal(api.calls.uploads.length, 0)
  })
}

for (const badFrame of [null, { ...frame, path: undefined }, { ...frame, path: "/uploads/canvases/other/frame.jpg" }, { ...frame, path: "../../private" }, { ...frame, path: framePath.replace("frame.jpg", "missing.jpg") }, { ...frame, mimeType: "text/plain" }]) {
  test(`required frame failure rejects the whole attachment list (${JSON.stringify(badFrame?.path)})`, async context => {
    const api = fixture(context)
    await rejectsNormalized(api, api.convertVideoFramesToImages([video({ frames: [frame, badFrame] })]), /connected video frame could not be loaded/)
    assert.equal(api.calls.uploads.length, 0)
  })
}

test("a readable video cannot mask a later video with no frames", async context => {
  const api = fixture(context)
  await rejectsNormalized(api, api.convertVideoFramesToImages([video(), video({ mediaId: "second", frames: [] })]), /no extracted frames/)
})

test("zero-byte frames are rejected", async context => {
  const api = fixture(context, { readBytes: Buffer.alloc(0) })
  await rejectsNormalized(api, api.convertVideoFramesToImages([video()]), /connected video frame could not be loaded/)
})

test("small Gemini videos preserve successful inline data without uploads", async context => {
  const api = fixture(context)
  assert.deepEqual(await api.prepareGeminiVideoParts([video()], secret), [{ inlineData: { mimeType: "video/mp4", data: bytes.toString("base64") } }])
  assert.equal(api.calls.uploads.length, 0)
})

test("small Gemini video read failures reject before any provider request", async context => {
  const api = fixture(context, { readFailure: true })
  await rejectsNormalized(api, api.prepareGeminiVideoParts([video()], secret), /connected video could not be loaded/)
  assert.equal(api.calls.uploads.length, 0)
})

test("truncated small Gemini videos are rejected", async context => {
  const api = fixture(context)
  await rejectsNormalized(api, api.prepareGeminiVideoParts([video({ fileSize: bytes.length + 1 })], secret), /connected video could not be loaded/)
})

test("large Gemini upload rejection is normalized without reading the provider body", async context => {
  let bodyReads = 0
  const api = fixture(context, { upload: async () => ({ ok: false, status: 403, text: async () => { bodyReads++; return secret } }) })
  await rejectsNormalized(api, api.prepareGeminiVideoParts([video({ fileSize: LARGE_SIZE })], secret), /could not be prepared for Gemini/)
  assert.equal(api.calls.uploads.length, 1)
  assert.equal(bodyReads, 0)
  assert.equal(api.calls.updates.length, 0)
})

for (const upload of [
  async () => { throw new Error("Provider transport error " + secret) },
  async () => ({ ok: true, json: async () => { throw new Error("Invalid provider JSON " + secret) } }),
  async () => ({ ok: true, json: async () => ({ error: secret }) })
]) {
  test("Gemini upload transport, JSON and missing-URI failures stay normalized", async context => {
    const api = fixture(context, { upload })
    await rejectsNormalized(api, api.ensureGeminiVideoFiles([video()], secret), /could not be prepared for Gemini/)
    assert.equal(api.calls.updates.length, 0)
  })
}

test("missing large-video metadata and bytes reject instead of dropping the attachment", async context => {
  const api = fixture(context, { missingMedia: true })
  await rejectsNormalized(api, api.ensureGeminiVideoFiles([video()], secret), /could not be prepared for Gemini/)
  assert.equal(api.calls.uploads.length, 0)
})

test("large-video read failures reject before upload", async context => {
  const api = fixture(context, { readFailure: true, media: { fileSize: LARGE_SIZE } })
  await rejectsNormalized(api, api.prepareGeminiVideoParts([video({ fileSize: LARGE_SIZE })], secret), /could not be prepared for Gemini/)
  assert.deepEqual(api.calls.streams, [fullPath(filePath)])
  assert.equal(api.calls.uploads.length, 0)
})

test("missing video IDs reject instead of being deduplicated away", async context => {
  const api = fixture(context)
  await rejectsNormalized(api, api.ensureGeminiVideoFiles([video({ mediaId: "" })], secret), /connected video could not be loaded/)
  assert.equal(api.calls.uploads.length, 0)
})

test("valid cached Gemini files are reused without disk reads or uploads", async context => {
  const uri = "https://generativelanguage.googleapis.com/v1beta/files/cached"
  const api = fixture(context, { readFailure: true, media: { geminiFileUri: " " + uri + " ", geminiUploadedAt: new Date() } })
  const attachment = video({ fileSize: LARGE_SIZE })
  assert.deepEqual(await api.prepareGeminiVideoParts([attachment, attachment], secret), [{ fileData: { fileUri: uri, mimeType: "video/mp4" } }])
  assert.equal(api.calls.reads.length, 0)
  assert.equal(api.calls.uploads.length, 0)
  assert.equal(api.calls.updates.length, 0)
})

test("successful uploads return the URI, persist the cache and release the upload lock", async context => {
  let attempts = 0
  const api = fixture(context, { upload: async () => {
    attempts++
    if (attempts === 1) throw new Error(secret)
    return { ok: true, json: async () => ({ file: { uri: "https://generativelanguage.googleapis.com/v1beta/files/new" } }) }
  } })
  await rejectsNormalized(api, api.ensureGeminiVideoFiles([video()], secret), /could not be prepared for Gemini/)
  const refs = await api.ensureGeminiVideoFiles([video(), video()], secret)
  assert.deepEqual(refs, [{ mediaId: "video-media", fileUri: "https://generativelanguage.googleapis.com/v1beta/files/new", mimeType: "video/mp4" }])
  assert.equal(attempts, 2)
  assert.equal(api.calls.updates.length, 1)
  assert.equal(api.calls.updates[0].data.geminiFileUri, refs[0].fileUri)
})
