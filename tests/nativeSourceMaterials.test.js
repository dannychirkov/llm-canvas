const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const script = path.resolve(__dirname, '../ops/native-source-materials.py')
const python = process.platform === 'win32' ? '/usr/bin/python3' : 'python3'
const available = spawnSync(python, ['-c', 'import tomllib']).status === 0

function run(args) {
  return spawnSync(python, [script, ...args], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  })
}

function helper(code, args = []) {
  return spawnSync(python, ['-c', `
import sys, importlib.util
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('native', sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
from pathlib import Path
import hashlib, io, json, tarfile, gzip, zipfile
${code}`, script, ...args], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  })
}

function succeeds(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout.trim()
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-materials-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  succeeds(helper(`
root = Path(sys.argv[2])
cache = root / 'cache'
cache.mkdir()
content = {'source/COPYING': b'Published upstream license\\n',
           'source/Cargo.lock': b'version = 4\\npackage = []\\n',
           'source/code.c': b'int main(void) { return 0; }\\n'}
archive = cache / 'fixture.tar.gz'
with tarfile.open(archive, 'w:gz') as output:
    for name, data in content.items():
        m.tar_add(output, name, len(data), io.BytesIO(data))
row = dict(file=archive.name, url='https://upstream.example/source.tar.gz',
           size=archive.stat().st_size, sha256=m.file_hash(archive),
           kind='source', version='1', format='tar', include=True,
           path='sources/fixture.tar.gz', members=[])
for name in ['source/COPYING', 'source/Cargo.lock']:
    data = content[name]
    row['members'].append(dict(name=name, path='notices/' + name,
                              role='notice' if name.endswith('COPYING') else 'metadata',
                              size=len(data), sha256=hashlib.sha256(data).hexdigest()))
pins = dict(schema=1, materials=[row], closure=dict(status='materials-complete',
            unresolved=[], components=[], platforms=[],
            rust=dict(archive=archive.name, lockMember='source/Cargo.lock')))
(root / 'pins.json').write_bytes(m.canonical(pins))
`, [root]))
  return { root, cache: path.join(root, 'cache'), pins: path.join(root, 'pins.json') }
}

test('real inventory covers all four targets, exact MXE inputs, and release Cargo.lock sources', () => {
  const pins = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../ops/native-source-pins.json')))
  assert.equal(pins.closure.status, 'materials-complete')
  assert.deepEqual(pins.closure.unresolved, [])
  assert.deepEqual(pins.closure.platforms.map(p => p.name).sort(),
    ['darwin-arm64', 'linux-x64', 'linuxmusl-x64', 'win32-x64'])
  const materials = new Map(pins.materials.map(row => [row.file, row]))
  assert.equal(pins.materials.filter(row => row.kind === 'crate').length, 357)
  assert.equal(pins.closure.windowsChecksums.length, 28)
  for (const check of pins.closure.windowsChecksums) {
    assert.equal(materials.get(check.material).sha256, check.recipeChecksum)
  }
  for (const platform of pins.closure.platforms) {
    assert.match(materials.get(platform.evidence).integrity, /^sha512-/)
  }
  assert.equal(pins.closure.electron.ffmpegRevision, '9db86ce5b5b454dfc96c435f9f0723012980c37f')
  assert.equal(pins.closure.electron.ffmpegConfigurations.length, 3)
  assert.equal(materials.get(pins.closure.electron.binaryEvidence).include, false)
})

test('assembly is deterministic and payload plus whole archive verify offline', { skip: !available }, t => {
  const f = fixture(t), first = path.join(f.root, 'first.tar.gz'), second = path.join(f.root, 'second.tar.gz')
  const hash = succeeds(run(['--pins', f.pins, 'assemble', '--cache', f.cache, '--out', first]))
  assert.match(hash, /^[a-f0-9]{64}$/)
  assert.equal(succeeds(run(['--pins', f.pins, 'assemble', '--cache', f.cache, '--out', second])), hash)
  assert.deepEqual(fs.readFileSync(first), fs.readFileSync(second))
  // The source cache can disappear entirely; archive verification must stay offline.
  fs.rmSync(f.cache, { recursive: true })
  assert.match(succeeds(run(['--pins', f.pins, 'verify', '--archive', first, '--sha256', hash])), /Verified .* offline/)
  fs.appendFileSync(first, 'unapproved trailing bytes')
  const changed = run(['--pins', f.pins, 'verify', '--archive', first, '--sha256', hash])
  assert.notEqual(changed.status, 0)
  assert.match(changed.stderr, /Whole archive SHA-256 mismatch/)
})

test('missing and tampered cache inputs fail before creating output', { skip: !available }, t => {
  const f = fixture(t), output = path.join(f.root, 'result.tar.gz'), source = path.join(f.cache, 'fixture.tar.gz')
  fs.writeFileSync(source, 'tampered')
  let result = run(['--pins', f.pins, 'assemble', '--cache', f.cache, '--out', output])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /SHA-256\/size mismatch/)
  assert.equal(fs.existsSync(output), false)
  fs.unlinkSync(source)
  result = run(['--pins', f.pins, 'assemble', '--cache', f.cache, '--out', output])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Missing offline source artifact.*URL https:/)
  assert.equal(fs.existsSync(output), false)
})

test('existing output and cache symlink are rejected without overwriting files', { skip: !available }, t => {
  const f = fixture(t), output = path.join(f.root, 'keep.tar.gz')
  fs.writeFileSync(output, 'existing user bytes')
  let result = run(['--pins', f.pins, 'assemble', '--cache', f.cache, '--out', output])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /fresh and nonexistent/)
  assert.equal(fs.readFileSync(output, 'utf8'), 'existing user bytes')
  if (process.platform !== 'win32') {
    const source = path.join(f.cache, 'fixture.tar.gz'), actual = path.join(f.root, 'actual.tar.gz')
    fs.renameSync(source, actual)
    fs.symlinkSync(actual, source)
    result = run(['--pins', f.pins, 'verify-cache', '--cache', f.cache])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Expected regular file/)
  }
})

test('unsafe pin paths are rejected before filesystem writes', { skip: !available }, t => {
  const f = fixture(t)
  const original = fs.readFileSync(f.pins, 'utf8')
  for (const file of ['../escape', '/absolute', 'C:drive', 'back\\slash', '..']) {
    const data = JSON.parse(original)
    data.materials[0].file = file
    fs.writeFileSync(f.pins, JSON.stringify(data))
    const result = run(['--pins', f.pins, 'verify-cache', '--cache', f.cache])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Unsafe/)
  }
})

test('source TAR and ZIP readers reject traversal, links as selected text, duplicates, and missing notices', { skip: !available }, t => {
  const f = fixture(t)
  succeeds(helper(`
root = Path(sys.argv[2])
for kind in ['traversal', 'absolute', 'backslash', 'drive', 'symlink', 'hardlink', 'device', 'duplicate', 'missing']:
    archive = root / (kind + '.tar.gz')
    with tarfile.open(archive, 'w:gz') as output:
        name = {'traversal': 'source/../../escaped', 'absolute': '/escaped',
                'backslash': 'source/..\\\\escaped', 'drive': 'source/C:escaped'}.get(kind, 'source/COPYING')
        member = tarfile.TarInfo(name)
        if kind in ['symlink', 'hardlink']:
            member.type = tarfile.SYMTYPE if kind == 'symlink' else tarfile.LNKTYPE
            member.linkname = '../../escaped'
            output.addfile(member)
        elif kind == 'device':
            member.type = tarfile.CHRTYPE
            output.addfile(member)
        elif kind != 'missing':
            member.size = 1
            output.addfile(member, io.BytesIO(b'x'))
            if kind == 'duplicate':
                output.addfile(member, io.BytesIO(b'x'))
    row = dict(format='tar', members=[dict(name='source/COPYING', path='notices/COPYING',
               size=1, sha256=hashlib.sha256(b'x').hexdigest())])
    try:
        m.selected_members(archive, row)
        raise AssertionError('accepted ' + kind)
    except ValueError:
        pass
archive = root / 'bad.zip'
with zipfile.ZipFile(archive, 'w') as output:
    output.writestr('../escape', b'x')
try:
    m.selected_members(archive, dict(row, format='zip'))
    raise AssertionError('accepted ZIP traversal')
except ValueError:
    pass
assert not (root / 'escaped').exists()
`, [f.root]))
})

test('rewritten companion with a modified file fails even without an outer checksum', { skip: !available }, t => {
  const f = fixture(t), output = path.join(f.root, 'good.tar.gz'), bad = path.join(f.root, 'bad.tar.gz')
  succeeds(run(['--pins', f.pins, 'assemble', '--cache', f.cache, '--out', output]))
  succeeds(helper(`
with tarfile.open(sys.argv[2], 'r:gz') as source, tarfile.open(sys.argv[3], 'w:gz') as dest:
    for member in source:
        data = source.extractfile(member).read()
        if member.name == 'notices/source/COPYING':
            data = b'x' + data[1:]
        m.tar_add(dest, member.name, len(data), io.BytesIO(data))
`, [output, bad]))
  const result = run(['--pins', f.pins, 'verify', '--archive', bad])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Companion SHA-256 mismatch/)
})

test('companion verifier rejects missing, extra, duplicate, traversal and symlink members', { skip: !available }, t => {
  const f = fixture(t), output = path.join(f.root, 'good.tar.gz')
  succeeds(run(['--pins', f.pins, 'assemble', '--cache', f.cache, '--out', output]))
  succeeds(helper(`
pins_path = Path(sys.argv[2])
data = m.load_pins(pins_path)
for kind in ['missing', 'extra', 'duplicate', 'traversal', 'symlink']:
    archive = pins_path.parent / (kind + '.tar.gz')
    with tarfile.open(sys.argv[3], 'r:gz') as source, tarfile.open(archive, 'w:gz') as dest:
        for member in source:
            if kind == 'missing' and member.name == 'sources/fixture.tar.gz':
                continue
            m.tar_add(dest, member.name, member.size, source.extractfile(member))
        if kind != 'missing':
            name = {'extra': 'unexpected', 'duplicate': 'MANIFEST.json',
                    'traversal': '../escape', 'symlink': 'link'}[kind]
            if kind == 'symlink':
                member = tarfile.TarInfo(name)
                member.type, member.linkname = tarfile.SYMTYPE, '../../escape'
                dest.addfile(member)
            else:
                m.tar_add(dest, name, 1, io.BytesIO(b'x'))
    try:
        m.verify_archive(data, pins_path, archive)
        raise AssertionError('accepted ' + kind)
    except ValueError:
        pass
`, [f.pins, output]))
})

test('closure refuses incomplete and missing Rust packages and inconsistent registry integrity', { skip: !available }, t => {
  const f = fixture(t), data = JSON.parse(fs.readFileSync(f.pins))
  data.closure.unresolved.push('missing native source')
  fs.writeFileSync(f.pins, JSON.stringify(data))
  let result = run(['--pins', f.pins, 'verify-cache', '--cache', f.cache])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /incomplete/)
  data.closure.unresolved = []
  data.materials[0].integrity = 'sha512-' + Buffer.alloc(64).toString('base64')
  fs.writeFileSync(f.pins, JSON.stringify(data))
  result = run(['--pins', f.pins, 'verify-cache', '--cache', f.cache])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Registry integrity mismatch/)
  delete data.materials[0].integrity
  data.materials[0].kind = 'crate'
  data.materials[0].crate = 'unaccounted-package'
  fs.writeFileSync(f.pins, JSON.stringify(data))
  result = run(['--pins', f.pins, 'verify-cache', '--cache', f.cache])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Cargo.lock source closure mismatch/)
})
