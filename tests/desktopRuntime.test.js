const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { claimProfile, prepareRuntime } = require('../desktop/runtime.cjs')

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-desktop-runtime-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}
test('profile ownership rejects a live main or orphan backend and recovers only dead owners', async t => {
  const root = await fixture(t)
  const lease = await claimProfile(root)
  await assert.rejects(claimProfile(root), /still running/)
  const sleeper = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'])
  t.after(() => sleeper.kill())
  await fs.writeFile(path.join(root, 'runtime.json'), JSON.stringify({ mainPid: sleeper.pid, childPid: sleeper.pid, nonce: randomUUID() }))
  await assert.rejects(claimProfile(root), /still running/)
  const exited = new Promise(resolve => sleeper.once('exit', resolve))
  sleeper.kill()
  await exited
  const recovered = await claimProfile(root)
  await recovered.release()
  await lease.release().catch(() => {})
  await fs.writeFile(path.join(root, 'runtime.json'), 'corrupt')
  await assert.rejects(claimProfile(root))
  for (const incomplete of [{}, { childPid: process.pid }, { mainPid: process.pid, nonce: null }]) {
    const contents = JSON.stringify(incomplete)
    await fs.writeFile(path.join(root, 'runtime.json'), contents)
    await assert.rejects(claimProfile(root), /Invalid desktop lease/)
    assert.equal(await fs.readFile(path.join(root, 'runtime.json'), 'utf8'), contents)
  }
})
test('upgrading build artifacts preserves the profile database/media and resolves bundled dependencies', async t => {
  const root = await fixture(t)
  const server = path.join(root, 'bundle')
  const profile = path.join(root, 'profile')
  for (const directory of ['.next/static', 'public', 'node_modules/test-package', 'prisma/migrations']) await fs.mkdir(path.join(server, directory), { recursive: true })
  await fs.writeFile(path.join(server, '.next/BUILD_ID'), 'first')
  await fs.writeFile(path.join(server, 'external-packages.json'), '[]')
  await fs.writeFile(path.join(server, 'public/logo.svg'), 'public logo')
  await fs.writeFile(path.join(server, 'prisma/schema.prisma'), 'code schema')
  await fs.writeFile(path.join(server, 'node_modules/test-package/index.js'), 'module.exports=42')
  const data = await prepareRuntime(profile, server)
  await fs.writeFile(path.join(data, 'prisma/dev.db'), 'private database')
  await fs.writeFile(path.join(data, 'public/uploads/private.png'), 'private media')
  await fs.writeFile(path.join(server, '.next/BUILD_ID'), 'second')
  assert.equal(await prepareRuntime(profile, server), data)
  assert.equal(await fs.readFile(path.join(data, '.next/BUILD_ID'), 'utf8'), 'second')
  assert.equal(await fs.readFile(path.join(data, 'prisma/dev.db'), 'utf8'), 'private database')
  assert.equal(await fs.readFile(path.join(data, 'public/uploads/private.png'), 'utf8'), 'private media')
  assert.equal(require(path.join(data, 'node_modules/test-package')), 42)
  await assert.rejects(fs.access(path.join(server, 'prisma/dev.db')))
  await assert.rejects(fs.access(path.join(server, 'public/uploads/private.png')))
})
test('backend startup tolerates delayed IPC during module loading while running heartbeat and disconnect guards stay active', async () => {
  const vm = require('node:vm')
  const { EventEmitter } = require('node:events')
  const source = require('node:fs').readFileSync(path.join(__dirname, '../desktop/backend.cjs'), 'utf8')
  function fixture() {
    let now = 0, watchdog
    const exits = [], messages = []
    const process = Object.assign(new EventEmitter(), {
      env: {}, connected: true, umask() {}, chdir() {},
      exit(code) { exits.push(code) }, send(message) { messages.push(message) },
    })
    const requireServer = name => {
      if (name === 'next') { now = 17000; watchdog(); return {} }
      if (name === 'next/dist/server/lib/start-server') return { async startServer() { watchdog(); assert.deepEqual(exits, []) } }
      throw new Error('Unexpected server module')
    }
    vm.runInNewContext(source, {
      process, Date: { now: () => now },
      setInterval(callback) { watchdog = callback; return { unref() {} } },
      setTimeout() { return { unref() {} } },
      require(name) {
        if (name === 'node:path' || name === 'node:module') return require(name)
        if (name === 'node:fs/promises') return { async readFile() { return '{"config":{}}' } }
        if (name === 'node:net') return { createServer() { return { once() {}, listen(_port, _host, ready) { ready() }, address() { return { port: 45678 } }, close(done) { done() } } } }
        if (name === './runtime.cjs') return { serverRequire: () => requireServer }
        throw new Error('Unexpected backend module')
      },
    })
    return { process, exits, messages, watchdog: () => watchdog(), advance: ms => { now += ms } }
  }
  const backend = fixture()
  const handle = backend.process.listeners('message')[0]
  await handle({ type: 'start', mode: 'serve', server: '/synthetic/server', directory: '/synthetic/profile', secret: 'a'.repeat(64) })
  assert.deepEqual(backend.exits, [])
  assert.equal(backend.messages[0].type, 'listening')
  backend.advance(14000)
  await handle({ type: 'heartbeat' })
  backend.advance(14000)
  backend.watchdog()
  assert.deepEqual(backend.exits, [])
  backend.advance(2000)
  backend.watchdog()
  assert.deepEqual(backend.exits, [0])
  const disconnected = fixture()
  disconnected.process.emit('disconnect')
  assert.deepEqual(disconnected.exits, [0])
})
