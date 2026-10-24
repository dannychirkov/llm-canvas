const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')
const { createHash } = require('node:crypto')
const { spawn } = require('node:child_process')
const { alive, until, track, command, waitReady, cdp, findPackagedApp, resolveBundle, verifyProcessPaths, launchEnvironment, verifyMedia } = require('../desktop/acceptance.cjs')

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-acceptance-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return root
}

async function sleeper(t) {
  const state = track(spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }))
  t.after(async () => {
    if (!state.exited) state.child.kill('SIGKILL')
    await until(() => state.exited, { timeoutMs: 5000, label: 'fixture child cleanup' })
  })
  await new Promise((resolve, reject) => { state.child.once('spawn', resolve); state.child.once('error', reject) })
  return state
}

async function server(t, handler) {
  const fixture = http.createServer(handler)
  const connections = new Set()
  fixture.on('connection', socket => { connections.add(socket); socket.once('close', () => connections.delete(socket)) })
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { for (const socket of connections) socket.destroy(); fixture.close(resolve) }))
  return fixture
}

// A real socket handshake and tiny server-side text frame are enough for these
// two CDP methods. Nothing here simulates Electron, keychain or browser smoke.
function protocol(fixture, reply) {
  fixture.on('upgrade', (request, socket) => {
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    socket.once('data', () => {
      const payload = Buffer.from(JSON.stringify({ id: 1, result: reply() }))
      assert.ok(payload.length < 126)
      socket.end(Buffer.concat([Buffer.from([0x81, payload.length]), payload]))
    })
    socket.on('error', () => {})
  })
}

test('readiness waits for an application page and proves both CDP and isolated lease ownership', async t => {
  const root = await temporary(t)
  const main = await sleeper(t), backend = await sleeper(t)
  let pageAvailable = false
  const backendServer = await server(t, (_request, response) => response.end('{"status":"healthy"}'))
  const origin = `http://127.0.0.1:${backendServer.address().port}`
  const debuggerServer = await server(t, (request, response) => {
    const socket = `ws://127.0.0.1:${debuggerServer.address().port}/devtools/browser/fixture`
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(request.url === '/json/version' ? { webSocketDebuggerUrl: socket } : pageAvailable ? [{ type: 'page', url: origin + '/register', webSocketDebuggerUrl: socket }] : []))
  })
  let browserPid = main.child.pid
  protocol(debuggerServer, () => ({ processInfo: [{ type: 'browser', id: browserPid }] }))
  await fs.mkdir(path.join(root, 'data', 'prisma'), { recursive: true })
  await fs.writeFile(path.join(root, 'data', 'prisma', 'dev.db'), 'test fixture, never a real database')
  await fs.writeFile(path.join(root, 'auth-secret.bin'), Buffer.from([0x76, 0x31, 0x30, 0xff]))
  await fs.writeFile(path.join(root, 'runtime.json'), JSON.stringify({ mainPid: main.child.pid, childPid: backend.child.pid }))
  const options = { profile: root, main, port: debuggerServer.address().port, timeoutMs: 2000 }
  let finished = false
  const waiting = waitReady(options).then(result => { finished = true; return result })
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(finished, false, 'An empty debugger endpoint is not app readiness')
  pageAvailable = true
  const ready = await waiting
  assert.equal(ready.backendPid, backend.child.pid)
  assert.equal(ready.origin, origin)

  browserPid = backend.child.pid
  await assert.rejects(waitReady(options), /CDP does not belong/)
  browserPid = main.child.pid
  await fs.writeFile(path.join(root, 'runtime.json'), JSON.stringify({ mainPid: backend.child.pid, childPid: main.child.pid }))
  await assert.rejects(waitReady(options), /isolated profile/)
})

test('readiness rejects a plaintext secret and an app that exits before CDP', async t => {
  const root = await temporary(t)
  const main = await sleeper(t), backend = await sleeper(t)
  const fixture = await server(t, (request, response) => {
    const port = fixture.address().port
    const webSocketDebuggerUrl = `ws://127.0.0.1:${port}/devtools/browser/fixture`
    response.end(JSON.stringify(request.url === '/json/version' ? { webSocketDebuggerUrl } : [{ type: 'page', url: `http://127.0.0.1:${port}/register`, webSocketDebuggerUrl }]))
  })
  protocol(fixture, () => ({ processInfo: [{ type: 'browser', id: main.child.pid }] }))
  await fs.writeFile(path.join(root, 'runtime.json'), JSON.stringify({ mainPid: main.child.pid, childPid: backend.child.pid }))
  await fs.writeFile(path.join(root, 'auth-secret.bin'), 'a'.repeat(64))
  const options = { profile: root, main, port: fixture.address().port, timeoutMs: 1000 }
  await assert.rejects(waitReady(options), /encrypted authentication secret/)
  main.child.kill('SIGKILL')
  await until(() => main.exited, { timeoutMs: 5000, label: 'test main termination' })
  await assert.rejects(waitReady(options), /exited before readiness/)
})

test('a hung smoke child is forcibly stopped and releases its listener within the deadline', async t => {
  const root = await temporary(t)
  const marker = path.join(root, 'child.json')
  const source = `const fs=require('node:fs');const server=require('node:net').createServer();server.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,port:server.address().port})))`
  await assert.rejects(command(process.execPath, ['-e', source, marker], { timeoutMs: 1500 }), /Deadline exceeded/)
  const { pid, port } = JSON.parse(await fs.readFile(marker, 'utf8'))
  assert.equal(alive(pid), false)
  await new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => { socket.destroy(); reject(new Error('Timed-out smoke still has a listener')) })
    socket.once('error', error => { assert.equal(error.code, 'ECONNREFUSED'); resolve() })
  })
})

test('child failure and protocol silence cannot produce success evidence', async t => {
  assert.equal(await command(process.execPath, ['-e', 'process.stdout.write("ok")'], { timeoutMs: 3000 }), 'ok')
  await assert.rejects(command(process.execPath, ['-e', 'process.stderr.write("private-value\\n at smoke.cjs:51:2\\n");process.exit(1)'], { timeoutMs: 3000 }), error => {
    assert.match(error.message, /Acceptance child failed at smoke\.cjs:51/)
    assert.equal(error.message.includes('private-value'), false)
    return true
  })
  await assert.rejects(command(process.execPath, ['-e', 'process.stderr.write("private-diagnostic");process.exit(7)'], { timeoutMs: 3000 }), error => {
    assert.match(error.message, /Acceptance child failed/)
    assert.equal(error.message.includes('private-diagnostic'), false)
    return true
  })
  const fixture = await server(t, (_request, response) => response.end('[]'))
  fixture.on('upgrade', (_request, socket) => socket.on('error', () => {}))
  await assert.rejects(cdp(`ws://127.0.0.1:${fixture.address().port}/silent`, 'SystemInfo.getProcessInfo', {}, { timeoutMs: 100 }), /CDP deadline/)
})

test('native executable discovery refuses ambiguous output and preserves spaces', async t => {
  const root = await temporary(t)
  const app = path.join(root, 'win-unpacked', 'LLM Canvas.exe')
  await fs.mkdir(path.dirname(app))
  await fs.writeFile(app, 'fixture')
  assert.equal((await findPackagedApp(root, 'win32')).executable, app)
  await fs.mkdir(path.join(root, 'win-arm64-unpacked'))
  await assert.rejects(findPackagedApp(root, 'win32'), /exactly one/)
})

test('artifact payload discovery accepts a DMG-copied app and extracted AppRun independently of build output', async t => {
  const root = await temporary(t)
  const mac = path.join(root, 'copied'), linux = path.join(root, 'extracted')
  const macExecutable = path.join(mac, 'LLM Canvas.app', 'Contents', 'MacOS', 'LLM Canvas')
  const appRun = path.join(linux, 'squashfs-root', 'AppRun')
  for (const filename of [macExecutable, appRun]) {
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await fs.writeFile(filename, 'fixture')
  }
  assert.equal((await findPackagedApp(mac, 'darwin')).executable, macExecutable)
  assert.equal((await findPackagedApp(linux, 'linux')).executable, appRun)
})

test('an explicit AppRun root resolves packaged resources and rejects a backend symlink escaping the payload', async t => {
  const directory = await temporary(t)
  const root = path.join(directory, 'isolated payload')
  const runtime = path.join(root, 'resources', 'server', 'runtime')
  await fs.mkdir(runtime, { recursive: true })
  for (const filename of [path.join(root, 'AppRun'), path.join(root, 'llm-canvas'), path.join(runtime, 'node')]) await fs.writeFile(filename, 'fixture')
  const bundle = await resolveBundle(path.join(root, 'AppRun'), root, 'linux')
  assert.equal(bundle.resources, await fs.realpath(path.join(root, 'resources')))
  assert.equal(bundle.nativeExecutable, await fs.realpath(path.join(root, 'llm-canvas')))
  await fs.rm(runtime, { recursive: true })
  const outside = path.join(directory, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, 'node'), 'outside payload')
  await fs.symlink(outside, runtime, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(resolveBundle(path.join(root, 'AppRun'), root, 'linux'), /escapes its root/)
})

test('OS executable path inspection proves live children use the selected payload and rejects another root', async t => {
  const main = await sleeper(t), backend = await sleeper(t)
  const node = await fs.realpath(process.execPath)
  const bundle = { root: path.dirname(node), nativeExecutable: node, backendExecutable: node }
  const proven = await verifyProcessPaths(main.child.pid, backend.child.pid, bundle)
  assert.equal(proven.main, path.basename(node))
  assert.equal(proven.backend, path.basename(node))
  await assert.rejects(verifyProcessPaths(main.child.pid, backend.child.pid, { ...bundle, nativeExecutable: path.join(bundle.root, 'different-app') }), /does not use the selected artifact payload/)
  const outside = await temporary(t)
  await assert.rejects(verifyProcessPaths(main.child.pid, backend.child.pid, { ...bundle, root: outside }), /escapes its root/)
})

test('packaged media acceptance refuses a Node wrapper before executing it', async t => {
  const root = await temporary(t)
  const bin = path.join(root, 'server', 'media-tools', 'bin')
  await fs.mkdir(bin, { recursive: true })
  const marker = path.join(root, 'wrapper-executed')
  const filename = path.join(bin, 'ffmpeg' + (process.platform === 'win32' ? '.exe' : ''))
  await fs.writeFile(filename, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'executed')\n`, { mode: 0o700 })
  await assert.rejects(verifyMedia(root, root, process.env), /native executable, never a script wrapper/)
  await assert.rejects(fs.access(marker), { code: 'ENOENT' })
})

test('launch environment keeps real OS identity and external keyring but drops shell credentials and overrides', () => {
  const env = launchEnvironment('/isolated', {
    PATH: '/bin', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\runner', APPDATA: 'C:\\Users\\runner\\AppData\\Roaming',
    HOME: '/runner', DISPLAY: ':99', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/private-bus', XDG_DATA_HOME: '/private-keyring',
    AUTH_SECRET: 'do-not-inherit', DATABASE_URL: 'file:live.db', NODE_OPTIONS: '--require=inject.cjs', ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_DISABLE_SANDBOX: '1', LLM_CANVAS_DESKTOP_SERVER: '/unpackaged', XDG_CONFIG_HOME: '/personal', PROVIDER_API_KEY: 'secret',
  })
  assert.equal(env.USERPROFILE, 'C:\\Users\\runner')
  assert.equal(env.SystemRoot, 'C:\\Windows')
  assert.equal(env.APPDATA, 'C:\\Users\\runner\\AppData\\Roaming')
  assert.equal(env.DBUS_SESSION_BUS_ADDRESS, 'unix:path=/private-bus')
  assert.equal(env.XDG_DATA_HOME, '/private-keyring')
  assert.equal(env.XDG_CONFIG_HOME, path.join('/isolated', 'xdg-config'))
  assert.equal(env.LLM_CANVAS_PROFILE, '/isolated')
  for (const key of ['AUTH_SECRET', 'DATABASE_URL', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_DISABLE_SANDBOX', 'LLM_CANVAS_DESKTOP_SERVER', 'PROVIDER_API_KEY']) assert.equal(env[key], undefined)
})
