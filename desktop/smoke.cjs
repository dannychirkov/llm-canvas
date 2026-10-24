const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')

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
  const pending = new Map(), failures = []
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const operation = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) operation.reject(new Error(message.error.message))
      else operation.resolve(message.result)
    }
    if (message.method === 'Runtime.exceptionThrown') failures.push('page exception')
    if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) failures.push(`${message.params.response.status} ${new URL(message.params.response.url).pathname}`)
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
    await send('Page.bringToFront')
    let focused = false
    for (let attempt = 0; attempt < 100; attempt++) {
      focused = await evaluate('document.readyState !== "loading" && document.visibilityState === "visible" && document.hasFocus()')
      if (focused) break
      await new Promise(resolve => setTimeout(resolve, 100))
      await send('Page.bringToFront')
    }
    assert.equal(focused, true, 'Application window is not visible and focused')
    phase = 'renderer-isolation'
    assert.deepEqual(await evaluate('({node:typeof process, require:typeof require})'), { node: 'undefined', require: 'undefined' })
    phase = 'clipboard-write'
    assert.equal(await evaluate('navigator.clipboard.writeText("desktop-clipboard-check").then(()=>true,()=>false)', true), true)
    phase = 'clipboard-read'
    assert.equal(await evaluate('navigator.clipboard.readText().then(()=>true,()=>false)', true), false)
    phase = resume ? 'resumed-session' : 'registration'
    if (!resume) {
      assert.equal(new URL(target.url).pathname, '/register')
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
      await send('Page.navigate', { url: origin + '/canvas/' + result.id })
    } else {
      const result = await evaluate(`(async()=>{const session=await(await fetch('/api/auth/session')).json();const list=await(await fetch('/api/canvases')).json();const canvas=list.find(c=>c.title==='Desktop persistence check');if(!canvas)return {owner:session.user?.email};const doc=await(await fetch('/api/canvases/'+canvas.id)).json();return {owner:session.user?.email,id:canvas.id,persistent:JSON.parse(doc.content).nodes.some(n=>n.data.value==='desktop-persistent-value')};})()`)
      assert.equal(result.owner, 'desktop-smoke@example.test')
      assert.equal(result.persistent, true)
      await send('Page.navigate', { url: origin + '/canvas/' + result.id })
    }
    phase = 'canvas-render'
    await new Promise(resolve => setTimeout(resolve, 2500))
    assert.equal(await evaluate('document.body.innerText.includes("desktop-persistent-value") || [...document.querySelectorAll("textarea,input")].some(element=>element.value.includes("desktop-persistent-value"))'), true)
    phase = 'page-errors'
    assert.deepEqual(failures, [])
    process.stdout.write(JSON.stringify({ check: 'desktop-browser', resume, sandboxedRenderer: true, persistedCanvas: true, pageErrors: failures.length }) + '\n')
  } catch (error) { error.smokePhase = phase; throw error }
  finally { socket.close() }
}
function writeFailure(error, check) {
  const location = String(error?.stack || '').match(/\b((?:wire-)?smoke\.cjs):(\d+):(\d+)/)
  process.stderr.write(JSON.stringify({ check, status: 'failed', phase: error.smokePhase || 'unknown', location: location ? location.slice(1).join(':') : null }) + '\n')
  process.exitCode = 1
}
if (require.main === module) smoke(Number(process.argv[2]), process.argv[3] === '--resume').catch(error => writeFailure(error, 'desktop-browser'))
module.exports = { smoke, desktopTarget, writeFailure }
