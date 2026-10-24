const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createLoader } = require('./loadSource')

test('every actual API mutation rejects a foreign browser origin before auth, body work or DB access', async () => {
  let authCalls = 0, databaseCalls = 0
  const forbid = () => { databaseCalls++; throw Error('Unexpected database work') }
  const load = createLoader({
    '@/lib/auth': { auth: async () => { authCalls++; throw Error('Unexpected authentication work') }, handlers: { GET: forbid, POST: forbid } },
    '@/lib/prisma': { prisma: new Proxy({}, { get: () => forbid }) },
  })
  const interval = global.setInterval
  let count = 0
  try {
    global.setInterval = () => 0
    const files = fs.readdirSync('src/app/api', { recursive: true }).filter(name => name.endsWith(path.sep + 'route.ts'))
    for (const name of files) {
      const file = path.join('src/app/api', name)
      const route = load(file)
      const url = 'http://localhost/api/' + name.replaceAll(path.sep,'/').replace(/\/route\.ts$/,'').replace(/\[.*?\]/g,'fixture')
      for (const method of ['POST','PUT','PATCH','DELETE']) if (typeof route[method] === 'function') {
        const request = new Request(url,{method,headers:{Origin:'https://foreign.invalid','content-type':'application/json'},body:'{}'})
        const response = await route[method](request,{params:Promise.resolve({id:'fixture',provider:'openai',path:[]})})
        assert.equal(response.status,403,file+':'+method)
        assert.equal(request.bodyUsed,false)
        count++
      }
    }
  } finally { global.setInterval = interval }
  assert.ok(count>=37)
  assert.equal(authCalls,0)
  assert.equal(databaseCalls,0)
})
test('compiled proxy matcher excludes API bodies and still protects pages/private media', () => {
  const { getMiddlewareMatchers } = require('next/dist/build/analysis/get-page-static-info')
  const { getMiddlewareRouteMatcher } = require('next/dist/shared/lib/router/utils/middleware-route-matcher')
  const { config } = createLoader({ '@/lib/auth':{}, '@/lib/prisma':{} })('src/proxy.ts')
  const match = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher,{}))
  for(const pathname of ['/api','/api/settings','/api/auth/callback/credentials','/api/media/upload','/api/canvas/execute-node-stream']) assert.equal(match(pathname,{},{}),false,pathname)
  for(const pathname of ['/dashboard','/canvas/fixture','/uploads/canvases/fixture/image.png','/api-help'])assert.equal(match(pathname,{},{}),true,pathname)
})
