const RELEASES_API = 'https://api.github.com/repos/dannychirkov/llm-canvas/releases'
const DOWNLOAD_ROOT = 'https://github.com/dannychirkov/llm-canvas/releases/download/'
const INITIAL_DELAY_MS = 30000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const TIMEOUT_MS = 10000
const COOLDOWN_MS = 60000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

function parseVersion(value) {
  if (typeof value !== 'string' || value.length > 128) return null
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value)
  if (!match || match[0] !== value) return null
  const prerelease = match[4] ? match[4].split('.') : []
  if (prerelease.some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) return null
  return { core: match.slice(1, 4), prerelease, version: value.replace(/^v/, '') }
}

function compareNumeric(left, right) {
  return Math.sign(left.length - right.length) || (left < right ? -1 : left > right ? 1 : 0)
}

function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right)
  if (!a || !b) throw new Error('Invalid release version')
  for (let i = 0; i < 3; i++) {
    const order = compareNumeric(a.core[i], b.core[i])
    if (order) return order
  }
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length ? -1 : b.prerelease.length ? 1 : 0
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i], y = b.prerelease[i]
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    if (x === y) continue
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y)
    return xn && yn ? compareNumeric(x, y) : xn !== yn ? (xn ? -1 : 1) : x < y ? -1 : 1
  }
  return 0
}

function selectRelease(releases, currentVersion, platform, arch) {
  const current = parseVersion(currentVersion)
  if (!current) throw new Error('Invalid application version')
  const candidates = releases.filter(release => {
    const version = parseVersion(release?.tag_name)
    return version && release.draft === false && typeof release.prerelease === 'boolean' && Array.isArray(release.assets) &&
      (current.prerelease.length || (!release.prerelease && !version.prerelease.length))
  }).sort((a, b) => compareVersions(b.tag_name, a.tag_name))
  if (!candidates.length) throw new Error('No valid published releases')
  let incompatible
  for (const release of candidates) {
    if (compareVersions(release.tag_name, currentVersion) <= 0) break
    const version = parseVersion(release.tag_name).version
    const names = platform === 'win32' && arch === 'x64' ? [`LLM-Canvas-${version}-x64-Setup.exe`] :
      platform === 'darwin' && arch === 'arm64' ? [`LLM-Canvas-${version}-arm64.dmg`] :
        platform === 'linux' && arch === 'x64' ? [`LLM-Canvas-${version}-x86_64.AppImage`, `LLM-Canvas-${version}-x64.AppImage`] : []
    const name = names.find(name => release.assets.some(asset => asset?.name === name && asset.state === 'uploaded'))
    // Neither html_url nor browser_download_url from the API is trusted.
    if (name) return { status: 'available', version, url: DOWNLOAD_ROOT + encodeURIComponent(release.tag_name) + '/' + encodeURIComponent(name) }
    incompatible ||= { status: 'incompatible', version }
  }
  return incompatible || { status: 'current' }
}

async function readJSON(response, signal) {
  if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'rate-limit' : 'http')
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new Error('response-limit')
  if (!response.body) throw new Error('empty-response')
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  const chunks = []
  let bytes = 0
  try {
    if (signal.aborted) throw new Error('stopped')
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('response-limit')
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    cancel()
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

function createUpdateChecker({ version, platform = process.platform, arch = process.arch, isPackaged,
  fetch, showMessageBox, openExternal, env = process.env, timers = globalThis, now = Date.now }) {
  let stopped = false, started = false, pending, controller, completed, initialTimer, intervalTimer, manualRequested = false
  const prompted = new Set()
  const automatic = isPackaged && env.LLM_CANVAS_DISABLE_UPDATE_CHECKS !== '1'

  async function request() {
    if (completed && now() - completed.at < COOLDOWN_MS) {
      if (completed.error) throw completed.error
      return completed.result
    }
    controller = new AbortController()
    const { signal } = controller
    const abort = new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    const timeout = timers.setTimeout(() => controller?.abort(new Error('timeout')), TIMEOUT_MS)
    try {
      const current = parseVersion(version)
      if (!current) throw new Error('invalid-version')
      const url = RELEASES_API + (current.prerelease.length ? '?per_page=100' : '/latest')
      const result = await Promise.race([abort, (async () => {
        const response = await fetch(url, { signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
          headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } })
        const body = await readJSON(response, signal)
        if (current.prerelease.length ? !Array.isArray(body) || body.length > 100 : !body || Array.isArray(body)) throw new Error('invalid-response')
        return selectRelease(current.prerelease.length ? body : [body], version, platform, arch)
      })()])
      if (!stopped) completed = { at: now(), result }
      return result
    } catch (error) {
      const normalized = new Error(['timeout', 'rate-limit'].includes(error?.message) ? error.message : 'unavailable')
      if (!stopped) completed = { at: now(), error: normalized }
      throw normalized
    } finally {
      timers.clearTimeout(timeout)
      controller.abort()
      controller = undefined
    }
  }

  async function run() {
    try {
      const result = await request()
      if (stopped) return
      if (result.status === 'available') {
        if (!manualRequested && prompted.has(result.version)) return
        prompted.add(result.version)
        const { response } = await showMessageBox({ type: 'info', title: 'LLM Canvas update',
          message: `LLM Canvas ${result.version} is available.`,
          detail: `You are running ${version}. Open the download in your browser, then quit LLM Canvas and install it manually. Your local profile is kept.`,
          buttons: ['Download update', 'Later'], defaultId: 1, cancelId: 1, noLink: true })
        if (response === 0 && !stopped) await openExternal(result.url)
      } else if (manualRequested) {
        await showMessageBox({ type: 'info', title: 'LLM Canvas updates',
          message: result.status === 'current' ? 'No newer release is available for your update channel.' : `LLM Canvas ${result.version} is available, but has no installer for ${platform}/${arch}.`,
          detail: `You are running ${version}.`, buttons: ['OK'] })
      }
      return result
    } catch (error) {
      if (!stopped && manualRequested) {
        // Never display response bodies, URLs, or raw network/OS diagnostics.
        const detail = error?.message === 'timeout' ? 'The update check timed out. Try again later.' :
          error?.message === 'rate-limit' ? 'GitHub is limiting update checks. Try again later.' :
            'The release information or download could not be reached or verified. Check your connection and try again later.'
        try {
          await showMessageBox({ type: 'warning', title: 'LLM Canvas updates', message: 'Unable to complete the update check.', detail, buttons: ['OK'] })
        } catch { /* Dialogs can fail during OS/window teardown. */ }
      }
    }
  }

  function check({ manual = false } = {}) {
    if (stopped || (!manual && !automatic)) return Promise.resolve()
    manualRequested ||= manual
    if (!pending) pending = run().finally(() => { pending = undefined; manualRequested = false })
    return pending
  }
  function start() {
    if (started || stopped || !automatic) return
    started = true
    initialTimer = timers.setTimeout(() => {
      void check()
      intervalTimer = timers.setInterval(() => { void check() }, CHECK_INTERVAL_MS)
      intervalTimer.unref?.()
    }, INITIAL_DELAY_MS)
    initialTimer.unref?.()
  }
  function stop() {
    stopped = true
    timers.clearTimeout(initialTimer)
    timers.clearInterval(intervalTimer)
    controller?.abort(new Error('stopped'))
  }
  return { check, start, stop }
}

module.exports = { parseVersion, compareVersions, selectRelease, createUpdateChecker,
  RELEASES_API, INITIAL_DELAY_MS, CHECK_INTERVAL_MS, TIMEOUT_MS, COOLDOWN_MS, MAX_RESPONSE_BYTES }
