const test = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { JSDOM } = require('jsdom')
const { createLoader } = require('./loadSource')

async function setup(t, options = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://setup.test/settings' })
  const previous = new Map(), requests = [], endpoints = []
  let failSave = Boolean(options.failSave), failRefresh = Boolean(options.failRefresh)
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, init = {}) => {
      const body = JSON.parse(init.body || '{}')
      requests.push({ url, body })
      if (url === '/api/providers/custom') {
        if (failSave) { failSave = false; return Response.json({ error: 'Could not save provider' }, { status: 500 }) }
        let stored = endpoints.find(e => e.id === body.id)
        if (!stored) { stored = { id: `endpoint-${endpoints.length + 1}` }; endpoints.push(stored) }
        Object.assign(stored, { label: body.label, baseUrl: body.baseUrl, models: body.models, authStyle: body.authStyle, apiType: body.apiType, chatApi: body.chatApi, hasKey: Boolean(body.apiKey || stored.hasKey), hasWorkflow: Boolean(body.workflow || stored.hasWorkflow), contextWindow: body.contextWindow })
        return Response.json(stored)
      }
      if (url === '/api/providers/custom/validate') {
        assert.deepEqual(Object.keys(body), ['endpointId'], 'Discovery must use the stored server credential')
        if (options.discoveryFailure) return Response.json({ error: 'Models endpoint not found; enter models manually' }, { status: 404 })
        return Response.json({ models: ['fixture-small', 'fixture-large'], modelsWithCapabilities: [{ id: 'fixture-small', contextWindow: 32000 }, { id: 'fixture-large', contextWindow: 200000 }], modelContextWindows: { 'fixture-small': 32000, 'fixture-large': 200000 }, latencyMs: 12 })
      }
      if (url === '/api/providers/openai/models') return Response.json({ modelsWithCapabilities: ['gpt-5.1', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1'].map(id => ({ id })) })
      if (url === '/api/settings') return Response.json({ ok: true })
      throw new Error('Unexpected fixture route: ' + url)
    },
  }
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  const context = React.createContext(null)
  const block = ({ children, onClick }) => React.createElement('div', { onClick, 'data-card': '' }, children)
  const button = ({ children, onClick, disabled, ...props }) => React.createElement('button', { onClick, disabled, 'aria-label': props['aria-label'] }, children)
  const load = createLoader({
    '@/components/providers/SettingsProvider': { useSettings: () => React.useContext(context) },
    'next/navigation': { useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push() {} }) },
    '@lobehub/icons': { OpenAI: () => null, Gemini: () => null, OpenRouter: () => null },
    '@/components/ui/card': Object.fromEntries(['Card', 'CardContent', 'CardHeader', 'CardTitle', 'CardDescription'].map(name => [name, block])),
    '@/components/ui/button': { Button: button },
    '@/components/ui/progress': { Progress: () => null },
    '@/components/ui/tabs': Object.fromEntries(['Tabs', 'TabsContent', 'TabsList', 'TabsTrigger'].map(name => [name, block])),
    './ProviderCardShell': ({ title, children }) => React.createElement('section', null, React.createElement('h3', null, title), children),
    './ModelSelectionModal': ({ open, availableModels, onSave, onOpenChange }) => open ? React.createElement('button', { onClick: async () => { await onSave(availableModels.map(m => m.id)); onOpenChange(false) } }, 'Use discovered models') : null,
    './ProviderCompactCard': () => null,
    './InviteManagement': () => null,
    './UserStorageManagement': () => null,
  })
  const SettingsTabs = load('src/components/settings/SettingsTabs.tsx').default
  const providers = Object.fromEntries(['openai', 'gemini', 'openrouter'].map(id => [id, { hasKey: false, activeModels: [] }]))
  const { createRoot } = require('react-dom/client')
  const root = createRoot(dom.window.document.getElementById('root'))
  function Harness() {
    const [customEndpoints, setEndpoints] = React.useState([])
    const refresh = async () => {
      if (failRefresh) { failRefresh = false; throw new Error('Settings refresh failed') }
      setEndpoints(endpoints.map(e => ({ ...e })))
    }
    return React.createElement(context.Provider, { value: { customEndpoints, refresh, providers } }, React.createElement(SettingsTabs, { providers, loaded: true, onProviderUpdate: async () => {}, onModelsUpdate: async () => {}, onTestKey: async () => ({ valid: true }), selectionMode: 'default', onSelectionModeChange() {} }))
  }
  t.after(async () => {
    await React.act(async () => root.unmount())
    dom.window.close()
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  await React.act(async () => root.render(React.createElement(Harness)))
  const document = dom.window.document
  function byButton(label) {
    const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === label)
    assert.ok(b, 'Expected button: ' + label)
    return b
  }
  async function click(label) { const b = byButton(label); assert.equal(b.disabled, false, label + ' is disabled'); await React.act(async () => b.click()) }
  async function choose(name) {
    const heading = [...document.querySelectorAll('h3')].find(e => e.textContent === name)
    assert.ok(heading, 'Provider choice missing: ' + name)
    await React.act(async () => heading.closest('[data-card]').click())
    await click('Next')
  }
  async function input(label, value) {
    const element = label === 'Manual model ID' ? document.querySelector('[aria-label="Manual model ID"]') : document.getElementById([...document.querySelectorAll('label')].find(e => e.textContent === label)?.htmlFor)
    assert.ok(element, 'Expected field: ' + label)
    const prototype = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
    await React.act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
  }
  async function custom() { await choose('Custom endpoint'); await input('Provider name', 'Fixture gateway'); await input('Base URL', 'https://fixture.test/v1'); await input('API key', 'synthetic-setup-key') }
  return { document, requests, endpoints, click, choose, input, custom, byButton, text: () => document.body.textContent }
}

test('first-run wizard discovers custom models, stays open after refresh, and finishes the same endpoint', async t => {
  const ui = await setup(t)
  assert.equal(ui.text().includes('Add custom provider'), false)
  await ui.custom()
  assert.equal(ui.byButton('Finish Setup').disabled, true)
  await ui.click('Test Connection')
  assert.equal(ui.endpoints.length, 1)
  assert.ok(ui.text().includes('Configure Your Endpoint'), 'Saving for discovery must not dismiss the wizard')
  assert.equal(ui.document.querySelector('input[type="password"]').value, '')
  await ui.click('Manage Models')
  await ui.click('Use discovered models')
  assert.deepEqual(ui.endpoints[0].models, [], 'Selecting models must not prematurely finish setup')
  await ui.click('Finish Setup')
  assert.equal(ui.text().includes('Setup Your First AI Provider'), false)
  assert.equal(ui.endpoints.length, 1, 'Testing and finishing must not create duplicate endpoints')
  assert.deepEqual(ui.endpoints[0].models, ['fixture-small', 'fixture-large'])
  assert.equal(ui.endpoints[0].hasKey, true)
  assert.equal(ui.requests.filter(r => r.url === '/api/settings').length, 0)
  assert.equal(ui.requests.filter(r => r.url === '/api/providers/custom').at(-1).body.id, 'endpoint-1')
})

test('failed model discovery remains in the wizard and accepts manual models', async t => {
  const ui = await setup(t, { discoveryFailure: true })
  await ui.custom()
  await ui.click('Test Connection')
  assert.ok(ui.text().includes('enter models manually'))
  assert.equal(ui.byButton('Finish Setup').disabled, true)
  await ui.input('Manual model ID', 'manual-fixture')
  await ui.click('Add model')
  await ui.click('Finish Setup')
  assert.equal(ui.endpoints.length, 1)
  assert.deepEqual(ui.endpoints[0].models, ['manual-fixture'])
  assert.equal(ui.text().includes('Setup Your First AI Provider'), false)
})

test('local unauthenticated endpoints can finish without a built-in provider key', async t => {
  const ui = await setup(t)
  await ui.choose('Custom endpoint')
  await ui.input('Provider name', 'Local fixture')
  await ui.input('Base URL', 'http://localhost:1234/v1')
  await ui.input('Authentication', 'none')
  await ui.input('Manual model ID', 'local-model')
  await ui.click('Add model')
  await ui.click('Finish Setup')
  assert.equal(ui.endpoints[0].authStyle, 'none')
  assert.equal(ui.endpoints[0].hasKey, false)
  assert.equal(ui.text().includes('Setup Your First AI Provider'), false)
})

for (const failure of ['failSave', 'failRefresh']) test(`custom setup remains recoverable after ${failure}`, async t => {
  const ui = await setup(t, { [failure]: true })
  await ui.custom()
  await ui.input('Manual model ID', 'retry-model')
  await ui.click('Add model')
  await ui.click('Finish Setup')
  assert.ok(ui.document.querySelector('[role="alert"]'))
  assert.ok(ui.text().includes('Configure Your Endpoint'))
  await ui.click('Finish Setup')
  assert.equal(ui.endpoints.length, 1)
  assert.equal(ui.endpoints[0].hasKey, true)
  assert.deepEqual(ui.endpoints[0].models, ['retry-model'])
  assert.equal(ui.text().includes('Setup Your First AI Provider'), false)
})

test('built-in provider choices retain the three-step flow and require retesting edited keys', async t => {
  const ui = await setup(t)
  await ui.choose('OpenAI')
  const key = ui.document.querySelector('input[type="password"]')
  async function keyValue(value) {
    await React.act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(key, value); key.dispatchEvent(new window.Event('input', { bubbles: true })) })
  }
  await keyValue('synthetic-built-in-key')
  await ui.click('Test & Fetch Models')
  assert.equal(ui.byButton('Next').disabled, false)
  await keyValue('synthetic-replacement-key')
  assert.equal(ui.byButton('Next').disabled, true)
  await ui.click('Test & Fetch Models')
  await ui.click('Next')
  assert.ok(ui.text().includes('Step 3 of 3'))
  await ui.click('Finish Setup')
  const saved = ui.requests.find(r => r.url === '/api/settings')
  assert.equal(saved.body.openai.apiKey, 'synthetic-replacement-key')
  assert.ok(saved.body.openai.activeModels.length > 0)
})


test('returning to provider selection preserves the custom draft and saved endpoint identity', async t => {
  const ui = await setup(t)
  await ui.custom()
  await ui.click('Test Connection')
  await ui.input('Manual model ID', 'preserved-model')
  await ui.click('Add model')
  await ui.click('Previous')
  await ui.click('Next')
  await ui.click('Finish Setup')
  assert.equal(ui.endpoints.length, 1)
  assert.deepEqual(ui.endpoints[0].models, ['preserved-model'])
})

test('ComfyUI setup requires a workflow and preserves the shared protocol options', async t => {
  const ui = await setup(t)
  await ui.custom()
  await ui.input('API type', 'comfyui')
  await ui.input('Manual model ID', 'workflow-name')
  await ui.click('Add model')
  assert.equal(ui.byButton('Finish Setup').disabled, true)
  const workflow = { '1': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } } }
  await ui.input('ComfyUI API workflow (encrypted)', JSON.stringify(workflow))
  await ui.click('Finish Setup')
  const request = ui.requests.find(r => r.url === '/api/providers/custom')
  assert.equal(request.body.apiType, 'comfyui')
  assert.deepEqual(request.body.workflow, workflow)
  assert.equal(ui.text().includes('Setup Your First AI Provider'), false)
})
