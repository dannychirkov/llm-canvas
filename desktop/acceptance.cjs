// Run with standard Node 22 against a native, packaged application. Display,
// D-Bus and OS keyring provisioning belong to the caller, never this runner.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const limits = { startup: 120000, smoke: 120000, stop: 30000, recovery: 30000 }

function alive(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0, 'Invalid process ID')
  try { process.kill(pid, 0); return true }
  catch (error) { if (error.code === 'ESRCH') return false; throw error }
}

async function until(probe, { timeoutMs, label, intervalMs = 100 }) {
  const deadline = Date.now() + timeoutMs
  do {
    const result = await probe()
    if (result) return result
    await delay(Math.min(intervalMs, Math.max(0, deadline - Date.now())))
  } while (Date.now() < deadline)
  throw new Error(`Deadline exceeded: ${label}`)
}

function track(child) {
  const state = { child, exited: false, code: null, signal: null, spawnError: false }
  child.once('error', () => { state.spawnError = true })
  child.once('exit', (code, signal) => { Object.assign(state, { exited: true, code, signal }) })
  return state
}

async function command(executable, args, { timeoutMs = limits.smoke, env = process.env } = {}) {
  const state = track(spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }))
  let closed = false
  state.child.once('close', () => { closed = true })
  let output = '', bytes = 0
  for (const stream of [state.child.stdout, state.child.stderr]) stream.on('data', chunk => {
    bytes += chunk.length
    if (bytes <= 1024 * 1024) output += chunk.toString()
  })
  try {
    await until(() => {
      assert.equal(state.spawnError, false, 'Unable to spawn acceptance child')
      assert.ok(bytes <= 1024 * 1024, 'Acceptance child output limit exceeded')
      return closed
    }, { timeoutMs, label: path.basename(args[0] || executable) })
    const location = output.match(/\b((?:wire-)?smoke\.cjs):(\d+):\d+/)
    const phase = output.match(/"phase":"([a-z-]{1,40})"/)
    const browserFailure = output.split('\n').map(line => { try { return JSON.parse(line) } catch { return null } }).find(value => value?.check === 'desktop-browser' && value.status === 'failed')
    const paths = Array.isArray(browserFailure?.failures) ? browserFailure.failures.filter(value => value === 'page exception' || /^\d{3} \/[^?\s#]{0,160}$/.test(value)).slice(0, 10) : []
    const diagnostic = (location ? ` at ${location[1]}:${location[2]}` : '') + (phase ? ` (${phase[1]})` : '') + (paths.length ? ': ' + paths.join(', ') : '')
    if (state.code !== 0) {
      const error = new assert.AssertionError({ message: 'Acceptance child failed' + diagnostic, actual: state.code, expected: 0, operator: 'strictEqual' })
      if (browserFailure?.readinessState) error.readinessState = browserFailure.readinessState
      if (browserFailure?.readinessOperation) error.readinessOperation = browserFailure.readinessOperation
      throw error
    }
    return output
  } finally {
    if (!state.exited && state.child.pid) {
      state.child.kill('SIGKILL')
      await until(() => state.exited, { timeoutMs: 5000, label: 'acceptance child termination' })
    }
  }
}

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
  if (!response.ok) throw new Error('HTTP readiness failed')
  return response.json()
}

function debuggerURL(value, port) {
  const url = new URL(value)
  assert.equal(url.protocol, 'ws:')
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.port, String(port))
  return url.href
}

async function cdp(url, method, params = {}, { timeoutMs = 5000, allowClose = false } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const timer = setTimeout(() => finish(new Error(`CDP deadline: ${method}`)), timeoutMs)
    let settled = false, sent = false
    function finish(error, result) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      if (error) reject(error)
      else resolve(result)
    }
    socket.addEventListener('error', () => finish(new Error(`CDP connection failed: ${method}`)))
    socket.addEventListener('close', () => finish(allowClose && sent ? null : new Error(`CDP closed: ${method}`)))
    socket.addEventListener('open', () => { sent = true; socket.send(JSON.stringify({ id: 1, method, params })) })
    socket.addEventListener('message', event => {
      try {
        const message = JSON.parse(event.data)
        if (message.id === 1) finish(message.error ? new Error(`CDP rejected: ${method}`) : null, message.result)
      } catch { finish(new Error('Invalid CDP reply')) }
    })
  })
}

async function profileLease(profile, mainPid) {
  const lease = JSON.parse(await fs.readFile(path.join(profile, 'runtime.json'), 'utf8'))
  assert.equal(lease.mainPid, mainPid, 'Requested isolated profile is not owned by launched main process')
  assert.ok(Number.isSafeInteger(lease.childPid) && lease.childPid > 0 && lease.childPid !== mainPid && lease.childPid !== process.pid, 'Invalid backend lease')
  return lease
}

async function waitReady({ profile, main, port, bundle, timeoutMs = limits.startup }) {
  const base = `http://127.0.0.1:${port}`
  return until(async () => {
    assert.equal(main.spawnError, false, 'Native app failed to spawn')
    assert.equal(main.exited, false, 'Native app exited before readiness')
    let targets
    try { targets = await json(base + '/json/list') } catch { return false }
    if (!Array.isArray(targets)) return false
    const target = targets.find(item => {
      if (item.type !== 'page') return false
      try {
        const url = new URL(item.url)
        return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && url.port !== '4250'
      } catch { return false }
    })
    if (!target) return false
    // main.cjs applies LLM_CANVAS_PROFILE before the single-instance lock. The
    // lease proves that this actual launch used it; an env var is no evidence.
    const lease = await profileLease(profile, main.child.pid)
    assert.equal(alive(lease.childPid), true, 'Backend is not running')
    const version = await json(base + '/json/version')
    const processes = await cdp(debuggerURL(version.webSocketDebuggerUrl, port), 'SystemInfo.getProcessInfo')
    assert.ok(processes.processInfo.some(item => item.type === 'browser' && item.id === main.child.pid), 'CDP does not belong to launched app')
    const processPaths = bundle ? await verifyProcessPaths(main.child.pid, lease.childPid, bundle) : undefined
    const pageSocket = debuggerURL(target.webSocketDebuggerUrl, port)
    const secret = await fs.readFile(path.join(profile, 'auth-secret.bin'))
    assert.ok(secret.length > 0 && !/^[a-f0-9]{64}$/i.test(secret.toString()), 'Missing encrypted authentication secret')
    await fs.access(path.join(profile, 'data', 'prisma', 'dev.db'))
    const origin = new URL(target.url).origin
    const health = await json(origin + '/api/health')
    assert.equal(health.status, 'healthy')
    return { backendPid: lease.childPid, origin, pageSocket, processPaths, secretDigest: createHash('sha256').update(secret).digest('hex') }
  }, { timeoutMs, label: 'native CDP, profile ownership and backend readiness' })
}

async function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

function launchEnvironment(profile, source = process.env) {
  const env = {}
  // Preserve the real logon identity/DPAPI and the provisioned OS keyring, but
  // never inherit deployment credentials, Node injection or Electron overrides.
  const allowed = /^(?:PATH|HOME|USER|LOGNAME|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|LANG|LC_ALL|DISPLAY|XAUTHORITY|DBUS_SESSION_BUS_ADDRESS|XDG_RUNTIME_DIR|XDG_CURRENT_DESKTOP|XDG_DATA_HOME|GNOME_KEYRING_CONTROL|SSH_AUTH_SOCK)$/i
  for (const [key, value] of Object.entries(source)) if (allowed.test(key)) env[key] = value
  env.XDG_CONFIG_HOME = path.join(profile, 'xdg-config')
  env.LLM_CANVAS_PROFILE = profile
  env.NEXT_TELEMETRY_DISABLED = '1'
  return env
}

async function findPackagedApp(dist, platform = process.platform) {
  const candidates = []
  for (const entry of await fs.readdir(dist, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const root = path.join(dist, entry.name)
    if (platform === 'linux' && /^linux(?:-\w+)?-unpacked$/.test(entry.name)) candidates.push({ root, executable: path.join(root, 'llm-canvas') })
    if (platform === 'win32' && /^win(?:-\w+)?-unpacked$/.test(entry.name)) candidates.push({ root, executable: path.join(root, 'LLM Canvas.exe') })
    if (platform === 'darwin' && /^mac(?:-\w+)?$/.test(entry.name)) candidates.push({ root: path.join(root, 'LLM Canvas.app'), executable: path.join(root, 'LLM Canvas.app', 'Contents', 'MacOS', 'LLM Canvas') })
    if (platform === 'darwin' && entry.name === 'LLM Canvas.app') candidates.push({ root, executable: path.join(root, 'Contents', 'MacOS', 'LLM Canvas') })
    if (platform === 'linux' && entry.name === 'squashfs-root') candidates.push({ root, executable: path.join(root, 'AppRun') })
  }
  assert.equal(candidates.length, 1, 'Expected exactly one native app payload in distribution directory')
  await fs.access(candidates[0].executable)
  return candidates[0]
}

function contained(root, filename) {
  const relative = path.relative(root, filename)
  assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'Native payload path escapes its root')
}

async function resolveBundle(executable, root, platform = process.platform) {
  root = await fs.realpath(root || (platform === 'darwin' ? path.resolve(path.dirname(executable), '..', '..') : path.dirname(executable)))
  const launchPath = await fs.realpath(executable)
  const nativeExecutable = await fs.realpath(platform === 'darwin' ? path.join(root, 'Contents', 'MacOS', 'LLM Canvas') : path.join(root, platform === 'win32' ? 'LLM Canvas.exe' : 'llm-canvas'))
  const resources = await fs.realpath(path.join(root, ...(platform === 'darwin' ? ['Contents', 'Resources'] : ['resources'])))
  const backendExecutable = await fs.realpath(path.join(resources, 'server', 'runtime', platform === 'win32' ? 'node.exe' : 'node'))
  for (const filename of [launchPath, nativeExecutable, resources, backendExecutable]) contained(root, filename)
  return { root, nativeExecutable, resources, backendExecutable }
}

async function processExecutablePath(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0, 'Invalid process ID')
  if (process.platform === 'linux') return fs.readlink(`/proc/${pid}/exe`)
  if (process.platform === 'win32') {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    return (await command(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; (Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').ExecutablePath`], { timeoutMs: 10000 })).trim()
  }
  // libproc returns the kernel executable path even when Next changes argv[0].
  // Python is already a native media build prerequisite in the macOS workflow.
  const script = 'import ctypes,os,sys\nlib=ctypes.CDLL("/usr/lib/libproc.dylib",use_errno=True)\nfn=lib.proc_pidpath\nfn.argtypes=[ctypes.c_int,ctypes.c_void_p,ctypes.c_uint32]\nfn.restype=ctypes.c_int\nbuf=ctypes.create_string_buffer(4096)\nif fn(int(sys.argv[1]),buf,len(buf))<=0: raise OSError(ctypes.get_errno(),"proc_pidpath failed")\nprint(os.fsdecode(buf.value))'
  return (await command('/usr/bin/python3', ['-I', '-c', script, String(pid)], { timeoutMs: 10000 })).trim()
}

async function verifyProcessPaths(mainPid, backendPid, bundle) {
  const result = {}
  for (const [name, pid, expected] of [['main', mainPid, bundle.nativeExecutable], ['backend', backendPid, bundle.backendExecutable]]) {
    const reported = await processExecutablePath(pid)
    assert.ok(path.isAbsolute(reported), 'OS did not report an absolute executable path')
    const actual = await fs.realpath(reported)
    contained(bundle.root, actual)
    assert.equal(process.platform === 'win32' ? actual.toLowerCase() : actual, process.platform === 'win32' ? expected.toLowerCase() : expected, 'Running process does not use the selected artifact payload')
    result[name] = path.relative(bundle.root, actual).split(path.sep).join('/')
  }
  return result
}

async function hashFile(filename) {
  const handle = await fs.open(filename, 'r')
  try {
    const hash = createHash('sha256')
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk)
    return hash.digest('hex')
  } finally { await handle.close() }
}

async function verifyMedia(resources, directory, env) {
  const tools = {}
  for (const name of ['ffmpeg', 'ffprobe']) {
    const relative = path.join('server', 'media-tools', 'bin', name + (process.platform === 'win32' ? '.exe' : ''))
    const filename = path.join(resources, relative)
    const handle = await fs.open(filename, 'r')
    const magic = Buffer.alloc(4)
    try { await handle.read(magic, 0, 4, 0) } finally { await handle.close() }
    const native = process.platform === 'linux' ? magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) : process.platform === 'win32' ? magic.subarray(0, 2).toString() === 'MZ' : ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf'].includes(magic.toString('hex'))
    assert.equal(native, true, 'Packaged media tool must be a native executable, never a script wrapper')
    const version = await command(filename, ['-version'], { timeoutMs: 15000, env })
    assert.ok(version.startsWith(name + ' version '), 'Media tool version CLI failed')
    assert.equal(/--enable-(?:gpl|nonfree)(?:\s|$)/.test(version), false, 'GPL/nonfree media configuration is forbidden')
    tools[name] = { path: relative.split(path.sep).join('/'), nativeExecutable: true, version: version.split(/\r?\n/)[0], sha256: await hashFile(filename) }
  }
  assert.equal(tools.ffmpeg.version.split(/\s+/)[2], tools.ffprobe.version.split(/\s+/)[2], 'Packaged FFmpeg and FFprobe versions differ')
  const executable = name => path.join(resources, ...tools[name].path.split('/'))
  const input = path.join(directory, 'media-input.pcm'), output = path.join(directory, 'media-output.wav')
  await fs.writeFile(input, Buffer.alloc(1600)) // 0.1 seconds, mono signed 16-bit PCM, 8 kHz.
  await command(executable('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', '8000', '-ac', '1', '-i', input, '-c:a', 'pcm_s16le', '-y', output], { timeoutMs: 15000, env })
  const probe = JSON.parse(await command(executable('ffprobe'), ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration', '-of', 'json', output], { timeoutMs: 15000, env }))
  assert.equal(probe.streams.length, 1)
  assert.equal(probe.streams[0].codec_name, 'pcm_s16le')
  assert.equal(probe.streams[0].sample_rate, '8000')
  assert.equal(probe.streams[0].channels, 1)
  assert.ok(Math.abs(Number(probe.format.duration) - 0.1) < 0.01, 'Media round trip duration mismatch')
  const runtime = path.join(resources, 'server', 'runtime', process.platform === 'win32' ? 'node.exe' : 'node')
  const imageProbe = `const {createRequire}=require('node:module');const sharp=createRequire(process.argv[1])('sharp');(async()=>{const pixels=Buffer.from('0a141eff'.repeat(4),'hex');const png=await sharp(pixels,{raw:{width:2,height:2,channels:4}}).png().toBuffer();const decoded=await sharp(png).raw().toBuffer({resolveWithObject:true});process.stdout.write(JSON.stringify({standardNode:!process.versions.electron,png:png.subarray(0,8).toString('hex')==='89504e470d0a1a0a',width:decoded.info.width,height:decoded.info.height,channels:decoded.info.channels,pixelsMatch:decoded.data.equals(pixels),vips:sharp.versions.vips}));})().catch(()=>process.exit(1));`
  const image = JSON.parse(await command(runtime, ['-e', imageProbe, path.join(resources, 'server', 'package.json')], { timeoutMs: 15000, env }))
  assert.equal(image.standardNode, true)
  assert.equal(image.png, true)
  assert.equal(image.width, 2)
  assert.equal(image.height, 2)
  assert.equal(image.channels, 4)
  assert.equal(image.pixelsMatch, true, 'Packaged Sharp PNG roundtrip failed')
  return { ...tools, pcmWavRoundTrip: true, sharpPngRoundTrip: true, vips: image.vips }
}

async function stopped(state, ready, timeoutMs = limits.stop) {
  await until(() => state.exited && !alive(ready.backendPid), { timeoutMs, label: 'main and backend shutdown' })
  await until(async () => {
    try { await json(ready.origin + '/api/health'); return false } catch { return true }
  }, { timeoutMs: 5000, label: 'old backend listener shutdown' })
}

async function runAcceptance({ executable, root, artifact, output }) {
  assert.ok(['linux', 'darwin', 'win32'].includes(process.platform), 'Unsupported native platform')
  if (process.platform === 'linux') {
    assert.ok(process.env.DISPLAY && process.env.DBUS_SESSION_BUS_ADDRESS, 'Provision an external display, D-Bus session and unlocked keyring first')
  }
  // A separate runner-created directory avoids touching a personal app profile.
  const profile = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'llm-canvas-acceptance-'))
  const env = launchEnvironment(profile)
  await fs.mkdir(env.XDG_CONFIG_HOME, { recursive: true, mode: 0o700 })
  await fs.mkdir(output, { recursive: true })
  const report = { status: 'failed', platform: process.platform, architecture: process.arch, node: process.versions.node, executable: path.basename(executable), launches: [], checks: [], recoveries: [] }
  let main, ready, bundle, phase = 'bundle', secretDigest
  let events = Promise.resolve()
  function record(event) {
    const line = JSON.stringify({ time: new Date().toISOString(), ...event }) + '\n'
    process.stdout.write(line)
    events = events.then(() => fs.appendFile(path.join(output, 'events.jsonl'), line))
  }
  async function start(name, resume) {
    phase = name
    const started = Date.now()
    const port = await unusedPort()
    const args = ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`]
    if (process.platform === 'linux') args.push('--password-store=gnome-libsecret', '--ozone-platform=x11')
    // Hosted Windows sessions can occlude a focused window. Chromium exposes
    // this test switch specifically to keep GUI acceptance deterministic.
    // Sandbox, permissions and all application readiness checks remain active.
    if (process.platform === 'win32') args.push('--disable-backgrounding-occluded-windows')
    main = track(spawn(executable, args, { env, cwd: bundle.root, stdio: ['ignore', 'pipe', 'pipe'] }))
    ready = undefined
    // Native output may contain keychain diagnostics. Publish only byte counts
    // and the app's bounded startup phase, never raw stderr or profile files.
    const launch = { name, mainPid: main.child.pid, stdoutBytes: 0, stderrBytes: 0, ciOcclusionWorkaround: process.platform === 'win32' }
    report.launches.push(launch)
    for (const [stream, field] of [[main.child.stdout, 'stdoutBytes'], [main.child.stderr, 'stderrBytes']]) stream.on('data', chunk => {
      launch[field] += chunk.length
      const failure = chunk.toString().match(/"event":"desktop_startup_failed","phase":"([a-z ]{1,40})"/)
      if (failure) launch.startupFailurePhase = failure[1]
    })
    record({ event: 'launch', name, mainPid: main.child.pid })
    ready = await waitReady({ profile, main, port, bundle })
    launch.backendPid = ready.backendPid
    launch.readinessMs = Date.now() - started
    launch.cdpProfileOwnershipProven = true
    launch.payloadProcessPathsProven = true
    launch.artifactProcessPathsProven = Boolean(artifact)
    launch.processPaths = ready.processPaths
    // OS key rotation may re-encrypt the same secret. Session resume below,
    // rather than identical ciphertext, proves authentication continuity.
    launch.authCiphertextChanged = Boolean(secretDigest && ready.secretDigest !== secretDigest)
    secretDigest = ready.secretDigest
    record({ event: 'ready', name, mainPid: main.child.pid, backendPid: ready.backendPid, cdpProfileOwnershipProven: true })
    for (const [script, check] of [['smoke.cjs', 'desktop-browser'], ['wire-smoke.cjs', 'desktop-provider-wire']]) {
      phase = `${name}:${script}`
      const stdout = await command(process.execPath, [path.join(__dirname, script), String(port), ...(resume ? ['--resume'] : [])], { timeoutMs: limits.smoke, env })
      const evidence = stdout.trim().split('\n').map(line => { try { return JSON.parse(line) } catch { return null } }).find(item => item?.check === check)
      assert.ok(evidence && evidence.resume === resume, 'Missing smoke evidence')
      report.checks.push({ launch: name, ...evidence })
      record({ event: 'smoke_passed', name, check, resume })
    }
    assert.equal(main.exited, false, 'Native app exited during smoke')
  }
  async function close() {
    phase = 'clean-stop'
    await cdp(ready.pageSocket, 'Page.close', {}, { allowClose: true })
    await stopped(main, ready)
    assert.equal(main.code, 0, 'Clean shutdown failed')
    record({ event: 'clean_stop', mainPid: main.child.pid, backendPid: ready.backendPid })
  }
  try {
    bundle = await resolveBundle(executable, root)
    const { resources } = bundle
    report.payloadRoot = bundle.root
    report.executableSha256 = await hashFile(bundle.nativeExecutable)
    report.launcherSha256 = await hashFile(executable)
    report.appAsarSha256 = await hashFile(path.join(resources, 'app.asar'))
    if (artifact) {
      const formats = { '.AppImage': 'AppImage', '.exe': 'NSIS', '.dmg': 'DMG' }
      const format = formats[path.extname(artifact)]
      assert.ok(format, 'Unsupported acceptance artifact')
      // Installation/extraction is performed by the workflow and recorded in
      // installation.json; a supplied filename alone is not installation proof.
      report.artifact = { name: path.basename(artifact), sha256: await hashFile(artifact), format }
      if (process.platform === 'linux') {
        const desktopEntry = await fs.readFile(path.join(bundle.root, 'llm-canvas.desktop'), 'utf8')
        assert.match(desktopEntry, /^Exec=AppRun %U\r?$/m, 'AppImage desktop entry must preserve sandboxing')
        assert.equal((await fs.readFile(executable, 'utf8')).includes('--no-sandbox'), false, 'AppImage launcher must not disable sandboxing')
        report.appImageSandboxLaunchersVerified = true
      }
    }
    report.gatekeeperFirstLaunchVerified = false
    phase = 'packaged-media-tools'
    report.mediaTools = await verifyMedia(resources, profile, env)
    record({ event: 'packaged_media_passed', pcmWavRoundTrip: true })
    // This executes the application's real safeStorage path. No injected main,
    // replacement safeStorage, plaintext switch or alternate secret is allowed.
    await start('initial', false)
    await close()
    await start('clean-restart', true)

    phase = 'main-kill'
    let started = Date.now()
    main.child.kill('SIGKILL') // TerminateProcess on Windows; SIGKILL on POSIX.
    await stopped(main, ready, limits.recovery)
    const mainRecovery = { fault: 'main', signal: process.platform === 'win32' ? 'TerminateProcess' : 'SIGKILL', orphanBackendStoppedMs: Date.now() - started }
    report.recoveries.push(mainRecovery)
    await start('after-main-kill', true)
    mainRecovery.resumeVerified = true

    phase = 'backend-kill'
    started = Date.now()
    const backendPid = ready.backendPid
    process.kill(backendPid, 'SIGKILL')
    await until(() => !alive(backendPid), { timeoutMs: limits.recovery, label: 'killed backend termination' })
    // main.cjs displays a blocking native error dialog on some platforms.
    // Observe briefly, then explicitly terminate it before the recovery launch.
    await until(() => main.exited, { timeoutMs: 3000, label: 'backend failure UI exit' }).catch(() => {})
    const forcedMainCleanup = !main.exited
    if (forcedMainCleanup) main.child.kill('SIGKILL')
    await stopped(main, ready, limits.recovery)
    const backendRecovery = { fault: 'backend', signal: process.platform === 'win32' ? 'TerminateProcess' : 'SIGKILL', forcedMainCleanup, stoppedMs: Date.now() - started }
    report.recoveries.push(backendRecovery)
    await start('after-backend-kill', true)
    backendRecovery.resumeVerified = true
    await close()
    report.status = 'passed'
  } catch (error) {
    // Assertions here concern only orchestration metadata, but avoid emitting
    // arbitrary native/library exception strings in uploaded diagnostics.
    report.failure = { phase, kind: error.name, code: error.code || null, message: String(error.message).split('\n')[0].replace(/[a-f0-9]{32,}/gi, '[redacted]').slice(0, 240) }
    if (error.readinessState) report.failure.lastReadinessState = error.readinessState
    if (error.readinessOperation) report.failure.readinessOperation = error.readinessOperation
    if (ready?.pageSocket && !main?.exited) {
      try {
        const snapshot = await cdp(ready.pageSocket, 'Runtime.evaluate', { expression: `({pathname:location.pathname,ready:document.readyState,visibility:document.visibilityState,focused:document.hasFocus(),memoryInputs:document.querySelectorAll('.react-flow__node-memory textarea, .react-flow__node-memory input').length,expectedMemoryVisible:[...document.querySelectorAll('.react-flow__node-memory textarea, .react-flow__node-memory input')].some(element=>element.value==='desktop-persistent-value'&&element.getClientRects().length>0&&getComputedStyle(element).visibility==='visible'),loading:document.body.innerText.includes('Loading')})`, returnByValue: true }, { timeoutMs: 1500 })
        if (snapshot.result?.value) report.failure.browserState = snapshot.result.value
        const screenshot = await cdp(ready.pageSocket, 'Page.captureScreenshot', { format: 'png' }, { timeoutMs: 1500 })
        if (typeof screenshot.data === 'string' && screenshot.data.length < 12 * 1024 * 1024) {
          // The harness owns this fresh synthetic profile, never a user profile.
          await fs.writeFile(path.join(output, 'failure.png'), Buffer.from(screenshot.data, 'base64'))
          report.failure.screenshotCaptured = true
        }
      } catch { /* Preserve the original failure if the renderer is unavailable. */ }
    }
    record({ event: 'acceptance_failed', ...report.failure })
  } finally {
    try {
      if (main?.child.pid) {
        const lease = await profileLease(profile, main.child.pid).catch(() => null)
        if (!main.exited) main.child.kill('SIGKILL')
        const pid = ready?.backendPid || lease?.childPid
        if (pid && alive(pid)) process.kill(pid, 'SIGKILL')
        await until(() => main.exited || main.spawnError, { timeoutMs: 5000, label: 'final main cleanup' })
        if (pid) await until(() => !alive(pid), { timeoutMs: 5000, label: 'final backend cleanup' })
      }
      await fs.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    } catch {
      report.status = 'failed'
      report.cleanupFailed = true
    }
    record({ event: 'acceptance_complete', status: report.status })
    await events
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  }
  assert.equal(report.status, 'passed', `Native acceptance failed during ${phase}; see report.json`)
  return report
}

async function cli(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    assert.ok(['--app', '--dist', '--root', '--artifact', '--output'].includes(args[index]) && args[index + 1] && !options[args[index]], 'Usage: node desktop/acceptance.cjs (--app executable | --dist directory) [--root payload-root] [--artifact installer] --output fresh-directory')
    options[args[index]] = path.resolve(args[index + 1])
  }
  assert.ok(Boolean(options['--app']) !== Boolean(options['--dist']), 'Pass exactly one of --app or --dist')
  assert.ok(options['--output'], 'Pass --output')
  // Prevent stale success evidence from a previous invocation.
  await fs.mkdir(options['--output'])
  try {
    const selected = options['--app'] ? { executable: options['--app'], root: options['--root'] } : await findPackagedApp(options['--dist'])
    await runAcceptance({ ...selected, root: options['--root'] || selected.root, artifact: options['--artifact'], output: options['--output'] })
  } catch (error) {
    await fs.writeFile(path.join(options['--output'], 'runner-failure.json'), JSON.stringify({ status: 'failed', kind: error.name, code: error.code || null }) + '\n')
    throw error
  }
}

module.exports = { alive, until, track, command, waitReady, cdp, profileLease, findPackagedApp, resolveBundle, processExecutablePath, verifyProcessPaths, launchEnvironment, verifyMedia, runAcceptance }
if (require.main === module) cli(process.argv.slice(2)).catch(() => { process.stderr.write('Native desktop acceptance failed; inspect the diagnostics directory.\n'); process.exitCode = 1 })
