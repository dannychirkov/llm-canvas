const test = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { JSDOM } = require('jsdom')
const { createLoader } = require('./loadSource')

async function fixture(t) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://settings.test' })
  const previous = new Map(), requests = [], errors = []
  let status = 'authenticated', current, mounted = true
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: (url, init) => new Promise((resolve, reject) => requests.push({ url, signal: init.signal, resolve, reject })),
  })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  const originalError = console.error
  console.error = (...args) => errors.push(args)
  const { SettingsProvider, useSettings } = createLoader({ 'next-auth/react': { useSession: () => ({ status }) } })('src/components/providers/SettingsProvider.tsx')
  function Consumer() { current = useSettings(); return null }
  const { createRoot } = require('react-dom/client')
  const root = createRoot(dom.window.document.getElementById('root'))
  const render = () => root.render(React.createElement(SettingsProvider, null, React.createElement(Consumer)))
  t.after(async () => {
    if (mounted) await React.act(async () => root.unmount())
    console.error = originalError
    dom.window.close()
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  await React.act(async () => render())
  return { requests, errors, current: () => current,
    async pagehide() { await React.act(async () => dom.window.dispatchEvent(new dom.window.Event('pagehide'))) },
    async pageshow(persisted) { await React.act(async () => dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', { persisted }))) },
    async refresh() { await React.act(async () => dom.window.dispatchEvent(new dom.window.Event('settingsUpdated'))) },
    async session(next) { status = next; await React.act(async () => render()) },
    async unmount() { await React.act(async () => root.unmount()); mounted = false },
    async resolve(index, models) { await React.act(async () => requests[index].resolve(Response.json({ openai: { hasKey: true, activeModels: models } }))) },
    async reject(index, error) { await React.act(async () => requests[index].reject(error)) },
  }
}

test('pagehide cancels the settings request without an error or fallback write', async t => {
  const ui = await fixture(t)
  await ui.pagehide()
  assert.equal(ui.requests[0].signal.aborted, true)
  await ui.reject(0, new TypeError('Fixture document navigation'))
  assert.deepEqual(ui.errors, [])
  assert.equal(ui.current().loaded, false)
})

test('session changes cancel old requests and ignore a late authenticated response', async t => {
  const ui = await fixture(t)
  await ui.session('unauthenticated')
  assert.equal(ui.requests[0].signal.aborted, true)
  await ui.resolve(0, ['stale-private-model'])
  assert.deepEqual(ui.current().providers.openai.activeModels, [])
  await React.act(async () => ui.requests[1].resolve(Response.json({ error: 'Unauthorized' }, { status: 401 })))
  assert.equal(ui.current().loaded, true)
  assert.deepEqual(ui.errors, [])
})

test('a newer settings refresh wins even when the old transport ignores abort', async t => {
  const ui = await fixture(t)
  await ui.refresh()
  assert.equal(ui.requests[0].signal.aborted, true)
  await ui.resolve(1, ['current-model'])
  await ui.resolve(0, ['stale-model'])
  assert.deepEqual(ui.current().providers.openai.activeModels, ['current-model'])
  assert.deepEqual(ui.errors, [])
})

test('cancellation during response parsing cannot overwrite the newer settings', async t => {
  const ui = await fixture(t)
  let finishBody
  await React.act(async () => ui.requests[0].resolve({ ok: true, json: () => new Promise(resolve => { finishBody = resolve }) }))
  await ui.refresh()
  await ui.resolve(1, ['current-model'])
  await React.act(async () => finishBody({ openai: { activeModels: ['stale-body'] } }))
  assert.deepEqual(ui.current().providers.openai.activeModels, ['current-model'])
})

test('unmount aborts the active request and removes its pagehide listener', async t => {
  const ui = await fixture(t)
  await ui.unmount()
  assert.equal(ui.requests[0].signal.aborted, true)
  await ui.reject(0, new DOMException('Fixture cancellation', 'AbortError'))
  assert.deepEqual(ui.errors, [])
})

test('a real settings network failure still reports an error and enables fallback', async t => {
  const ui = await fixture(t)
  await ui.reject(0, new TypeError('Fixture network failure'))
  assert.equal(ui.errors.length, 1)
  assert.equal(ui.errors[0][0], 'Error loading settings:')
  assert.equal(ui.current().loaded, true)
})

test('restoring a cached document reloads settings after pagehide cancellation', async t => {
  const ui = await fixture(t)
  await ui.pagehide()
  await ui.reject(0, new DOMException('Fixture cancellation', 'AbortError'))
  await ui.pageshow(true)
  assert.equal(ui.requests.length, 2)
  await ui.resolve(1, ['restored-model'])
  assert.equal(ui.current().loaded, true)
  assert.deepEqual(ui.current().providers.openai.activeModels, ['restored-model'])
  assert.deepEqual(ui.errors, [])
})

test('ordinary pageshow does not replace an active initial request', async t => {
  const ui = await fixture(t)
  await ui.pageshow(false)
  assert.equal(ui.requests.length, 1)
  assert.equal(ui.requests[0].signal.aborted, false)
  await ui.resolve(0, ['initial-model'])
  assert.deepEqual(ui.current().providers.openai.activeModels, ['initial-model'])
})
