const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const sharp = require("sharp")
const { imageSize, default: defaultImageSize } = require("image-size")
const { imageSizeFromFile } = require("image-size/fromFile")
const { createLoader } = require("./loadSource")

for (const format of ["png", "jpeg", "webp"]) {
  test(`patched image-size reads ${format} buffers through the application helper`, async () => {
    const buffer = await sharp({ create: { width: 7, height: 5, channels: 3, background: "#357abc" } })[format]().toBuffer()
    const { getImageDimensionsFromBuffer } = createLoader()("src/lib/imageUtils.ts")
    assert.deepEqual(await getImageDimensionsFromBuffer(buffer, "image/" + format), { width: 7, height: 5 })
    const dimensions = imageSize(buffer)
    assert.equal(dimensions.width, 7)
    assert.equal(dimensions.height, 5)
    assert.deepEqual(defaultImageSize(buffer), dimensions)
  })
}

test("image-size asynchronous file API preserves dimensions for video frame consumers", async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "llm-canvas-image-size-"))
  context.after(() => fs.rm(root, { recursive: true, force: true }))
  const filename = path.join(root, "frame.jpg")
  const buffer = await sharp({ create: { width: 11, height: 9, channels: 3, background: "#357abc" } }).jpeg().toBuffer()
  await fs.writeFile(filename, buffer)
  const dimensions = await imageSizeFromFile(filename)
  assert.equal(dimensions.width, 11)
  assert.equal(dimensions.height, 9)
  assert.deepEqual(dimensions, imageSize(buffer))
})

test("image dimension helper returns null for truncated and unsupported input", async context => {
  context.mock.method(console, "error", () => {})
  const { getImageDimensionsFromBuffer } = createLoader()("src/lib/imageUtils.ts")
  for (const buffer of [Buffer.alloc(0), Buffer.from([137, 80, 78, 71]), Buffer.from("not an image")]) {
    assert.equal(await getImageDimensionsFromBuffer(buffer, "image/png"), null)
  }
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: "#357abc" } }).png().toBuffer()
  assert.equal(await getImageDimensionsFromBuffer(png, "text/plain"), null)
})

test("Prisma 6 configuration loading remains compatible with the patched merge dependency", async context => {
  const { loadConfigFromFile } = require("@prisma/config")
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "llm-canvas-prisma-config-"))
  context.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(path.join(root, "prisma.config.js"), 'module.exports = { schema: "./schema.prisma", migrations: { path: "./migrations" } }')
  const result = await loadConfigFromFile({ configRoot: root })
  assert.equal(result.error, undefined)
  assert.equal(result.config.schema, path.join(root, "schema.prisma"))
})

test("patched merge handles a tiny cyclic graph without stack exhaustion", () => {
  const { createRequire } = require("node:module")
  const prismaRequire = createRequire(require.resolve("@prisma/config"))
  const { deepmerge } = prismaRequire("deepmerge-ts")
  const original = { nested: { enabled: true } }
  original.self = original
  const result = deepmerge(original, { added: 1 })
  assert.equal(result.added, 1)
  assert.equal(result.nested.enabled, true)
  assert.equal(original.added, undefined)
})

test("patched Prism grammar renders escaped code through the existing highlighter", () => {
  const React = require("react")
  const { renderToStaticMarkup } = require("react-dom/server")
  const { Prism } = require("react-syntax-highlighter")
  const html = renderToStaticMarkup(React.createElement(Prism, { language: "javascript" }, 'const value = "<img onerror=alert(1)>";'))
  assert.ok(html.includes("&lt;img"))
  assert.ok(!html.includes("<img"))
})

test("patched KaTeX renders math while rejecting inherited trust escalation", () => {
  const katex = require("katex")
  assert.ok(katex.renderToString("\\frac{1}{2}", { trust: false }).includes("katex"))
  const options = Object.assign(Object.create({ trust: true }), { throwOnError: false })
  const html = katex.renderToString("\\href{javascript:alert(1)}{unsafe}", options)
  assert.ok(!/href\s*=\s*["']javascript:/i.test(html))
})
