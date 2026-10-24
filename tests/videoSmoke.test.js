const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')

const script = path.resolve(__dirname, '../desktop/video-smoke.cjs')
const fixtureRoot = path.join(__dirname, 'fixtures', 'media')
const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'))
const mediaRoot = process.env.VIDEO_SMOKE_MEDIA_ROOT
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-smoke-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function cli(args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8', timeout: 120000, cwd: os.tmpdir(),
    env: { ...process.env, FFMPEG_PATH: 'must-be-overridden', FFPROBE_PATH: 'must-be-overridden' }, ...options,
  })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  assert.equal(result.stderr, '', 'Diagnostics must remain structured JSON')
  const report = JSON.parse(result.stdout)
  assert.equal(report.check, 'desktop-video')
  return { ...result, report }
}

test('committed public synthetic samples have complete codec/container coverage and matching hashes', () => {
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.source.kind, 'public-synthetic')
  assert.match(manifest.source.version, /^ffmpeg version 7\.0\.2-static /)
  assert.equal(manifest.source.filter, 'testsrc2=size=128x96:rate=4:duration=1')
  assert.deepEqual(manifest.source.environment, { JOBS: '1', OMP_NUM_THREADS: '1' })
  assert.deepEqual(manifest.fixtures.map(item => [item.file, item.codec]).sort(), [
    ['h264.mp4', 'h264'], ['h264.mov', 'h264'], ['hevc.mkv', 'hevc'],
    ['vp8.webm', 'vp8'], ['vp9.webm', 'vp9'], ['av1.mkv', 'av1'],
  ].sort())
  let total = 0
  for (const fixture of manifest.fixtures) {
    const bytes = fs.readFileSync(path.join(fixtureRoot, fixture.file))
    assert.equal(bytes.length, fixture.bytes)
    assert.equal(hash(bytes), fixture.sha256)
    assert.deepEqual([fixture.width, fixture.height, fixture.frameRate, fixture.durationMs], [128, 96, 4, 1000])
    assert.ok(bytes.length > 0 && bytes.length < 16 * 1024)
    total += bytes.length
    const args = fixture.command
    assert.equal(args[0], 'node_modules/ffmpeg-static/ffmpeg')
    assert.equal(args.at(-1), 'tests/fixtures/media/' + fixture.file)
    assert.equal(args[args.indexOf('-i') + 1], manifest.source.filter)
    for (let index = 0; index < args.length; index++) {
      if (['-threads', '-filter_threads', '-filter_complex_threads'].includes(args[index])) assert.equal(args[index + 1], '1')
    }
    assert.ok(args.includes('-threads'))
    if (fixture.codec === 'hevc') assert.equal(args[args.indexOf('-x265-params') + 1], 'pools=1:frame-threads=1:log-level=error')
  }
  assert.ok(total < 64 * 1024)
  assert.deepEqual(fs.readdirSync(fixtureRoot).filter(file => /\.(mp4|mov|mkv|webm)$/.test(file)).sort(), manifest.fixtures.map(item => item.file).sort())
})

test('CLI usage and missing tools fail with JSON and no arbitrary native error text', () => {
  const usage = cli([])
  assert.equal(usage.status, 1)
  assert.equal(usage.report.failure.code, 'USAGE')
  const missing = cli([fixtureRoot])
  assert.equal(missing.status, 1)
  assert.equal(missing.report.failure.phase, 'media-tools')
  assert.equal(missing.report.status, 'failed')
  assert.equal(missing.report.outputDirectory, undefined)
  assert.equal(missing.stdout.includes(fixtureRoot), false)
})

test('changed sample bytes fail integrity validation without changing inputs or neighboring data', t => {
  const root = temporary(t), copies = path.join(root, 'fixtures')
  fs.cpSync(fixtureRoot, copies, { recursive: true })
  const sentinel = path.join(root, 'keep.txt')
  fs.writeFileSync(sentinel, 'keep neighboring data')
  const sample = path.join(copies, 'h264.mp4')
  const damaged = fs.readFileSync(sample)
  damaged[damaged.length - 1] ^= 1
  fs.writeFileSync(sample, damaged)
  const result = cli([root, copies])
  assert.equal(result.status, 1)
  assert.equal(result.report.failure.phase, 'fixture-integrity')
  assert.equal(result.report.outputDirectory, undefined)
  assert.deepEqual(fs.readFileSync(sample), damaged)
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep neighboring data')
})

test('native pair exercises real app defaults for all samples and removes only its temporary JPEG output', { skip: !mediaRoot }, () => {
  const before = manifest.fixtures.map(item => hash(fs.readFileSync(path.join(fixtureRoot, item.file))))
  const { status, report } = cli([mediaRoot])
  assert.equal(status, 0, JSON.stringify(report))
  assert.equal(report.status, 'passed')
  assert.equal(report.fixtures.length, 6)
  assert.equal(report.cleanup.temporaryOutputRemoved, true)
  assert.match(path.basename(report.outputDirectory), /^llm-canvas-video-smoke-/)
  assert.equal(fs.existsSync(report.outputDirectory), false)
  assert.equal(report.appSourceSha256, hash(fs.readFileSync(path.resolve(__dirname, '../src/lib/videoUtils.ts'))))
  assert.equal(report.tools.ffmpeg.version, report.tools.ffprobe.version)
  assert.match(report.tools.ffmpeg.version, /^9\./)
  for (const tool of Object.values(report.tools)) {
    assert.equal(tool.nativeExecutable, true)
    assert.match(tool.sha256, /^[a-f0-9]{64}$/)
  }
  for (const sample of report.fixtures) {
    const expected = manifest.fixtures.find(item => item.file === sample.file)
    assert.equal(sample.sha256, expected.sha256)
    assert.deepEqual(sample.metadata, { codecName: expected.codec, width: 128, height: 96, durationMs: 1000, frameRate: 4 })
    assert.equal(sample.thumbnail.file, sample.file + '/thumbnail.jpg')
    assert.equal(sample.frames.length, 1)
    assert.equal(sample.frames[0].file, sample.file + '/frames/frame_00001.jpg')
    assert.equal(sample.frames[0].timestampMs, 0)
    for (const image of [sample.thumbnail, ...sample.frames]) {
      assert.deepEqual([image.codec, image.mimeType, image.width, image.height], ['mjpeg', 'image/jpeg', 1024, 768])
      assert.ok(image.bytes > 100)
      assert.match(image.sha256, /^[a-f0-9]{64}$/)
      assert.equal(path.isAbsolute(image.file), false)
      assert.equal(image.file.includes('..'), false)
    }
  }
  assert.deepEqual(manifest.fixtures.map(item => hash(fs.readFileSync(path.join(fixtureRoot, item.file)))), before)
})

test('valid hashes cannot disguise a wrong codec; failure also cleans owned output', { skip: !mediaRoot }, t => {
  const root = temporary(t), copies = path.join(root, 'fixtures')
  fs.cpSync(fixtureRoot, copies, { recursive: true })
  const sentinel = path.join(root, 'keep.txt')
  fs.writeFileSync(sentinel, 'keep neighboring data')
  const changed = JSON.parse(fs.readFileSync(path.join(copies, 'manifest.json'), 'utf8'))
  const item = changed.fixtures.find(fixture => fixture.file === 'h264.mp4')
  const bytes = fs.readFileSync(path.join(copies, 'vp8.webm'))
  fs.writeFileSync(path.join(copies, item.file), bytes)
  Object.assign(item, { bytes: bytes.length, sha256: hash(bytes) })
  fs.writeFileSync(path.join(copies, 'manifest.json'), JSON.stringify(changed))
  const { status, report } = cli([mediaRoot, copies])
  assert.equal(status, 1)
  assert.equal(report.failure.phase, 'metadata:h264.mp4')
  assert.equal(report.cleanup.temporaryOutputRemoved, true)
  assert.equal(fs.existsSync(report.outputDirectory), false)
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep neighboring data')
  assert.deepEqual(fs.readFileSync(path.join(copies, item.file)), bytes)
})
