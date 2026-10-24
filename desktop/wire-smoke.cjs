const http = require('node:http')
const assert = require('node:assert/strict')
const { desktopTarget, writeFailure } = require('./smoke.cjs')

async function wireSmoke(port, resume) {
  const fixtureKey = 'desktop-fixture-not-a-provider-key'
  let requests = 0
  const fixture = http.createServer(async (request, response) => {
    if (request.url !== '/v1/chat/completions' || request.headers.authorization !== 'Bearer ' + fixtureKey) { response.writeHead(403); response.end(); return }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks))
    assert.equal(body.model, 'desktop-fixture')
    requests++
    const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, prompt_tokens_details: { cached_tokens: 3 }, completion_tokens_details: { reasoning_tokens: 2 } }
    if (body.stream) {
      response.setHeader('Content-Type', 'text/event-stream')
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'desktop wire output' }, finish_reason: 'stop' }] })}\n\ndata: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`)
    } else {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message: { content: 'desktop wire output' } }], usage }))
    }
  })
  await new Promise((resolve, reject) => { fixture.once('error', reject); fixture.listen(19666, '127.0.0.1', resolve) })
  let socket
  try {
    const target = await desktopTarget(port)
    assert.equal(new URL(target.url).hostname, '127.0.0.1')
    assert.notEqual(new URL(target.url).port, '4250')
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    const reply = new Promise((resolve, reject) => socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id !== 1) return
      if (message.error || message.result.exceptionDetails) reject(new Error('Desktop protocol evaluation failed'))
      else resolve(message.result.result.value)
    }))
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { awaitPromise: true, returnByValue: true, expression: `(async()=>{
      const before=await(await fetch('/api/settings')).json();
      let endpoint=before.custom.find(e=>e.label==='Desktop protocol fixture');
      if(!${JSON.stringify(resume)}){const r=await fetch('/api/providers/custom',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:'Desktop protocol fixture',baseUrl:'http://127.0.0.1:19666/v1',models:['desktop-fixture'],contextWindow:32768,apiKey:${JSON.stringify(fixtureKey)},authStyle:'bearer'})});if(!r.ok)return {setup:r.status};endpoint=await r.json();}
      if(!endpoint)return {missingEndpoint:true};
      const canvases=await(await fetch('/api/canvases')).json();const canvas=canvases.find(c=>c.title==='Desktop persistence check');
      const body={provider:'custom',endpointId:endpoint.id,modelName:'desktop-fixture',finalPrompt:'desktop protocol check',canvasId:canvas.id};
      const chat=await fetch('/api/canvas/execute-node',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await chat.json();
      const stream=await fetch('/api/canvas/execute-node-stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const text=await stream.text();
      const settings=await(await fetch('/api/settings')).json();const updated=await(await fetch('/api/canvases/'+canvas.id)).json();
      return {chat:chat.status,stream:stream.status,response:result.responseText??result.fullResponse,tokens:result.tokens,cached:result.tokenBreakdown?.cachedTokens,reasoning:result.tokenBreakdown?.reasoningTokens,streamText:text.includes('desktop wire output'),streamErrors:text.includes('"error"'),counterDelta:updated.totalTokensUsed-canvas.totalTokensUsed,keyExposed:JSON.stringify(settings).includes(${JSON.stringify(fixtureKey)}),context:settings.custom.find(e=>e.id===endpoint.id)?.contextWindow};
    })()` } }))
    const result = await reply
    assert.equal(result.chat, 200)
    assert.equal(result.stream, 200)
    assert.equal(result.response, 'desktop wire output')
    assert.equal(result.tokens, 18)
    assert.equal(result.cached, 3)
    assert.equal(result.reasoning, 2)
    assert.equal(result.streamText, true)
    assert.equal(result.streamErrors, false)
    assert.equal(result.counterDelta, 36)
    assert.equal(result.keyExposed, false)
    assert.equal(result.context, 32768)
    assert.equal(requests, 2)
    process.stdout.write(JSON.stringify({ check: 'desktop-provider-wire', resume, chat: 200, stream: 200, tokens: 18, cached: 3, reasoning: 2, ledgerDelta: 36, keyExposed: false, context: 32768 }) + '\n')
  } finally { socket?.close(); await new Promise(resolve => fixture.close(resolve)) }
}
if (require.main === module) wireSmoke(Number(process.argv[2]), process.argv[3] === '--resume').catch(error => writeFailure(error, 'desktop-provider-wire'))
module.exports = { wireSmoke }
