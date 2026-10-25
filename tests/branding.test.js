const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createHash } = require('node:crypto')
const { createRequire } = require('node:module')
const sharp = require('sharp')
const asar = require('@electron/asar')
const { getFileMatchers, copyFiles } = require('app-builder-lib/out/fileMatcher')
const { generateBrandAssets } = require('../desktop/brand-assets.cjs')
const { publishable } = require('../ops/source-release')

const root = path.resolve(__dirname, '..')
const read = name => fs.readFileSync(path.join(root, name))
const source = read('src/app/favicon.ico')
const assets = ['public/brand/icon.png', 'public/brand/apple-touch-icon.png', 'desktop/assets/icon.png', 'desktop/assets/icon.ico', 'desktop/assets/icon.icns']

function frames(ico) {
  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  return Array.from({ length: ico.readUInt16LE(4) }, (_, index) => {
    const entry = ico.subarray(6 + index * 16, 22 + index * 16)
    const start = entry.readUInt32LE(12), length = entry.readUInt32LE(8)
    assert.ok(start + length <= ico.length)
    return { entry, width: entry[0] || 256, data: ico.subarray(start, start + length) }
  })
}

// Independently unpack the existing 64px BGRA rows for pixel comparisons.
// The pinned RGBA digest also checks transparency against the reviewed favicon.
function canonicalPixels() {
  const dib = frames(source).find(frame => frame.width === 64).data
  const rows = Array.from({ length: 64 }, (_, row) => dib.subarray(40 + row * 256, 40 + (row + 1) * 256))
  const rgba = Buffer.from(Buffer.concat(rows.reverse()))
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const blue = rgba[offset]
    rgba[offset] = rgba[offset + 2]
    rgba[offset + 2] = blue
  }
  assert.equal(createHash('sha256').update(rgba).digest('hex'), 'f1edfdaac5c98ea1abaad80fb907e0ffaa29b5a203927ba44c129abc79a42aac')
  return rgba
}

async function assertPixels(png, size) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.width, size)
  assert.equal(info.height, size)
  assert.equal(info.channels, 4)
  const expected = await sharp(canonicalPixels(), { raw: { width: 64, height: 64, channels: 4 } }).resize(size, size, { kernel: 'lanczos3' }).raw().toBuffer()
  assert.deepEqual(data, expected, 'Artwork and alpha must come only from the original favicon')
  for (const pixel of [0, size - 1, size * (size - 1), size * size - 1]) assert.equal(data[pixel * 4 + 3], 0, 'Rounded corners remain transparent')
}

test('browser, Apple and desktop PNGs faithfully enlarge the unchanged canonical favicon', async () => {
  assert.equal(source.length, 34494)
  assert.equal(createHash('sha256').update(source).digest('hex'), '88305c600429436031ca72c01c47a0cb33510e8b48c90a3175ec842ea5802e56')
  assert.deepEqual(read('desktop/assets/icon.png'), read('public/brand/icon.png'))
  await assertPixels(read('public/brand/icon.png'), 512)
  await assertPixels(read('public/brand/apple-touch-icon.png'), 180)
})

test('Windows ICO retains every original DIB frame and appends a faithful 256px PNG', async () => {
  const original = frames(source), packaged = frames(read('desktop/assets/icon.ico'))
  assert.equal(original.length, 5)
  assert.equal(packaged.length, 6)
  original.forEach((frame, index) => {
    assert.deepEqual(packaged[index].entry.subarray(0, 12), frame.entry.subarray(0, 12))
    assert.deepEqual(packaged[index].data, frame.data)
  })
  assert.equal(packaged[5].width, 256)
  assert.equal((await sharp(packaged[5].data).metadata()).format, 'png')
  await assertPixels(packaged[5].data, 256)
})

test('macOS ICNS has valid native PNG chunks with canonical pixels at all four sizes', async () => {
  const icns = read('desktop/assets/icon.icns'), found = []
  assert.equal(icns.toString('ascii', 0, 4), 'icns')
  assert.equal(icns.readUInt32BE(4), icns.length)
  let offset = 8
  while (offset < icns.length) {
    const type = icns.toString('ascii', offset, offset + 4), length = icns.readUInt32BE(offset + 4)
    assert.ok(length > 8 && offset + length <= icns.length)
    const size = { ic07: 128, ic08: 256, ic09: 512, ic10: 1024 }[type]
    assert.ok(size, 'Only supported native icon chunks are present')
    const png = icns.subarray(offset + 8, offset + length)
    assert.equal((await sharp(png).metadata()).format, 'png')
    await assertPixels(png, size)
    if (size === 512) assert.deepEqual(png, read('public/brand/icon.png'))
    if (size === 256) assert.deepEqual(png, frames(read('desktop/assets/icon.ico'))[5].data)
    found.push(type)
    offset += length
  }
  assert.equal(offset, icns.length)
  assert.deepEqual(found, ['ic07', 'ic08', 'ic09', 'ic10'])
})

test('published assets regenerate byte for byte without extra desktop export paths', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-regenerate-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  await generateBrandAssets(temporary)
  for (const name of assets) {
    assert.equal(publishable(name), true, name)
    assert.deepEqual(fs.readFileSync(path.join(temporary, name)), read(name), name)
  }
  assert.equal(publishable('desktop/brand-assets.cjs'), true)
  for (const name of ['desktop/assets/private.png', 'desktop/assets/icon.png.bak', 'desktop/assets/other.ico', 'desktop/assets/nested/icon.icns']) assert.equal(publishable(name), false, name)
})

test('native packager uses staged platform icons and its real file matcher retains runtime icons inside ASAR', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-packaging-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const app = path.join(temporary, 'relocated stage', 'app'), server = path.join(temporary, 'relocated stage', 'server')
  fs.mkdirSync(app, { recursive: true })
  fs.mkdirSync(server)
  fs.cpSync(path.join(root, 'desktop'), path.join(app, 'desktop'), { recursive: true })
  fs.writeFileSync(path.join(app, 'package.json'), '{"name":"branding-fixture","main":"desktop/main.cjs"}')
  fs.writeFileSync(path.join(app, 'LICENSE'), 'fixture')

  // Capture the production config at the native builder boundary. File matching
  // and ASAR creation below use the installed packager implementations.
  const filename = path.join(root, 'desktop/package.cjs'), localRequire = createRequire(filename)
  const builder = localRequire('electron-builder'), packageModule = { exports: {} }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: packageModule, __dirname: path.dirname(filename), process,
    require: name => name === 'electron-builder' ? { ...builder, build: async options => options } : localRequire(name),
  }, { filename })
  const { config } = await packageModule.exports.packageStaged({ app, server }, path.join(temporary, 'output'), true)
  for (const [platform, name] of [['linux', 'icon.png'], ['win', 'icon.ico'], ['mac', 'icon.icns']]) {
    assert.equal(config[platform].icon, path.resolve(app, 'desktop/assets', name))
    assert.deepEqual(fs.readFileSync(config[platform].icon), read('desktop/assets/' + name))
  }
  assert.equal(config.asar, true)
  const filtered = path.join(temporary, 'filtered')
  const matchers = getFileMatchers(config, 'files', filtered, { defaultSrc: app, globalOutDir: path.join(temporary, 'output'), macroExpander: value => value, customBuildOptions: {} })
  await copyFiles(matchers)
  const archive = path.join(temporary, 'app.asar')
  await asar.createPackage(filtered, archive)
  await assertPixels(asar.extractFile(archive, 'desktop/assets/icon.png'), 512)
  assert.deepEqual(asar.extractFile(archive, 'desktop/assets/icon.ico'), read('desktop/assets/icon.ico'))
  assert.ok(asar.listPackage(archive).some(name => /desktop[\\/]main\.cjs$/.test(name)))
  assert.equal(asar.listPackage(archive).some(name => /brand-assets\.cjs|icon\.icns/.test(name)), false, 'Build-only artwork tools stay outside the runtime ASAR')
})
