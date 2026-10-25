const test = require('node:test')
const assert = require('node:assert/strict')
const { reuseRun, equivalentInputs } = require('../desktop/reuse.cjs')

test('reuse requests require an explicit bounded run ID', () => {
  assert.equal(reuseRun('ci: recheck installers [reuse:40165653161]'), '40165653161')
  assert.equal(reuseRun('ci: normal native build'), '')
  for (const input of ['[reuse:other]', '[reuse:12345678901234567]', '[reuse:123]suffix']) assert.throws(() => reuseRun(input))
})
test('validation-only changes can recheck identical application and packaging blobs', () => {
  equivalentInputs({ 'src/app/page.tsx': '100644:a', 'desktop/main.cjs': '100644:b', 'desktop/smoke.cjs': '100644:new', 'desktop/reuse.cjs': '100644:helper', 'tests/example.js': '100644:test' }, { 'src/app/page.tsx': '100644:a', 'desktop/main.cjs': '100644:b', 'desktop/smoke.cjs': '100644:old' })
})
test('changed, added, removed or mode-changed application/build inputs require rebuilding', () => {
  const original = { 'src/lib/contextService.ts': '100644:a', 'desktop/main.cjs': '100644:b', 'desktop/package.cjs': '100644:c', 'ops/build-media.sh': '100755:d' }
  for (const changed of [
    { ...original, 'src/lib/contextService.ts': '100644:changed' },
    { ...original, 'desktop/package.cjs': '100644:changed' },
    { ...original, 'ops/build-media.sh': '100644:d' },
    { ...original, 'desktop/extra-runtime.cjs': '100644:new' },
    { 'desktop/main.cjs': '100644:b' },
  ]) assert.throws(() => equivalentInputs(changed, original), /rebuild/)
})
