const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { installWindowPolicy, externalURL } = require('../desktop/window-policy.cjs')

function fixture(activated = true) {
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => 'http://127.0.0.1:4000/canvas/test',
    executeJavaScript: async () => activated,
    setWindowOpenHandler(handler) { this.open = handler },
  })
  const session = { setPermissionCheckHandler(handler) { this.check = handler }, setPermissionRequestHandler(handler) { this.request = handler } }
  const opened = []
  installWindowPolicy(session, { webContents: contents, removeMenu() {} }, 'http://127.0.0.1:4000', async url => opened.push(url), true)
  return { contents, session, opened }
}
test('owned application windows can write sanitized clipboard text; reads and device access remain denied', () => {
  const { contents, session } = fixture()
  assert.equal(session.check(contents, 'clipboard-sanitized-write', contents.getURL()), true)
  for (const permission of ['clipboard-read', 'media', 'fileSystem', 'geolocation']) assert.equal(session.check(contents, permission, contents.getURL()), false)
  assert.equal(session.check(contents, 'clipboard-sanitized-write', 'https://foreign.test'), false)
  assert.equal(session.check(null, 'clipboard-sanitized-write', contents.getURL()), false)
  let allowed
  session.request(contents, 'clipboard-sanitized-write', value => { allowed = value }, {})
  assert.equal(allowed, true)
})
test('media/CSV popups inherit sandbox isolation and cannot acquire Node access', () => {
  const { contents } = fixture()
  for (const url of ['about:blank', 'http://127.0.0.1:4000/api/media/serve/test']) {
    const result = contents.open({ url })
    assert.equal(result.action, 'allow')
    assert.deepEqual(result.overrideBrowserWindowOptions.webPreferences, { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false })
  }
})
test('external OS navigation requires a gesture and a credential-free HTTP(S) URL', async () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:password@foreign.test', 'ms-settings:privacy']) assert.equal(externalURL(url), null)
  const active = fixture()
  assert.equal(active.contents.open({ url: 'https://docs.test/help' }).action, 'deny')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(active.opened, ['https://docs.test/help'])
  const inactive = fixture(false)
  inactive.contents.open({ url: 'https://docs.test/help' })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(inactive.opened, [])
})
