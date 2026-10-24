function originOf(value) { try { return new URL(value).origin } catch { return null } }
function externalURL(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

function installWindowPolicy(session, primary, origin, openExternal, packaged) {
  const owned = new WeakSet()
  const preferences = { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: !packaged }
  const canWrite = (contents, permission, requestingOrigin) => owned.has(contents) && permission === 'clipboard-sanitized-write' && originOf(requestingOrigin) === origin
  session.setPermissionCheckHandler((contents, permission, requestingOrigin) => canWrite(contents, permission, requestingOrigin))
  session.setPermissionRequestHandler((contents, permission, callback, details) => callback(canWrite(contents, permission, details?.requestingUrl || contents.getURL())))
  function external(contents, value) {
    const url = externalURL(value)
    if (!url) return
    // OS navigation needs an explicit gesture, just as browser popup creation.
    void contents.executeJavaScript('navigator.userActivation.isActive').then(active => {
      if (active) return openExternal(url)
    }).catch(() => {})
  }
  function protect(window) {
    const contents = window.webContents
    owned.add(contents)
    window.removeMenu()
    contents.setWindowOpenHandler(({ url }) => {
      if (url === 'about:blank' || originOf(url) === origin) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: preferences } }
      external(contents, url)
      return { action: 'deny' }
    })
    contents.on('did-create-window', child => protect(child))
    contents.on('will-navigate', (event, url) => {
      if (originOf(url) === origin) return
      event.preventDefault()
      external(contents, url)
    })
    contents.on('will-redirect', (event, url) => { if (originOf(url) !== origin) event.preventDefault() })
    contents.on('will-attach-webview', event => event.preventDefault())
  }
  protect(primary)
}
module.exports = { installWindowPolicy, externalURL }
