const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const vm = require('node:vm')
const { parseVersion, compareVersions, selectRelease, createUpdateChecker,
  RELEASES_API, INITIAL_DELAY_MS, CHECK_INTERVAL_MS, TIMEOUT_MS, COOLDOWN_MS, MAX_RESPONSE_BYTES } = require('../desktop/updates.cjs')

function release(version, names = [`LLM-Canvas-${version}-x64-Setup.exe`], extra = {}) {
  return { tag_name: 'v' + version, draft: false, prerelease: version.includes('-'),
    html_url: 'https://evil.test/release', assets: names.map(name => ({ name, state: 'uploaded', browser_download_url: 'file:///untrusted' })), ...extra }
}
const json = value => new Response(JSON.stringify(value))
const flush = () => new Promise(resolve => setImmediate(resolve))

function scheduler() {
  const jobs = new Map()
  let currentTime = 0
  const add = (callback, ms, repeat) => { const id = { unref() {} }; jobs.set(id, { callback, ms, repeat }); return id }
  return { jobs, now: () => currentTime, advance: ms => { currentTime += ms }, timers: {
    setTimeout: (callback, ms) => add(callback, ms, false), clearTimeout: id => jobs.delete(id),
    setInterval: (callback, ms) => add(callback, ms, true), clearInterval: id => jobs.delete(id),
  }, fire(ms) {
    const entry = [...jobs].find(([, job]) => job.ms === ms)
    assert.ok(entry, `Expected scheduled timer ${ms}`)
    if (!entry[1].repeat) jobs.delete(entry[0])
    currentTime += ms
    entry[1].callback()
  } }
}

function fixture(t, overrides = {}) {
  const clock = scheduler(), requests = [], dialogs = [], opened = []
  const checker = createUpdateChecker({ version: '0.1.0-rc.6', platform: 'win32', arch: 'x64', isPackaged: true, env: {}, timers: clock.timers, now: clock.now,
    fetch: async (url, options) => { requests.push({ url, options }); return json([release('0.1.0-rc.10')]) },
    showMessageBox: async options => { dialogs.push(options); return { response: 1 } },
    openExternal: async url => { opened.push(url) }, ...overrides })
  t.after(() => checker.stop())
  return { checker, clock, requests, dialogs, opened }
}

test('SemVer compares numeric RC identifiers, stable releases, metadata and large integers', () => {
  const ordered = ['0.1.0-alpha', '0.1.0-alpha.1', '0.1.0-alpha.beta', '0.1.0-beta', '0.1.0-beta.2', '0.1.0-beta.11', '0.1.0-rc.1', '0.1.0-rc.9', '0.1.0-rc.10', '0.1.0', '0.1.1', '0.2.0', '1.0.0']
  for (let i = 1; i < ordered.length; i++) {
    assert.equal(compareVersions(ordered[i - 1], ordered[i]), -1)
    assert.equal(compareVersions(ordered[i], ordered[i - 1]), 1)
  }
  assert.equal(compareVersions('v0.1.0-rc.10+build.1', '0.1.0-rc.10+build.2'), 0)
  assert.equal(compareVersions('99999999999999999999.0.0', '99999999999999999998.0.0'), 1)
  for (const value of ['0.1', '01.1.0', '1.0.0-rc.01', '1.0.0-', '1.0.0\n', 'v1.0.0/../../evil', '', null, '1.0.0+' + 'x'.repeat(128)]) assert.equal(parseVersion(value), null)
  assert.throws(() => compareVersions('bad', '1.0.0'), /Invalid/)
})

test('release selection sorts SemVer, excludes drafts/malformed tags and keeps stable channel stable', () => {
  const releases = [release('0.1.0-rc.9'), release('0.1.0-rc.10'), release('0.1.0-rc.11', [], { draft: true }), release('invalid')]
  assert.equal(selectRelease(releases, '0.1.0-rc.6', 'win32', 'x64').version, '0.1.0-rc.10')
  releases.push(release('0.1.0'), release('0.2.0-rc.1'), release('0.3.0', undefined, { prerelease: true }))
  assert.equal(selectRelease(releases, '0.0.9', 'win32', 'x64').version, '0.1.0')
  assert.equal(selectRelease(releases, '0.1.0-rc.6', 'win32', 'x64').version, '0.3.0')
  assert.deepEqual(selectRelease([release('0.1.0-rc.6+other')], '0.1.0-rc.6', 'win32', 'x64'), { status: 'current' })
  assert.deepEqual(selectRelease([release('0.1.0')], '0.2.0', 'win32', 'x64'), { status: 'current' })
})

test('downloads use the actual compatible asset and a constructed repository URL', () => {
  const names = ['LLM-Canvas-0.1.0-x64.tar.gz', 'LLM-Canvas-0.1.0-x64-Setup.exe.blockmap',
    'LLM-Canvas-0.1.0-x64-Setup.exe', 'LLM-Canvas-0.1.0-arm64.dmg', 'LLM-Canvas-0.1.0-x86_64.AppImage']
  for (const [platform, arch, name] of [['win32', 'x64', names[2]], ['darwin', 'arm64', names[3]], ['linux', 'x64', names[4]]]) {
    const selected = selectRelease([release('0.1.0', names)], '0.1.0-rc.6', platform, arch)
    assert.equal(selected.status, 'available')
    assert.equal(selected.url, 'https://github.com/dannychirkov/llm-canvas/releases/download/v0.1.0/' + name)
  }
  assert.equal(selectRelease([release('0.1.0', ['LLM-Canvas-0.1.0-x64.AppImage'])], '0.0.9', 'linux', 'x64').status, 'available')
  for (const [platform, arch] of [['darwin', 'x64'], ['linux', 'arm64'], ['win32', 'arm64']]) assert.equal(selectRelease([release('0.1.0', names)], '0.0.9', platform, arch).status, 'incompatible')
  for (const name of ['../../LLM-Canvas-0.1.0-x64-Setup.exe', 'LLM-Canvas-0.1.0-arm64-Setup.exe', 'LLM-Canvas-0.1.0-x64-Setup.exe?x']) assert.equal(selectRelease([release('0.1.0', [name])], '0.0.9', 'win32', 'x64').status, 'incompatible')
  const pendingAsset = release('0.1.0'); pendingAsset.assets[0].state = 'new'
  assert.equal(selectRelease([pendingAsset], '0.0.9', 'win32', 'x64').status, 'incompatible')
})

test('selection prefers the latest compatible newer release over source-only or wrong-CPU releases', () => {
  const releases = [release('0.1.0-rc.12', ['source.zip']), release('0.1.0-rc.11', ['LLM-Canvas-0.1.0-rc.11-arm64.dmg']),
    release('0.1.0-rc.10'), release('0.1.0-rc.9')]
  assert.equal(selectRelease(releases, '0.1.0-rc.6', 'win32', 'x64').version, '0.1.0-rc.10')
  assert.deepEqual(selectRelease(releases.slice(0, 2), '0.1.0-rc.6', 'win32', 'x64'), { status: 'incompatible', version: '0.1.0-rc.12' })
  assert.equal(selectRelease(releases, '0.1.0-rc.10', 'win32', 'x64').status, 'incompatible')
})

test('release feeds and fetch policy are fixed; stable checks cannot follow prereleases', async t => {
  const prerelease = fixture(t)
  await prerelease.checker.check({ manual: true })
  assert.equal(prerelease.requests[0].url, RELEASES_API + '?per_page=100')
  const { options } = prerelease.requests[0]
  assert.equal(options.redirect, 'error')
  assert.equal(options.credentials, 'omit')
  assert.ok(options.signal instanceof AbortSignal)
  const stable = fixture(t, { version: '0.1.0', fetch: async url => { assert.equal(url, RELEASES_API + '/latest'); return json(release('0.1.1')) } })
  await stable.checker.check({ manual: true })
  assert.match(stable.dialogs[0].message, /0\.1\.1 is available/)
})

test('download requires dialog consent and uses only the trusted constructed URL', async t => {
  const accepted = fixture(t, { showMessageBox: async () => ({ response: 0 }) })
  await accepted.checker.check({ manual: true })
  assert.deepEqual(accepted.opened, ['https://github.com/dannychirkov/llm-canvas/releases/download/v0.1.0-rc.10/LLM-Canvas-0.1.0-rc.10-x64-Setup.exe'])
  const dismissed = fixture(t)
  await dismissed.checker.check({ manual: true })
  assert.equal(dismissed.opened.length, 0)
  assert.equal(dismissed.dialogs[0].defaultId, 1)
  assert.equal(dismissed.dialogs[0].cancelId, 1)
})

test('checks share one request and dialog, including manual checks joining automatic checks', async t => {
  let deliver, calls = 0
  const f = fixture(t, { fetch: () => { calls++; return new Promise(resolve => { deliver = resolve }) } })
  const first = f.checker.check()
  assert.equal(f.checker.check({ manual: true }), first)
  assert.equal(f.checker.check({ manual: true }), first)
  deliver(json([release('0.1.0-rc.6')]))
  await first
  assert.equal(calls, 1)
  assert.equal(f.dialogs.length, 1)
  assert.match(f.dialogs[0].message, /No newer release/)
})

test('each new version prompts automatically only once per process; manual rechecks can prompt again', async t => {
  let version = '0.1.0-rc.10'
  const f = fixture(t, { fetch: async () => json([release(version)]) })
  await f.checker.check(); await f.checker.check()
  assert.equal(f.dialogs.length, 1)
  await f.checker.check({ manual: true })
  assert.equal(f.dialogs.length, 2)
  version = '0.1.0-rc.11'
  f.clock.advance(COOLDOWN_MS)
  await f.checker.check(); await f.checker.check()
  assert.equal(f.dialogs.length, 3)
})

test('completed checks, including failures, reuse results for 60 seconds without hammering the API', async t => {
  for (const failing of [false, true]) {
    let calls = 0
    const f = fixture(t, { fetch: async () => { calls++; if (failing) throw new Error('offline'); return json([release('0.1.0-rc.6')]) } })
    await f.checker.check({ manual: true })
    await f.checker.check({ manual: true })
    f.clock.advance(COOLDOWN_MS - 1)
    await f.checker.check({ manual: true })
    assert.equal(calls, 1)
    assert.equal(f.dialogs.length, 3)
    assert.match(f.dialogs[2].message, failing ? /Unable to complete/ : /No newer release/)
    f.clock.advance(1)
    await f.checker.check({ manual: true })
    assert.equal(calls, 2)
  }
})

test('malformed API responses never claim the application is current', async t => {
  for (const body of [null, {}, ['invalid'], [null], [release('0.1.0-rc.6', [], { assets: null })], [release('0.1.0-rc.6', [], { draft: undefined })]]) {
    const f = fixture(t, { fetch: async () => json(body) })
    await f.checker.check({ manual: true })
    assert.match(f.dialogs[0].message, /Unable to complete/)
    assert.doesNotMatch(f.dialogs[0].message, /No newer release/)
  }
})

test('unsupported newer builds and unavailable feeds give honest manual results and silent automatic results', async t => {
  const missing = fixture(t, { fetch: async () => json([release('0.1.0-rc.10', ['source.zip'])]) })
  await missing.checker.check()
  assert.equal(missing.dialogs.length, 0)
  await missing.checker.check({ manual: true })
  assert.match(missing.dialogs[0].message, /available, but has no installer for win32\/x64/)
  const empty = fixture(t, { fetch: async () => json([]) })
  await empty.checker.check({ manual: true })
  assert.match(empty.dialogs[0].message, /Unable to complete/)
})

test('network, HTTP, invalid JSON/schema and oversized responses are bounded and sanitized', async t => {
  for (const fetch of [async () => { throw new Error('secret upstream diagnostic') },
    async () => new Response('private body', { status: 500 }), async () => new Response('private invalid JSON'),
    async () => json({ unexpected: 'secret' }), async () => json(Array(101).fill(release('0.1.0'))),
    async () => new Response('small', { headers: { 'content-length': String(MAX_RESPONSE_BYTES + 1) } }),
    async () => new Response('x'.repeat(MAX_RESPONSE_BYTES + 1))]) {
    const f = fixture(t, { fetch })
    await f.checker.check()
    assert.equal(f.dialogs.length, 0)
    await f.checker.check({ manual: true })
    assert.equal(f.dialogs.length, 1)
    assert.match(f.dialogs[0].message, /Unable to complete/)
    assert.doesNotMatch(JSON.stringify(f.dialogs), /secret|private|upstream/)
    assert.equal(f.clock.jobs.size, 0)
  }
  for (const status of [403, 429]) {
    const f = fixture(t, { fetch: async () => new Response('do not show', { status }) })
    await f.checker.check({ manual: true })
    assert.match(f.dialogs[0].detail, /GitHub is limiting/)
  }
})

test('deadline bounds stalled fetch and body reads, aborting and allowing a later retry', async t => {
  for (const stalledBody of [false, true]) {
    let signal, cancelled = false, stalled = true
    const f = fixture(t, { fetch: async (_url, options) => {
      signal = options.signal
      if (!stalled) return json([release('0.1.0-rc.10')])
      return stalledBody ? new Response(new ReadableStream({ cancel() { cancelled = true } })) : new Promise(() => {})
    } })
    const pending = f.checker.check({ manual: true })
    await flush()
    f.clock.fire(TIMEOUT_MS)
    await pending
    assert.equal(signal.aborted, true)
    assert.equal(cancelled, stalledBody)
    assert.match(f.dialogs[0].detail, /timed out/)
    assert.equal(f.clock.jobs.size, 0)
    stalled = false
    f.clock.advance(COOLDOWN_MS)
    await f.checker.check({ manual: true })
    assert.match(f.dialogs[1].message, /is available/)
  }
})

test('native dialog errors, including synchronous throws, never escape a check', async t => {
  for (const showMessageBox of [() => { throw new Error('window closed') }, async () => { throw new Error('window closed') }]) {
    const f = fixture(t, { showMessageBox })
    await assert.doesNotReject(f.checker.check({ manual: true }))
  }
})

test('packaged automatic checks wait 30 seconds then repeat every six hours and stop cleanly', async t => {
  const f = fixture(t)
  f.checker.start(); f.checker.start()
  assert.equal(f.requests.length, 0)
  assert.equal(f.clock.jobs.size, 1)
  f.clock.fire(INITIAL_DELAY_MS)
  await flush()
  assert.equal(f.requests.length, 1)
  f.clock.fire(CHECK_INTERVAL_MS)
  await flush()
  assert.equal(f.requests.length, 2)
  assert.equal(f.dialogs.length, 1)
  f.checker.stop(); f.checker.start()
  assert.equal(f.clock.jobs.size, 0)
  await f.checker.check({ manual: true })
  assert.equal(f.requests.length, 2)
})

test('development and explicit opt-out disable only automatic checks', async t => {
  for (const options of [{ isPackaged: false }, { env: { LLM_CANVAS_DISABLE_UPDATE_CHECKS: '1' } }]) {
    const f = fixture(t, options)
    f.checker.start()
    await f.checker.check()
    assert.equal(f.clock.jobs.size, 0)
    assert.equal(f.requests.length, 0)
    await f.checker.check({ manual: true })
    assert.equal(f.requests.length, 1)
  }
  const enabled = fixture(t, { env: { LLM_CANVAS_DISABLE_UPDATE_CHECKS: '0' } })
  enabled.checker.start()
  assert.equal(enabled.clock.jobs.size, 1)
})

test('shutdown cancels delayed checks and in-flight networking without a dialog', async t => {
  const delayed = fixture(t)
  delayed.checker.start(); delayed.checker.stop()
  assert.equal(delayed.clock.jobs.size, 0)
  assert.equal(delayed.requests.length, 0)
  let signal
  const active = fixture(t, { fetch: (_url, options) => { signal = options.signal; return new Promise(() => {}) } })
  active.checker.start()
  const pending = active.checker.check({ manual: true })
  active.checker.stop()
  await pending
  assert.equal(signal.aborted, true)
  assert.equal(active.clock.jobs.size, 0)
  assert.equal(active.dialogs.length, 0)
})

test('shutdown while a native prompt is open cannot launch a browser', async t => {
  let answer
  const f = fixture(t, { showMessageBox: () => new Promise(resolve => { answer = resolve }) })
  const pending = f.checker.check({ manual: true })
  await flush()
  f.checker.stop()
  answer({ response: 0 })
  await pending
  assert.equal(f.opened.length, 0)
})

test('main process restores the Help menu after window policy and preserves the Electron net.fetch receiver', async t => {
  const events = [], app = new EventEmitter(), requests = [], dialogs = []
  Object.assign(app, { isPackaged: true, setName() {}, enableSandbox() {}, requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), getPath: () => '/isolated', getVersion: () => '0.1.0-rc.6',
    commandLine: { hasSwitch: () => false }, quit() {} })
  class Window {
    once() {}
    show() {}
    setMenu(menu) { this.menu = menu; events.push('window-menu') }
    async loadURL() { events.push('loaded') }
  }
  const net = { async fetch(url) { assert.equal(this, net); requests.push(url); return json([release('0.1.0-rc.10')]) } }
  let template
  const electron = { app, BrowserWindow: Window, net, safeStorage: { isEncryptionAvailable() {} }, session: { defaultSession: {} },
    dialog: { showErrorBox() { assert.fail('Unexpected startup failure') }, async showMessageBox(_window, options) { dialogs.push(options); return { response: 1 } } },
    shell: { async openExternal() { assert.fail('Dismissed update opened a URL') } },
    Menu: { buildFromTemplate(value) { template = value; return value }, setApplicationMenu() { events.push('application-menu') } } }
  let pid = 100
  const modules = { electron, 'node:path': require('node:path'),
    'node:fs/promises': { writeFile: async () => {}, access: async () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error } },
    'node:child_process': { fork() {
      const child = Object.assign(new EventEmitter(), { pid: ++pid, connected: true, send(message) {
        if (message.type === 'start') queueMicrotask(() => message.mode === 'migrate' ? child.emit('exit', 0) : child.emit('message', { type: 'listening', origin: 'http://127.0.0.1:4321' }))
        if (message.type === 'stop') queueMicrotask(() => child.emit('exit', 0))
      }, kill() {} })
      queueMicrotask(() => child.emit('spawn'))
      return child
    } },
    './profile.cjs': { loadAuthSecret: async () => 'fixture' },
    './runtime.cjs': { claimProfile: async () => ({ child: async () => {}, release: async () => {} }), prepareRuntime: async () => '/isolated/data' },
    './window-policy.cjs': { installWindowPolicy() { events.push('remove-menu') } },
    './updates.cjs': require('../desktop/updates.cjs') }
  t.after(() => app.emit('before-quit', { preventDefault() {} }))
  vm.runInNewContext(fs.readFileSync(require.resolve('../desktop/main.cjs'), 'utf8'), {
    __dirname: require('node:path').dirname(require.resolve('../desktop/main.cjs')),
    require: name => { assert.ok(Object.hasOwn(modules, name), name); return modules[name] },
    process: { platform: 'linux', env: { LLM_CANVAS_DISABLE_UPDATE_CHECKS: '1' }, resourcesPath: '/bundle', stderr: { write() {} } },
    fetch: async () => ({ ok: true }), setTimeout, clearTimeout, setInterval, clearInterval,
  })
  await flush()
  assert.deepEqual(events, ['remove-menu', 'application-menu', 'window-menu', 'loaded'])
  template.find(item => item.role === 'help').submenu[0].click()
  await flush()
  assert.equal(requests.length, 1)
  assert.match(dialogs[0].message, /0\.1\.0-rc\.10 is available/)
})
