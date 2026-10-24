const { app, BrowserWindow, dialog, session, shell } = require('electron')
const { fork } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs/promises')
const { safeStorage } = require('electron')
const { loadAuthSecret } = require('./profile.cjs')
const { claimProfile, prepareRuntime } = require('./runtime.cjs')
const { installWindowPolicy } = require('./window-policy.cjs')

app.setName('LLM Canvas')
app.enableSandbox()
if (process.env.LLM_CANVAS_PROFILE) {
  const profile = path.resolve(process.env.LLM_CANVAS_PROFILE)
  require('node:fs').mkdirSync(profile, { recursive: true, mode: 0o700 })
  app.setPath('userData', profile)
}
if (!app.requestSingleInstanceLock()) { app.quit() }
else {
  let window, child, heartbeat, lease, quitting = false
  let phase = 'initialization'
  app.on('second-instance', () => { if (window) { window.restore(); window.focus() } })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    clearInterval(heartbeat)
    const done = async () => {
      if (lease) await lease.release().catch(() => {})
      app.quit()
    }
    if (child?.pid) {
      child.once('exit', done)
      if (child.connected) child.send({ type: 'stop' })
      setTimeout(() => child?.kill(), 10000).unref()
    } else { void done() }
  })

  // Do not inherit server credentials or deployment settings from a shell.
  function childEnvironment() {
    const result = {}
    for (const key of ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL']) {
      if (process.env[key]) result[key] = process.env[key]
    }
    return result
  }
  async function launch(options, mode) {
    const log = path.join(app.getPath('userData'), 'migration.log')
    if (mode === 'migrate') {
      // Migration diagnostics contain no provider requests or credentials.
      await fs.writeFile(log, '', { mode: 0o600 })
    }
    const executable = path.join(options.server, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node')
    child = fork(path.join(options.server, 'bootstrap', 'backend.cjs'), [], { execPath: executable, execArgv: [], env: childEnvironment(), stdio: mode === 'migrate' ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'ignore', 'ignore', 'ipc'] })
    return new Promise((resolve, reject) => {
      let finished = false
      const timeout = setTimeout(() => reject(new Error('Local server startup timed out')), 90000)
      child.once('error', error => { clearTimeout(timeout); reject(error) })
      child.once('spawn', async () => {
        try {
          if (mode === 'migrate') for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => { void fs.appendFile(log, chunk, { mode: 0o600 }).catch(() => {}) })
          await lease.child(child.pid)
          heartbeat = setInterval(() => { if (child?.connected) child.send({ type: 'heartbeat' }) }, 3000)
          child.send({ type: 'start', mode, ...options })
        } catch (error) { reject(error) }
      })
      child.on('message', message => {
        if (message.type === 'listening') { finished = true; clearTimeout(timeout); resolve(message.origin) }
        else if (message.type === 'failed') { clearTimeout(timeout); reject(new Error('Local server failed to start')) }
      })
      child.once('exit', code => {
        clearInterval(heartbeat)
        clearTimeout(timeout)
        child = undefined
        if (mode === 'migrate' && code === 0) resolve()
        else if (!finished) reject(new Error('Local server exited during startup'))
        else if (!quitting) { dialog.showErrorBox('LLM Canvas', 'The local server stopped. Restart the application to continue.'); app.quit() }
      })
    })
  }
  app.whenReady().then(async () => {
    phase = 'sandbox configuration'
    if (app.commandLine.hasSwitch('no-sandbox')) throw new Error('LLM Canvas requires the Chromium sandbox; configure supported OS sandboxing before retrying')
    const profile = app.getPath('userData')
    phase = 'profile ownership'
    lease = await claimProfile(profile)
    phase = 'system keyring'
    safeStorage.isEncryptionAvailable() // Initialize Linux backend; reject basic_text in profile.cjs.
    const secret = await loadAuthSecret(profile, safeStorage)
    phase = 'local runtime'
    const server = app.isPackaged ? path.join(process.resourcesPath, 'server') : process.env.LLM_CANVAS_DESKTOP_SERVER
    if (!server) throw new Error('Build the desktop server before launching')
    const directory = await prepareRuntime(profile, server)
    phase = 'database backup'
    const database = path.join(directory, 'prisma', 'dev.db')
    // No active backend exists while copying; never migrate a live database.
    try {
      await fs.access(database)
      const backups = path.join(profile, 'backups', `before-${app.getVersion()}-${Date.now()}`)
      await fs.mkdir(backups, { recursive: true, mode: 0o700 })
      await fs.copyFile(database, path.join(backups, 'dev.db'), 1)
      for (const suffix of ['-wal', '-shm', '-journal']) {
        try { await fs.copyFile(database + suffix, path.join(backups, 'dev.db' + suffix), 1) }
        catch (error) { if (error.code !== 'ENOENT') throw error }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    phase = 'database migration'
    await launch({ server, directory, secret }, 'migrate')
    phase = 'server startup'
    const origin = await launch({ server, directory, secret }, 'serve')
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(origin + '/api/health').catch(() => undefined)
      if (response?.ok) break
      if (attempt >= 30) throw new Error('Local server readiness failed')
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    phase = 'window startup'
    window = new BrowserWindow({ width: 1440, height: 950, minWidth: 960, minHeight: 640, show: false, title: 'LLM Canvas', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: !app.isPackaged } })
    installWindowPolicy(session.defaultSession, window, origin, url => shell.openExternal(url), app.isPackaged)
    window.once('ready-to-show', () => window.show())
    await window.loadURL(origin)
  }).catch(error => {
    // Startup never executes providers. Bound OS/loader diagnostics and redact
    // the installation secret's format before writing the private debug log.
    const cause = String(error?.message || 'Unknown startup failure').replace(/[a-f0-9]{64}/gi, '[redacted]').slice(0, 1000)
    process.stderr.write(JSON.stringify({ event: 'desktop_startup_failed', phase, cause }) + '\n')
    dialog.showErrorBox('LLM Canvas could not start', `Startup failed during ${phase}. Your data was not reset. Check your system keyring or restore the original profile backup before retrying. See docs/DESKTOP.md for recovery steps.`)
    app.quit()
  })
}
