const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { waitForReadiness } = require('../desktop/smoke.cjs')

const origin = 'http://127.0.0.1:12345'
const options = { origin, pathname: '/dashboard', timeoutMs: 2000, intervalMs: 1 }

function documentAt(pathname, state = {}) {
  return {
    location: { origin, pathname },
    document: { readyState: 'complete', visibilityState: 'visible', hasFocus: () => true, ...state },
  }
}

test('readiness survives navigation context swaps and waits for the final focused document', async () => {
  let attempts = 0, focused = 0
  const states = [
    new Error('Execution context was destroyed.'),
    documentAt('/'),
    new Error('Cannot find context with specified id'),
    documentAt('/dashboard', { visibilityState: 'hidden' }),
    documentAt('/dashboard', { hasFocus: () => false }),
    documentAt('/dashboard', { readyState: 'loading' }),
    documentAt('/dashboard'),
    documentAt('/dashboard'),
  ]
  const evaluate = expression => {
    const state = states[attempts++]
    if (state instanceof Error) throw state
    return vm.runInNewContext(expression, state)
  }
  assert.equal(await waitForReadiness(evaluate, { ...options, bringToFront: () => { focused++ } }), true)
  assert.equal(attempts, states.length)
  assert.equal(focused, attempts)
})

test('wrong final destination times out even when the document is visible, focused and loaded', async () => {
  let attempts = 0
  await assert.rejects(waitForReadiness(expression => {
    attempts++
    return vm.runInNewContext(expression, documentAt('/register'))
  }, { ...options, timeoutMs: 100 }), error => {
    assert.match(error.message, /readiness deadline exceeded for \/dashboard/)
    assert.equal(error.readinessState.pathname, '/register')
    assert.equal(error.readinessState.focused, true)
    return true
  })
  assert.ok(attempts > 0)
})

test('ready registration document succeeds; canvas readiness also waits for rendered content', async () => {
  let attempts = 0
  assert.equal(await waitForReadiness(expression => {
    attempts++
    return vm.runInNewContext(expression, documentAt('/register'))
  }, { ...options, pathname: '/register' }), true)
  assert.equal(attempts, 2)

  attempts = 0
  assert.equal(await waitForReadiness(expression => {
    attempts++
    return vm.runInNewContext(expression, { ...documentAt('/canvas/synthetic'), memoryVisible: attempts >= 3 })
  }, { ...options, pathname: '/canvas/synthetic', contentExpression: 'memoryVisible' }), true)
  assert.equal(attempts, 4)
})

test('non-navigation renderer failures fail immediately and a silent evaluation remains bounded', async () => {
  const failure = new Error('Renderer evaluation failed')
  await assert.rejects(waitForReadiness(() => { throw failure }, options), error => error === failure)
  await assert.rejects(waitForReadiness(() => new Promise(() => {}), { ...options, timeoutMs: 25 }), /readiness deadline exceeded/)
})
test('only an observed unauthenticated registration-page GET settings request can be an expected denial', () => {
  const { publicSettingsProbe } = require('../desktop/smoke.cjs')
  const params = { request: { method: 'GET', url: 'http://127.0.0.1:1234/api/settings' }, documentURL: 'http://127.0.0.1:1234/register' }
  const state = { origin: 'http://127.0.0.1:1234', authenticated: false, resume: false }
  assert.equal(publicSettingsProbe(params, state), true)
  assert.equal(publicSettingsProbe(params, { ...state, authenticated: true }), false)
  assert.equal(publicSettingsProbe(params, { ...state, resume: true }), false)
  assert.equal(publicSettingsProbe({ ...params, documentURL: state.origin + '/dashboard' }, state), false)
  assert.equal(publicSettingsProbe({ ...params, documentURL: 'https://foreign.test/register' }, state), false)
  for (const request of [{ method: 'POST', url: params.request.url }, { method: 'GET', url: state.origin + '/api/canvases' }, { method: 'GET', url: params.request.url + '?unexpected=1' }, { method: 'GET', url: 'https://foreign.test/api/settings' }]) assert.equal(publicSettingsProbe({ ...params, request }, state), false)
})
