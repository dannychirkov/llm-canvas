const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { copyRuntimeNotices } = require('../desktop/notices.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-notices-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const checkout = path.join(root, 'checkout'), server = path.join(root, 'server')
  fs.mkdirSync(path.join(checkout, 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(checkout, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {} }))
  fs.mkdirSync(path.join(server, 'node_modules'), { recursive: true })
  return { root, checkout, server, output: path.join(server, 'THIRD-PARTY-NOTICES') }
}

function write(root, relative, bytes) {
  const filename = path.join(root, relative)
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename, bytes)
}

function packageAt(root, relative, name, version, files = {}) {
  write(root, relative + '/package.json', JSON.stringify({ name, version, license: 'MIT' }))
  for (const [file, bytes] of Object.entries(files)) write(root, relative + '/' + file, bytes)
}

function snapshot(root) {
  const files = {}
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(filename)
      else files[path.relative(root, filename).split(path.sep).join('/')] = createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
    }
  }
  visit(root)
  return files
}

test('retains traced package and vendored notices with verified bytes; runtime/private files remain untouched', t => {
  const { root, checkout, server, output } = fixture(t)
  packageAt(server, 'node_modules/next', 'next', '16.4.2', { 'index.js': 'runtime code' })
  packageAt(checkout, 'node_modules/next', 'next', '16.4.2', {
    'license.md': 'next notice', 'dist/compiled/cookie/LICENSE': 'vendored cookie notice',
    'dist/compiled/unused/COPYING.LESSER': 'unused vendored notice', 'NOTICE.txt': 'additional notice',
    'dist/server.js': 'source runtime code', '.env': 'private', 'dev.db': 'private',
    'uploads/original.mp4': 'private', 'uploads/LICENSE': 'private',
    'node_modules/untraced/LICENSE': 'untraced dependency notice',
  })
  // An unrelated installed package must not be opened or included.
  write(checkout, 'node_modules/unrelated/package.json', 'not valid JSON')
  write(checkout, '.env', 'private checkout configuration')
  const beforeRuntime = snapshot(path.join(server, 'node_modules'))
  const beforeSource = snapshot(checkout)
  const result = copyRuntimeNotices(checkout, server)
  assert.equal(result.packages.length, 1)
  const item = result.packages[0]
  assert.deepEqual([item.name, item.version, item.runtimePath, item.declaredLicense], ['next', '16.4.2', 'node_modules/next', 'MIT'])
  assert.equal(item.noticeStatus, 'package-notices-retained')
  assert.deepEqual(item.retainedFiles.map(file => file.sourcePath).sort(), ['NOTICE.txt', 'dist/compiled/cookie/LICENSE', 'dist/compiled/unused/COPYING.LESSER', 'license.md'].sort())
  for (const file of item.retainedFiles) {
    assert.equal(file.kind, 'notice')
    const retained = fs.readFileSync(path.join(output, file.path))
    assert.deepEqual(retained, fs.readFileSync(path.join(checkout, item.runtimePath, file.sourcePath)))
    assert.equal(createHash('sha256').update(retained).digest('hex'), file.sha256)
    assert.equal(path.isAbsolute(file.path), false)
    assert.equal(file.path.includes('..'), false)
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'inventory.json'), 'utf8')), result)
  assert.equal(JSON.stringify(result).includes(root), false)
  assert.deepEqual(snapshot(path.join(server, 'node_modules')), beforeRuntime)
  assert.deepEqual(snapshot(checkout), beforeSource)
  assert.equal(Object.keys(snapshot(output)).length, item.retainedFiles.length + 1)
  assert.throws(() => copyRuntimeNotices(checkout, server), /fresh THIRD-PARTY-NOTICES/)
})

test('nested runtime dependencies are separate entries; canonical fallback requires the exact identity', t => {
  const { checkout, server, output } = fixture(t)
  for (const base of [checkout, server]) packageAt(base, 'node_modules/parent', 'parent', '1.0.0', base === checkout ? { LICENSE: 'parent' } : {})
  packageAt(server, 'node_modules/parent/node_modules/child', 'child', '2.0.0')
  packageAt(checkout, 'node_modules/child', 'child', '2.0.0', { COPYING: 'hoisted child' })
  packageAt(server, 'node_modules/@scope/pkg', '@scope/pkg', '3.0.0')
  packageAt(checkout, 'node_modules/@scope/pkg', '@scope/pkg', '3.0.0', { NOTICE: 'scoped' })
  const result = copyRuntimeNotices(checkout, server)
  assert.equal(result.packages.length, 3)
  const child = result.packages.find(item => item.name === 'child')
  assert.equal(child.runtimePath, 'node_modules/parent/node_modules/child')
  assert.equal(fs.readFileSync(path.join(output, child.retainedFiles[0].path), 'utf8'), 'hoisted child')
  assert.equal(result.packages.find(item => item.name === 'parent').retainedFiles.length, 1)
})

test('nested installed versions are chosen before canonical packages with a different version', t => {
  const { checkout, server, output } = fixture(t)
  for (const base of [checkout, server]) packageAt(base, 'node_modules/parent', 'parent', '1.0.0')
  for (const base of [checkout, server]) packageAt(base, 'node_modules/parent/node_modules/child', 'child', '2.0.0', base === checkout ? { LICENSE: 'nested v2' } : {})
  packageAt(checkout, 'node_modules/child', 'child', '9.0.0', { LICENSE: 'wrong root version' })
  const result = copyRuntimeNotices(checkout, server)
  const child = result.packages.find(item => item.name === 'child')
  assert.equal(child.version, '2.0.0')
  assert.equal(fs.readFileSync(path.join(output, child.retainedFiles[0].path), 'utf8'), 'nested v2')
})

for (const conflict of ['version', 'name', 'missing-installed', 'malformed-runtime-metadata', 'fallback-version']) {
  test(`rejects ${conflict} before creating notice output`, t => {
    const { checkout, server, output } = fixture(t)
    packageAt(server, 'node_modules/pkg', 'pkg', '1.0.0')
    if (conflict === 'malformed-runtime-metadata') write(server, 'node_modules/pkg/package.json', '{invalid JSON')
    if (conflict !== 'missing-installed') packageAt(checkout, 'node_modules/pkg', conflict === 'name' ? 'different' : 'pkg', conflict === 'version' ? '2.0.0' : '1.0.0', { LICENSE: 'notice' })
    if (conflict === 'fallback-version') {
      for (const base of [checkout, server]) packageAt(base, 'node_modules/parent', 'parent', '1.0.0')
      fs.rmSync(path.join(server, 'node_modules/pkg'), { recursive: true })
      packageAt(server, 'node_modules/parent/node_modules/pkg', 'pkg', '2.0.0')
    }
    assert.throws(() => copyRuntimeNotices(checkout, server))
    assert.equal(fs.existsSync(output), false)
  })
}

test('omitted runtime metadata is proven by every traced file at the same installed path', t => {
  const { checkout, server, output } = fixture(t)
  packageAt(checkout, 'node_modules/pkg', 'pkg', '2.0.0', { LICENSE: 'source notice', 'index.js': 'same code', 'data/table.json': '{"same":true}' })
  write(server, 'node_modules/pkg/index.js', 'same code')
  write(server, 'node_modules/pkg/data/table.json', '{"same":true}')
  for (const base of [checkout, server]) packageAt(base, 'node_modules/pkg/node_modules/child', 'child', '1.0.0', { 'index.js': base === checkout ? 'installed child code' : 'runtime child code' })
  const before = snapshot(path.join(server, 'node_modules'))
  const result = copyRuntimeNotices(checkout, server)
  const item = result.packages.find(entry => entry.runtimePath === 'node_modules/pkg')
  assert.deepEqual([item.name, item.version, item.versionProof, item.tracedFileCount], ['pkg', '2.0.0', 'traced-files-match-installed', 2])
  assert.equal(fs.readFileSync(path.join(output, item.retainedFiles[0].path), 'utf8'), 'source notice')
  assert.equal(result.packages.find(entry => entry.name === 'child').versionProof, 'package-metadata-match')
  assert.deepEqual(snapshot(path.join(server, 'node_modules')), before)
  assert.equal(fs.existsSync(path.join(server, 'node_modules/pkg/package.json')), false)
})

for (const failure of ['different-bytes', 'missing-source-file', 'empty-package', 'no-exact-source']) {
  test(`omitted metadata rejects ${failure} before notice output`, t => {
    const { checkout, server, output } = fixture(t)
    for (const base of [checkout, server]) packageAt(base, 'node_modules/parent', 'parent', '1.0.0')
    packageAt(checkout, 'node_modules/parent/node_modules/pkg', 'pkg', '2.0.0', { LICENSE: 'notice', 'index.js': 'installed code' })
    const runtime = 'node_modules/parent/node_modules/pkg'
    fs.mkdirSync(path.join(server, runtime), { recursive: true })
    if (failure !== 'empty-package') write(server, runtime + '/index.js', failure === 'different-bytes' ? 'changed code' : 'installed code')
    if (failure === 'missing-source-file') write(server, runtime + '/extra.js', 'not in source')
    if (failure === 'no-exact-source') {
      fs.rmSync(path.join(checkout, runtime), { recursive: true })
      packageAt(checkout, 'node_modules/pkg', 'pkg', '2.0.0', { LICENSE: 'canonical notice', 'index.js': 'installed code' })
    }
    assert.throws(() => copyRuntimeNotices(checkout, server), /Traced package file mismatch|No traced files|Missing installed package/)
    assert.equal(fs.existsSync(output), false)
  })
}

test('libvips README fallback explicitly leaves missing aggregate/full license texts unresolved', t => {
  const { checkout, server, output } = fixture(t)
  const relative = 'node_modules/@img/sharp-libvips-linux-x64'
  for (const base of [checkout, server]) packageAt(base, relative, '@img/sharp-libvips-linux-x64', '1.3.4', base === checkout ? { 'README.md': 'Licensing table; https://github.com/lovell/sharp-libvips/issues/new', 'lib/binary.so': 'binary' } : {})
  const item = copyRuntimeNotices(checkout, server).packages[0]
  assert.equal(item.noticeStatus, 'readme-only')
  assert.equal(item.retainedFiles.length, 1)
  assert.equal(item.retainedFiles[0].kind, 'readme')
  assert.equal(item.retainedFiles[0].sourcePath, 'README.md')
  assert.equal(item.libvips.fullLicenseTexts, 'not-retained')
  assert.equal(item.libvips.readmeIsFullLicenseText, false)
  assert.equal(item.libvips.aggregateCopying, 'unavailable-at-checked-upstream-locations')
  assert.equal(fs.readFileSync(path.join(output, item.retainedFiles[0].path), 'utf8').startsWith('Licensing table'), true)
})

test('notice symlinks cannot copy private files outside the selected package', { skip: process.platform === 'win32' }, t => {
  const { root, checkout, server, output } = fixture(t)
  for (const base of [checkout, server]) packageAt(base, 'node_modules/pkg', 'pkg', '1.0.0')
  write(root, 'private.env', 'private bytes')
  fs.symlinkSync(path.join(root, 'private.env'), path.join(checkout, 'node_modules/pkg/LICENSE'))
  assert.throws(() => copyRuntimeNotices(checkout, server), /escapes/)
  assert.equal(fs.existsSync(output), false)
})

test('lock-selected client-only production notices are retained and runtime sources deduplicated', t => {
  const { root, checkout, server, output } = fixture(t)
  for (const base of [checkout, server]) packageAt(base, 'node_modules/react', 'react', '19.2.9', base === checkout ? { LICENSE: 'react notice' } : {})
  packageAt(checkout, 'node_modules/reactflow', 'reactflow', '11.11.4', { LICENSE: 'reactflow client notice', 'index.js': 'client code', '.env': 'private' })
  packageAt(checkout, 'node_modules/reactflow/node_modules/client-child', 'client-child', '1.0.0', { COPYING: 'nested client notice' })
  write(checkout, 'node_modules/dev-only/package.json', 'malformed dev metadata must not be read')
  write(checkout, 'package-lock.json', JSON.stringify({ packages: {
    '': { name: 'app', version: '1.0.0' },
    'node_modules/react': { version: '19.2.9' },
    'node_modules/reactflow': { version: '11.11.4' },
    'node_modules/reactflow/node_modules/client-child': { version: '1.0.0' },
    'node_modules/dev-only': { version: '1.0.0', dev: true },
    'node_modules/absent-platform-optional': { version: '1.0.0', optional: true },
  } }))
  const before = snapshot(path.join(server, 'node_modules'))
  const result = copyRuntimeNotices(checkout, server)
  assert.equal(result.packages.length, 3)
  assert.equal(result.packages.filter(item => item.name === 'react').length, 1)
  const client = result.packages.find(item => item.name === 'reactflow')
  assert.equal(client.runtimePath, null)
  assert.equal(client.sourcePath, 'node_modules/reactflow')
  assert.equal(client.collectionScope, 'declared-production')
  assert.equal(client.versionProof, 'package-lock-version-match')
  assert.deepEqual(client.retainedFiles.map(file => file.sourcePath), ['LICENSE'])
  assert.equal(fs.readFileSync(path.join(output, client.retainedFiles[0].path), 'utf8'), 'reactflow client notice')
  assert.equal(result.packages.find(item => item.name === 'client-child').runtimePath, null)
  assert.match(result.scope, /may include unused packages/)
  assert.equal(JSON.stringify(result).includes(root), false)
  assert.deepEqual(snapshot(path.join(server, 'node_modules')), before)
})

test('installed Tailwind CSS notices are included even when the lock marks it dev-only', t => {
  const { checkout, server, output } = fixture(t)
  packageAt(checkout, 'node_modules/tailwindcss', 'tailwindcss', '4.1.17', { LICENSE: 'generated CSS notice' })
  write(checkout, 'package-lock.json', JSON.stringify({ packages: { 'node_modules/tailwindcss': { version: '4.1.17', dev: true } } }))
  const item = copyRuntimeNotices(checkout, server).packages[0]
  assert.equal(item.collectionScope, 'generated-css')
  assert.equal(item.runtimePath, null)
  assert.equal(item.version, '4.1.17')
  assert.equal(fs.readFileSync(path.join(output, item.retainedFiles[0].path), 'utf8'), 'generated CSS notice')
})

for (const version of ['2.0.0', 'malformed version', null]) {
  test(`client-only package rejects mismatched/malformed lock version ${JSON.stringify(version)} before output`, t => {
    const { checkout, server, output } = fixture(t)
    packageAt(checkout, 'node_modules/reactflow', 'reactflow', '1.0.0', { LICENSE: 'client notice' })
    write(checkout, 'package-lock.json', JSON.stringify({ packages: { 'node_modules/reactflow': { version } } }))
    assert.throws(() => copyRuntimeNotices(checkout, server), /package\/lock version mismatch/)
    assert.equal(fs.existsSync(output), false)
  })
}
