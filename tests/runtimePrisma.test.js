const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const source = fs.readFileSync('docker-entrypoint.sh', 'utf8')
const block = source.slice(source.indexOf('# Use the native Prisma Client'), source.indexOf('log_success "Database initialization complete!"'))
function fixture(context, compiled = 'schema', current = 'schema', marker) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-prisma-runtime-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const dir of ['prisma','node_modules/@prisma/client','node_modules/.prisma/client']) fs.mkdirSync(path.join(root,dir),{recursive:true})
  fs.writeFileSync(path.join(root,'prisma/schema.prisma'), current)
  if (compiled !== null) fs.writeFileSync(path.join(root,'node_modules/.prisma/client/schema.prisma'),compiled)
  if (marker) fs.writeFileSync(path.join(root,'prisma/.schema.hash'),marker)
  const script = 'set -e\nlog_error(){ :; }; log_process(){ :; }; log_success(){ :; }; start_timer(){ :; }; end_timer(){ :; }; npx(){ exit 93; }; npm(){ exit 94; };\n'+block.replaceAll('/app/', root+'/')
  return { root, run: () => spawnSync('sh',['-c',script],{encoding:'utf8',env:{...process.env, SKIP_PRISMA_GENERATE:'true'}}) }
}
test('first startup validates the native compiled client without generating or installing packages', context => {
  const state = fixture(context)
  assert.equal(state.run().status,0)
  assert.match(fs.readFileSync(path.join(state.root,'prisma/.schema.hash'),'utf8'),/^[a-f0-9]{64}\n$/)
  assert.equal(fs.readFileSync(path.join(state.root,'node_modules/.prisma/client/schema.prisma'),'utf8'),'schema')
})
test('an old volume marker cannot bypass a mismatched compiled client or the skip flag', context => {
  const state = fixture(context,'old schema','new schema','cached')
  assert.equal(state.run().status,1)
  assert.equal(fs.readFileSync(path.join(state.root,'node_modules/.prisma/client/schema.prisma'),'utf8'),'old schema')
  assert.equal(fs.readFileSync(path.join(state.root,'prisma/.schema.hash'),'utf8'),'cached')
})
test('a stale marker alone does not cause runtime client removal or downloads', context => {
  const state = fixture(context,'schema','schema','old hash')
  assert.equal(state.run().status,0)
})
test('a missing generated client fails explicitly without deleting the package', context => {
  const state = fixture(context,null)
  assert.equal(state.run().status,1)
  assert.equal(fs.existsSync(path.join(state.root,'node_modules/@prisma/client')),true)
})
