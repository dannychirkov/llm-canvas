const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')

function publicSettingsProbe(params, { origin, authenticated, resume }) {
  if (authenticated || resume || params.request?.method !== 'GET') return false
  try {
    const url = new URL(params.request.url), document = new URL(params.documentURL)
    return url.origin === origin && url.pathname === '/api/settings' && !url.search && document.origin === origin && document.pathname === '/register'
  } catch { return false }
}

async function waitForReadiness(evaluate, { origin, pathname, contentExpression = 'true', bringToFront = async () => {}, timeoutMs = 30000, intervalMs = 100 }) {
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0)
  assert.ok(Number.isFinite(intervalMs) && intervalMs > 0)
  const deadline = Date.now() + timeoutMs
  let lastState = null, operation = 'focus'
  const expired = () => Object.assign(new Error(`Renderer readiness deadline exceeded for ${pathname}`), { readinessState: lastState, readinessOperation: operation })
  async function bounded(operation) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw expired()
    let timer
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => { timer = setTimeout(() => reject(expired()), remaining) }),
      ])
    } finally { clearTimeout(timer) }
  }
  const expression = `({originMatches:location.origin === ${JSON.stringify(origin)},pathname:location.pathname,complete:document.readyState === "complete",visible:document.visibilityState === "visible",focused:document.hasFocus(),contentReady:Boolean(${contentExpression})})`
  let consecutive = 0
  while (Date.now() < deadline) {
    operation = 'focus'
    await bounded(bringToFront)
    let ready = false
    operation = 'document'
    try {
      lastState = await bounded(() => evaluate(expression))
      ready = lastState?.originMatches && lastState.pathname === pathname && lastState.complete && lastState.visible && lastState.focused && lastState.contentReady
    }
    catch (error) {
      // Navigation can replace the context between probes. Other CDP/JS
      // failures remain failures, including outside this readiness poll.
      if (!/Execution context was destroyed|Cannot find (?:default execution context|context with specified id|execution context)|Execution context is not available/i.test(String(error.message))) throw error
    }
    if (Date.now() >= deadline) throw expired()
    consecutive = ready === true ? consecutive + 1 : 0
    if (consecutive >= 2) return true
    const remaining = deadline - Date.now()
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remaining)))
  }
  throw expired()
}

async function desktopTarget(port) {
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536)
  for (let attempt = 0; attempt < 180; attempt++) {
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json()).catch(() => [])
    const target = targets.find(target => target.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(target.url))
    if (target) return target
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('No application window after startup deadline')
}
async function smoke(port, resume) {
  const target = await desktopTarget(port)
  const origin = new URL(target.url).origin
  assert.equal(new URL(origin).hostname, '127.0.0.1')
  assert.notEqual(new URL(origin).port, '4250', 'Do not run against the deployed server')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let sequence = 0
  const pending = new Map(), failures = [], publicProbes = new Set()
  let authenticated = Boolean(resume), expectedPublicSettingsResponses = 0
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const operation = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) operation.reject(new Error(message.error.message))
      else operation.resolve(message.result)
    }
    if (message.method === 'Runtime.exceptionThrown') failures.push('page exception')
    if (message.method === 'Network.requestWillBeSent' && publicSettingsProbe(message.params, { origin, authenticated, resume })) publicProbes.add(message.params.requestId)
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
      if (message.params.response.status === 401 && publicProbes.has(message.params.requestId) && expectedPublicSettingsResponses === 0) expectedPublicSettingsResponses++
      else failures.push(`${message.params.response.status} ${new URL(message.params.response.url).pathname}`)
    }
  })
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async function evaluate(expression, userGesture = false) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture })
    assert.ok(!result.exceptionDetails, 'Renderer evaluation failed')
    return result.result.value
  }
  let phase = 'renderer-readiness'
  try {
    await send('Runtime.enable')
    await send('Network.enable')
    await waitForReadiness(evaluate, { origin, pathname: resume ? '/dashboard' : '/register', bringToFront: () => send('Page.bringToFront') })
    phase = 'renderer-isolation'
    assert.deepEqual(await evaluate('({node:typeof process, require:typeof require})'), { node: 'undefined', require: 'undefined' })
    phase = 'clipboard-write'
    assert.equal(await evaluate('navigator.clipboard.writeText("desktop-clipboard-check").then(()=>true,()=>false)', true), true)
    phase = 'clipboard-read'
    assert.equal(await evaluate('navigator.clipboard.readText().then(()=>true,()=>false)', true), false)
    phase = resume ? 'resumed-session' : 'registration'
    let canvasId
    if (!resume) {
      const account = { email: 'desktop-smoke@example.test', password: randomBytes(20).toString('hex') + '!Aa1', name: 'Desktop smoke' }
      const result = await evaluate(`(async()=>{
        const account=${JSON.stringify(account)};
        const register=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(account)});
        if(!register.ok)return {register:register.status};
        const {csrfToken}=await (await fetch('/api/auth/csrf')).json();
        const login=await fetch('/api/auth/callback/credentials',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Auth-Return-Redirect':'1'},body:new URLSearchParams({...account,csrfToken,callbackUrl:location.origin+'/dashboard'})});
        const session=await (await fetch('/api/auth/session')).json();
        const created=await fetch('/api/canvases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Desktop persistence check'})});
        if(!created.ok)return {register:register.status,login:login.status,owner:session.user?.email,created:created.status};
        const canvas=await created.json();const graph=JSON.parse(canvas.content);graph.nodes.find(n=>n.type==='memory').data.value='desktop-persistent-value';
        const saved=await fetch('/api/canvases/'+canvas.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:JSON.stringify(graph),expectedUpdatedAt:canvas.updatedAt})});
        return {register:register.status,login:login.status,owner:session.user?.email,created:created.status,saved:saved.status,id:canvas.id};
      })()`)
      assert.equal(result.register, 200)
      assert.equal(result.login, 200)
      assert.equal(result.owner, account.email)
      assert.equal(result.created, 201)
      assert.equal(result.saved, 200)
      authenticated = true
      canvasId = result.id
      await send('Page.navigate', { url: origin + '/canvas/' + result.id })
    } else {
      const result = await evaluate(`(async()=>{const session=await(await fetch('/api/auth/session')).json();const list=await(await fetch('/api/canvases')).json();const canvas=list.find(c=>c.title==='Desktop persistence check');if(!canvas)return {owner:session.user?.email};const doc=await(await fetch('/api/canvases/'+canvas.id)).json();return {owner:session.user?.email,id:canvas.id,persistent:JSON.parse(doc.content).nodes.some(n=>n.data.value==='desktop-persistent-value')};})()`)
      assert.equal(result.owner, 'desktop-smoke@example.test')
      assert.equal(result.persistent, true)
      canvasId = result.id
      await send('Page.navigate', { url: origin + '/canvas/' + result.id })
    }
    phase = 'canvas-render'
    await waitForReadiness(evaluate, {
      origin, pathname: '/canvas/' + canvasId, timeoutMs: 30000,
      bringToFront: () => send('Page.bringToFront'),
      contentExpression: `[...document.querySelectorAll('.react-flow__node-memory textarea, .react-flow__node-memory input')].some(element => element.value === 'desktop-persistent-value' && element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible')`,
    })
    phase = 'page-errors'
    assert.deepEqual(failures, [])
    process.stdout.write(JSON.stringify({ check: 'desktop-browser', resume, sandboxedRenderer: true, persistedCanvas: true, pageErrors: failures.length, expectedPublicSettingsResponses }) + '\n')
  } catch (error) { error.smokePhase = phase; error.smokeDiagnostics = failures; throw error }
  finally { socket.close() }
}
function writeFailure(error, check) {
  const location = String(error?.stack || '').match(/\b((?:wire-)?smoke\.cjs):(\d+):(\d+)/)
  const failures = Array.isArray(error.smokeDiagnostics) ? error.smokeDiagnostics.filter(value => value === 'page exception' || /^\d{3} \/[^?\s#]{0,160}$/.test(value)).slice(0, 10) : []
  process.stderr.write(JSON.stringify({ check, status: 'failed', phase: error.smokePhase || 'unknown', location: location ? location.slice(1).join(':') : null, failures, readinessOperation: error.readinessOperation || null, readinessState: error.readinessState || null }) + '\n')
  process.exitCode = 1
}
if (require.main === module) smoke(Number(process.argv[2]), process.argv[3] === '--resume').catch(error => writeFailure(error, 'desktop-browser'))
module.exports = { smoke, desktopTarget, writeFailure, waitForReadiness, publicSettingsProbe }
