// Host-side release tool: Node 22 + checkout dependencies, never an ASAR entrypoint.
// node desktop/video-smoke.cjs /absolute/media-tools [fixture-directory]
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execute = promisify(execFile)
const checkout = path.resolve(__dirname, '..')
const defaultFixtures = path.join(checkout, 'tests', 'fixtures', 'media')
const coverage = { 'h264.mp4': 'h264', 'h264.mov': 'h264', 'hevc.mkv': 'hevc', 'vp8.webm': 'vp8', 'vp9.webm': 'vp9', 'av1.mkv': 'av1' }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

async function containedFile(root, relative) {
  const filename = await fs.realpath(path.join(root, relative))
  const within = path.relative(root, filename)
  assert.ok(within && within !== '..' && !within.startsWith('..' + path.sep) && !path.isAbsolute(within), 'File escapes selected root')
  assert.ok((await fs.stat(filename)).isFile(), 'Expected regular file')
  return filename
}

async function fixturesAt(directory) {
  const root = await fs.realpath(directory)
  const manifest = JSON.parse(await fs.readFile(await containedFile(root, 'manifest.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.source.kind, 'public-synthetic')
  assert.equal(manifest.fixtures.length, 6)
  assert.deepEqual(manifest.fixtures.map(item => item.file).sort(), Object.keys(coverage).sort())
  const fixtures = []
  for (const fixture of manifest.fixtures) {
    assert.equal(fixture.codec, coverage[fixture.file])
    assert.equal(fixture.width, 128)
    assert.equal(fixture.height, 96)
    assert.equal(fixture.durationMs, 1000)
    assert.equal(fixture.frameRate, 4)
    assert.match(fixture.sha256, /^[a-f0-9]{64}$/)
    assert.ok(Number.isSafeInteger(fixture.bytes) && fixture.bytes > 0 && fixture.bytes <= 64 * 1024)
    const inputPath = await containedFile(root, fixture.file)
    const bytes = await fs.readFile(inputPath)
    assert.equal(bytes.length, fixture.bytes, 'Fixture size mismatch')
    assert.equal(sha256(bytes), fixture.sha256, 'Fixture SHA-256 mismatch')
    fixtures.push({ ...fixture, inputPath })
  }
  return fixtures
}

async function command(binary, args) {
  const { stdout } = await execute(binary, args, { timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true })
  return stdout
}

async function mediaToolsAt(directory) {
  const root = await fs.realpath(directory)
  const tools = {}
  for (const name of ['ffmpeg', 'ffprobe']) {
    const filename = await containedFile(root, path.join('bin', name + (process.platform === 'win32' ? '.exe' : '')))
    const bytes = await fs.readFile(filename)
    const magic = bytes.subarray(0, 4).toString('hex')
    const native = process.platform === 'linux' ? magic === '7f454c46'
      : process.platform === 'win32' ? bytes.subarray(0, 2).toString() === 'MZ'
        : ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(magic)
    assert.ok(native, 'Media tool must be a native executable')
    const versionOutput = await command(filename, ['-version'])
    const version = versionOutput.match(new RegExp('^' + name + ' version (9\\.\\d+\\.\\d+)(?:\\s|$)'))?.[1]
    assert.ok(version, 'Expected controlled FFmpeg 9 pair')
    const configuration = versionOutput.split(/\r?\n/).find(line => line.startsWith('configuration: '))
    assert.ok(configuration, 'Missing media configuration')
    assert.equal(/--enable-(?:gpl|version3|nonfree)(?:\s|$)/.test(configuration), false)
    for (const flag of ['disable-gpl', 'disable-version3', 'disable-nonfree', 'disable-autodetect', 'enable-libdav1d', 'enable-zlib']) {
      assert.ok(configuration.split(/\s+/).includes('--' + flag), 'Missing controlled media configuration')
    }
    tools[name] = { filename, sha256: sha256(bytes), version, nativeExecutable: true, configuration }
  }
  assert.equal(tools.ffmpeg.version, tools.ffprobe.version, 'Media tool versions differ')
  assert.equal(tools.ffmpeg.configuration, tools.ffprobe.configuration, 'Media tool configurations differ')
  return tools
}

async function probe(binary, filename) {
  return JSON.parse(await command(binary, ['-v', 'error', '-print_format', 'json', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt', filename]))
}

async function jpegEvidence(filename, directory, ffprobe, width, height) {
  const relative = path.relative(directory, filename)
  assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
  assert.equal(await containedFile(directory, relative), filename)
  const bytes = await fs.readFile(filename)
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'Missing JPEG start marker')
  assert.equal(bytes.readUInt16BE(bytes.length - 2), 0xffd9, 'Missing JPEG end marker')
  const { imageSize } = require('image-size')
  const image = imageSize(bytes)
  assert.equal(image.type, 'jpg')
  assert.equal(image.width, width)
  assert.equal(image.height, height)
  const metadata = await probe(ffprobe, filename)
  assert.equal(metadata.streams.length, 1)
  const stream = metadata.streams[0]
  assert.equal(stream.codec_name, 'mjpeg')
  assert.equal(stream.pix_fmt, 'yuvj420p')
  assert.equal(stream.width, width)
  assert.equal(stream.height, height)
  return { file: relative.split(path.sep).join('/'), bytes: bytes.length, sha256: sha256(bytes), codec: 'mjpeg', mimeType: 'image/jpeg', width, height }
}

async function runVideoSmoke(mediaRoot, fixtureRoot = defaultFixtures) {
  const report = { check: 'desktop-video', status: 'failed', platform: process.platform, architecture: process.arch, node: process.versions.node, fixtures: [], cleanup: { temporaryOutputRemoved: false } }
  let directory, phase = 'arguments'
  const previous = { FFMPEG_PATH: process.env.FFMPEG_PATH, FFPROBE_PATH: process.env.FFPROBE_PATH }
  try {
    assert.ok(mediaRoot, 'Pass a controlled media root')
    assert.ok(['linux', 'win32', 'darwin'].includes(process.platform))
    assert.ok(Number(process.versions.node.split('.')[0]) >= 22, 'Use host Node 22 or later')
    phase = 'fixture-integrity'
    const fixtures = await fixturesAt(fixtureRoot)
    phase = 'media-tools'
    const tools = await mediaToolsAt(mediaRoot)
    report.tools = Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, { sha256: tool.sha256, version: tool.version, nativeExecutable: tool.nativeExecutable }]))
    process.env.FFMPEG_PATH = tools.ffmpeg.filename
    process.env.FFPROBE_PATH = tools.ffprobe.filename
    phase = 'load-app-source'
    const source = path.join(checkout, 'src', 'lib', 'videoUtils.ts')
    report.appSourceSha256 = sha256(await fs.readFile(source))
    // Transpile the checkout's real module with its real imports. No overrides,
    // copied FFmpeg arguments, provider calls, app startup or packaged TS loader.
    const { createLoader } = require('../tests/loadSource')
    const app = createLoader()(source)
    directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'llm-canvas-video-smoke-'))
    report.outputDirectory = directory
    for (const fixture of fixtures) {
      const { file, inputPath } = fixture
      phase = 'metadata:' + file
      const raw = await probe(tools.ffprobe.filename, inputPath)
      assert.equal(raw.streams.length, 1)
      assert.equal(raw.streams[0].codec_type, 'video')
      assert.equal(raw.streams[0].codec_name, fixture.codec)
      assert.equal(raw.streams[0].width, fixture.width)
      assert.equal(raw.streams[0].height, fixture.height)
      assert.equal(raw.streams[0].avg_frame_rate, '4/1')
      assert.equal(Number(raw.format.duration) * 1000, fixture.durationMs)
      const metadata = await app.extractVideoMetadata(inputPath)
      assert.deepEqual(metadata, { codecName: fixture.codec, width: fixture.width, height: fixture.height, durationMs: fixture.durationMs, frameRate: fixture.frameRate })
      const output = path.join(directory, file)
      const thumbnailPath = path.join(output, 'thumbnail.jpg')
      const framesDir = path.join(output, 'frames')
      phase = 'thumbnail:' + file
      // Deliberately use application defaults: scale to 1024, first frame JPEG.
      await app.generateVideoThumbnail({ inputPath, outputPath: thumbnailPath })
      const thumbnail = await jpegEvidence(thumbnailPath, directory, tools.ffprobe.filename, 1024, 768)
      phase = 'frames:' + file
      const frames = await app.generateVideoFrames({ inputPath, outputDir: framesDir, durationMs: metadata.durationMs })
      assert.equal(frames.length, 1, 'A one-second clip must produce one default-interval frame')
      assert.deepEqual((await fs.readdir(output)).sort(), ['frames', 'thumbnail.jpg'])
      assert.deepEqual(await fs.readdir(framesDir), ['frame_00001.jpg'])
      const evidence = []
      for (const frame of frames) {
        assert.equal(frame.path, path.join(framesDir, 'frame_00001.jpg'))
        const jpeg = await jpegEvidence(frame.path, directory, tools.ffprobe.filename, 1024, 768)
        assert.equal(frame.mimeType, jpeg.mimeType)
        assert.equal(frame.width, jpeg.width)
        assert.equal(frame.height, jpeg.height)
        assert.equal(frame.fileSize, jpeg.bytes)
        assert.equal(frame.timestampMs, 0)
        evidence.push({ ...jpeg, timestampMs: frame.timestampMs })
      }
      report.fixtures.push({ file, sha256: fixture.sha256, metadata, thumbnail, frames: evidence })
    }
    assert.deepEqual((await fs.readdir(directory)).sort(), Object.keys(coverage).sort())
    report.status = 'passed'
  } catch {
    // Never include native stderr, arbitrary exception strings or environment.
    report.failure = { phase, code: 'VIDEO_SMOKE_FAILED' }
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    if (directory) {
      try {
        // This is exclusively the mkdtemp directory created by this invocation.
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
        report.cleanup.temporaryOutputRemoved = true
      } catch {
        report.status = 'failed'
        report.failure = { phase: 'cleanup', code: 'VIDEO_SMOKE_FAILED' }
      }
    }
  }
  return report
}

module.exports = { runVideoSmoke }
if (require.main === module) {
  const args = process.argv.slice(2)
  if (args.length < 1 || args.length > 2) {
    process.stdout.write(JSON.stringify({ check: 'desktop-video', status: 'failed', failure: { phase: 'arguments', code: 'USAGE', usage: 'node desktop/video-smoke.cjs mediaRoot [fixtureRoot]' } }) + '\n')
    process.exitCode = 1
  } else {
    runVideoSmoke(...args).then(report => {
      process.stdout.write(JSON.stringify(report) + '\n')
      if (report.status !== 'passed') process.exitCode = 1
    }).catch(() => {
      process.stdout.write(JSON.stringify({ check: 'desktop-video', status: 'failed', failure: { phase: 'runner', code: 'VIDEO_SMOKE_FAILED' } }) + '\n')
      process.exitCode = 1
    })
  }
}
