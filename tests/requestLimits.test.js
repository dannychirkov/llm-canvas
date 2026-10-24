const test = require('node:test')
const assert = require('node:assert/strict')
const { createLoader } = require('./loadSource')
const load = createLoader()
const { readRequestBytes } = load('src/lib/requestBytes.ts')
const { readBoundedJson } = load('src/lib/requestBody.ts')
const { createWorkloadBudget, withWorkload } = load('src/lib/workloadBudget.ts')
const request = (body, headers = {}, signal) => new Request('http://localhost/api/test', { method: 'POST', body, headers: { "content-type": "application/json", ...headers }, signal, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) })
const status = expected => error => error.status === expected

test('JSON rejects actual chunked overflow and cancels without waiting for a stalled source cancellation', async () => {
  let cancelled = false
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(65)) }, cancel() { cancelled = true; return new Promise(() => {}) } })
  const started = Date.now()
  await assert.rejects(readBoundedJson(request(body), 64), status(413))
  assert.ok(cancelled)
  assert.ok(Date.now() - started < 500)
})
test('absolute body deadline rejects a stalled stream even if cancellation never resolves', async () => {
  let cancelled = false
  const body = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}) } })
  const started = Date.now()
  await assert.rejects(readRequestBytes(request(body), 64, 35), status(408))
  assert.ok(cancelled)
  assert.ok(Date.now() - started < 500)
})
test('client abort interrupts a pending body read, and a pre-aborted request never waits', async () => {
  const controller = new AbortController()
  const pending = readRequestBytes(request(new ReadableStream(), {}, controller.signal), 64)
  controller.abort()
  await assert.rejects(pending, status(408))
  await assert.rejects(readRequestBytes(request('{}', {}, controller.signal), 64), status(408))
})
test('declared lengths, malformed UTF8 and nonobject JSON fail before application use', async () => {
  for (const length of ['999', '-1', 'NaN', '1.5', '9007199254740992']) await assert.rejects(readBoundedJson(request('{}', { 'content-length': length }), 64), status(413))
  for (const body of ['[]', 'null', '{', new Uint8Array([123,34,120,34,58,34,0xff,34,125])]) await assert.rejects(readBoundedJson(request(body)), status(400))
  assert.deepEqual(await readBoundedJson(request('{"value":"valid"}')), { value: 'valid' })
})
test('admission caps actual callbacks globally and per user with no queued work; release is idempotent', () => {
  const acquire = createWorkloadBudget()
  const held = Array.from({ length: 3 }, () => acquire('first', 'execution'))
  assert.throws(() => acquire('first', 'execution'), status(429))
  held.push(...Array.from({ length: 3 }, () => acquire('second', 'execution')))
  assert.throws(() => acquire('third', 'execution'), status(429))
  held.push(acquire('third','transfer'), acquire('fourth','write'))
  assert.throws(() => acquire('fifth','metadata'), status(429))
  held[0](); held[0]()
  const recovered = acquire('first', 'execution')
  assert.throws(() => acquire('third','transfer'), status(429))
  held.forEach(release => release()); recovered()
  const next = acquire('next','transfer'); next()
})
test('a callback failure releases admission and cannot retain a user entry', async () => {
  await assert.rejects(withWorkload('failed-write','write',async () => { throw Error('fixture') }))
  assert.equal((await withWorkload('failed-write','write',async () => Response.json({ ok: true }))).status,200)
})
test('ZIP response retains the transfer permit through reads and releases it on cancellation', async () => {
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1,2,3])) } })
  const response = await withWorkload('zip-owner','transfer',async () => new Response(stream,{headers:{'content-type':'application/zip'}}))
  await assert.rejects(withWorkload('another-owner','transfer',async () => Response.json({})),status(429))
  const reader = response.body.getReader()
  assert.equal((await reader.read()).value.length,3)
  await reader.cancel()
  assert.equal((await withWorkload('another-owner','transfer',async () => Response.json({}))).status,200)
})
test('cancelled SSE keeps its permit until provider cleanup completes', async () => {
  const finishes = [], signals = []
  const { createProviderStream } = createLoader({ '@/lib/providerRequest': { withProviderSignal(signal, callback) { signals.push(signal); return callback() } } })('src/lib/providers/stream.ts')
  const responses = await Promise.all(Array.from({length:3},()=>withWorkload('sse-owner','execution',async () => createProviderStream(request('{}'),async () => new Promise(resolve => finishes.push(resolve))))))
  const cancelling = responses[0].body.cancel()
  await new Promise(resolve=>setImmediate(resolve))
  assert.ok(signals[0].aborted)
  await assert.rejects(withWorkload('sse-owner','execution',async () => Response.json({})),status(429))
  finishes[0]()
  await cancelling
  assert.equal((await withWorkload('sse-owner','execution',async () => Response.json({}))).status,200)
  for(let i=1;i<responses.length;i++){ const cancelled=responses[i].body.cancel(); finishes[i](); await cancelled }
})

test('unauthenticated expensive requests cannot enter a callback or consume body work', async () => {
  let calls = 0
  const { authenticatedWorkload } = createLoader({ '@/lib/auth': { auth: async () => null } })('src/lib/authenticatedWorkload.ts')
  const response = await authenticatedWorkload('transfer',async () => { calls++; return Response.json({}) })
  assert.equal(response.status,401); assert.equal(calls,0)
})
test('settings reject invalid/oversized input before crypto or database writes', async () => {
  let writes = 0, encryptions = 0
  const route = createLoader({ '@/lib/auth':{auth:async()=>({user:{id:'settings-owner'}})}, '@/lib/prisma':{prisma:{$transaction:async()=>{writes++;throw Error('unexpected')}}}, '@/lib/crypto':{encryptString:async()=>{encryptions++;return 'cipher'}} })('src/app/api/settings/route.ts')
  for(const body of [{provider:'openai',apiKey:{}},{provider:'openai',activeModels:['']},{activeModels:['model']},{provider:'unknown',apiKey:'fixture'},{openai:{activeModels:'model'}}])assert.equal((await route.PUT(request(JSON.stringify(body)))).status,400)
  assert.equal((await route.PUT(request('{"padding":"'+'x'.repeat(1024*1024)+'"}'))).status,413)
  assert.equal(writes,0); assert.equal(encryptions,0)
})


test('independently loaded route modules share admission counts and still return a normalized 429', async () => {
  const loader = createLoader({ '@/lib/auth': { auth: async () => ({ user: { id: 'cross-module-owner' } }) } })
  const other = loader('src/lib/authenticatedWorkload.ts').authenticatedWorkload
  let finish
  const pending = withWorkload('cross-module-owner','write',async () => new Promise(resolve => { finish=()=>resolve(Response.json({})) }))
  const response = await other('write',async () => Response.json({}))
  assert.equal(response.status,429)
  assert.equal(response.headers.get('retry-after'),'1')
  finish(); await pending
})
