const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const script = path.resolve(__dirname, '../ops/build-media.sh')
const driver = fs.readFileSync(script, 'utf8').split("<<'MEDIA_PYTHON'\n")[1].split('\nMEDIA_PYTHON')[0]
const python = process.platform === 'win32' ? '/usr/bin/python3' : 'python3'
const available = spawnSync(python, ['--version']).status === 0

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'media-build-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function cli(args, env = {}) {
  // Calling the real embedded entrypoint also works outside a POSIX shell in
  // Node tests; production invocation remains bash ops/build-media.sh.
  return spawnSync(python, ['-c', driver, script, ...args], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, ...env },
  })
}

function helpers(code) {
  return spawnSync(python, ['-c', '__name__ = "media_test"\n' + driver + '\n' + code], {
    encoding: 'utf8', timeout: 15000,
  })
}

test('offline media acquisition refuses missing or tampered pinned bytes without publishing output', { skip: !available }, t => {
  const root = temporary(t), cache = path.join(root, 'cache'), output = path.join(root, 'output')
  fs.mkdirSync(cache)
  let result = cli(['--fetch-only', '--offline', '--cache', cache, '--out', output])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Missing offline source artifact/)
  fs.writeFileSync(path.join(cache, 'ffmpeg-9.0.2.tar.xz'), 'modified upstream archive')
  result = cli(['--fetch-only', '--offline', '--cache', cache, '--out', output])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /SHA-256 mismatch/)
  assert.equal(fs.readFileSync(path.join(cache, 'ffmpeg-9.0.2.tar.xz'), 'utf8'), 'modified upstream archive')
  assert.equal(fs.existsSync(output), false)
})

test('build refuses existing directories and nested cache without deleting user data', { skip: !available }, t => {
  const root = temporary(t), prefix = path.join(root, 'work'), output = path.join(root, 'output')
  fs.mkdirSync(output)
  fs.writeFileSync(path.join(output, 'keep'), 'user data')
  let result = cli(['--prefix', prefix, '--out', output, '--offline', '--cache', path.join(root, 'cache')])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /fresh, nonexistent/)
  assert.equal(fs.readFileSync(path.join(output, 'keep'), 'utf8'), 'user data')
  result = cli(['--prefix', prefix, '--out', path.join(root, 'fresh'), '--offline', '--cache', path.join(prefix, 'cache')])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /non-nested/)
  assert.equal(fs.existsSync(prefix), false)
})

test('JOBS rejects shell expressions and unbounded parallel compilation before any writes', { skip: !available }, t => {
  const root = temporary(t), cache = path.join(root, 'cache')
  for (const jobs of ['0', '-1', '65', '2; touch injected', '$(touch injected)']) {
    const result = cli(['--fetch-only', '--offline', '--cache', cache], { JOBS: jobs })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /integer from 1 to 64/)
  }
  assert.equal(fs.existsSync(cache), false)
})

test('archive extraction rejects traversal, symlinks, devices and duplicate paths', { skip: !available }, () => {
  const result = helpers(`
import io
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    for kind in ['traversal', 'symlink', 'device', 'duplicate', 'backslash', 'drive']:
        archive = root / (kind + '.tar.xz')
        with tarfile.open(archive, 'w:xz') as output:
            member = tarfile.TarInfo({'traversal': 'source/../../escaped', 'backslash': 'source/..\\\\escaped', 'drive': 'source/C:escaped'}.get(kind, 'source/file'))
            if kind == 'symlink':
                member.type, member.linkname = tarfile.SYMTYPE, '../../escaped'
            elif kind == 'device':
                member.type = tarfile.CHRTYPE
            else:
                member.size = 1
            output.addfile(member, io.BytesIO(b'x') if member.isfile() else None)
            if kind == 'duplicate':
                output.addfile(member, io.BytesIO(b'y'))
        destination = root / kind
        destination.mkdir()
        try:
            unpack(archive, destination, 'source')
        except RuntimeError:
            assert list(destination.iterdir()) == [], kind
        else:
            raise AssertionError('Accepted unsafe ' + kind)
    assert not (root / 'escaped').exists()
    archive = root / 'good.tar.xz'
    with tarfile.open(archive, 'w:xz') as output:
        member = tarfile.TarInfo('source/configure')
        member.mode, member.size = 0o755, 2
        output.addfile(member, io.BytesIO(b'ok'))
    tree = unpack(archive, root / 'good', 'source')
    assert (tree / 'configure').read_bytes() == b'ok'
`)
  assert.equal(result.status, 0, result.stderr)
})

test('pinned artifacts reject HTTP, foreign hosts, credentials and malformed hashes', { skip: !available }, () => {
  const result = helpers(`
good = {'url': 'https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz', 'sha256': 'a' * 64}
assert artifact_name(good) == 'ffmpeg-9.0.2.tar.xz'
for bad in ['http://ffmpeg.org/source.tar.xz', 'https://example.com/source.tar.xz', 'https://user:password@ffmpeg.org/source.tar.xz', 'https://ffmpeg.org/source.tar.xz?mutable=1']:
    try:
        artifact_name(dict(good, url=bad))
    except RuntimeError:
        pass
    else:
        raise AssertionError('Accepted ' + bad)
try:
    artifact_name(dict(good, sha256='not-a-digest'))
except RuntimeError:
    pass
else:
    raise AssertionError('Accepted invalid digest')
`)
  assert.equal(result.status, 0, result.stderr)
})

test('CLI provenance rejects wrong version, GPL/nonfree configurations and unproven license', { skip: !available }, () => {
  const result = helpers(`
configuration = '--disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --enable-libdav1d --enable-zlib'
license_text = 'configuration: ' + configuration + '\\nGNU Lesser General Public License; either version 2.1 of the License, or any later version.'
verify_cli('ffmpeg', 'ffmpeg version 9.0.2 Copyright', configuration, license_text, '9.0.2')
cases = [('ffmpeg version 7.0.2', configuration, license_text),
         ('ffmpeg version 9.0.2', configuration, 'GNU General Public License version 3'),
         ('ffmpeg version 9.0.2', configuration, 'LGPL'),
         ('ffmpeg version 9.0.2', '--disable-autodetect', license_text)]
cases += [('ffmpeg version 9.0.2', configuration + ' --enable-' + flag, license_text) for flag in ['gpl', 'version3', 'nonfree']]
for version, config, license_output in cases:
    try:
        verify_cli('ffmpeg', version, config, license_output, '9.0.2')
    except RuntimeError:
        pass
    else:
        raise AssertionError('Accepted unproven runtime provenance')
`)
  assert.equal(result.status, 0, result.stderr)
})

test('actual wrapped FFmpeg license prose passes while wrapped GPL or LGPLv3 remains rejected', { skip: !available }, () => {
  const result = helpers(`
configuration = '--disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --enable-libdav1d --enable-zlib'
license_text = '''ffmpeg is free software; you can redistribute it and/or
modify it under the terms of the GNU Lesser General Public
License as published by the Free Software Foundation; either
version 2.1 of the License, or (at your option) any later version.'''
verify_cli('ffmpeg', 'ffmpeg version 9.0.2 Copyright', configuration, license_text, '9.0.2')
verify_cli('ffprobe', 'ffprobe version 9.0.2 Copyright', configuration, license_text, '9.0.2')
for bad in [license_text.replace('version 2.1', 'version 3'), license_text.replace('Lesser General Public\\nLicense', 'General Public\\nLicense')]:
    try:
        verify_cli('ffmpeg', 'ffmpeg version 9.0.2 Copyright', configuration, bad, '9.0.2')
    except RuntimeError:
        pass
    else:
        raise AssertionError('Accepted wrapped wrong license')
`)
  assert.equal(result.status, 0, result.stderr)
})

test('native architecture is derived from binary headers, not an arm64 directory name', { skip: !available }, () => {
  const result = helpers(`
with tempfile.TemporaryDirectory() as temporary:
    binary = Path(temporary) / 'arm64' / 'ffprobe'
    binary.parent.mkdir()
    header = bytearray(64)
    header[:4] = b'\\xcf\\xfa\\xed\\xfe'
    struct.pack_into('<I', header, 4, 0x1000007)
    binary.write_bytes(header)
    assert binary_identity(binary) == ('darwin', 'x64')
    binary.write_text('#!/bin/sh\\necho ffprobe version 9.0.2\\n')
    try:
        binary_identity(binary)
    except RuntimeError:
        pass
    else:
        raise AssertionError('Accepted a wrapper script as native executable')
`)
  assert.equal(result.status, 0, result.stderr)
})

test('unexpected Windows runtime DLLs block distribution instead of disappearing from inventory', { skip: !available }, () => {
  const result = helpers(`
def imports(names):
    return lambda *args: '\\n'.join('DLL Name: ' + name for name in names)
result = runtime_dependencies('win32', Path('ffmpeg.exe'), imports(['KERNEL32.dll', 'api-ms-win-crt-runtime-l1-1-0.dll']))
assert len(result['osProvidedImports']) == 2
assert result['bundledRuntimeLibraries'] == []
for name in ['libwinpthread-1.dll', 'libgcc_s_seh-1.dll', 'dav1d.dll']:
    try:
        runtime_dependencies('win32', Path('ffmpeg.exe'), imports(['KERNEL32.dll', name]))
    except RuntimeError:
        pass
    else:
        raise AssertionError('Accepted untracked runtime DLL ' + name)
`)
  assert.equal(result.status, 0, result.stderr)
})

test('Windows pthread probe uses static compiler linkage and rejects a captured DLL import', { skip: !available }, () => {
  const result = helpers(`
with tempfile.TemporaryDirectory() as temporary:
    work = Path(temporary)
    captured = []
    def run(command, label):
        command = [str(value) for value in command]
        captured.append((command, label))
        if command[0] == 'objdump':
            return 'DLL Name: KERNEL32.dll\\nDLL Name: msvcrt.dll\\n'
        return ''
    windows_static_thread_probe('fixture-gcc', work, work / 'install', run)
    command = captured[0][0]
    assert '-static' in command and '-static-libgcc' in command and '-pthread' in command
    assert 'pthread_create' in (work / 'thread-runtime-probe.c').read_text()
    assert 'pthread_join' in (work / 'thread-runtime-probe.c').read_text()
    assert captured[-1][1] == 'windows-static-thread-run'
    assert media_linker_flags('linux', work / 'install') == ['-L' + str(work / 'install/lib')]
    assert media_linker_flags('darwin', work / 'install') == ['-L' + str(work / 'install/lib')]
    def leaking_run(command, label):
        if str(command[0]) == 'objdump':
            return 'DLL Name: KERNEL32.dll\\nDLL Name: libwinpthread-1.dll\\n'
        return ''
    try:
        windows_static_thread_probe('fixture-gcc', work, work / 'install', leaking_run)
    except RuntimeError as error:
        assert 'libwinpthread-1.dll' in str(error)
    else:
        raise AssertionError('Accepted the original native Windows failure')
`)
  assert.equal(result.status, 0, result.stderr)
})

test('Windows retains exact installed runtime notices, package identities and static input hashes', { skip: !available }, () => {
  const result = helpers(`
with tempfile.TemporaryDirectory() as temporary:
    root, out = Path(temporary) / 'mingw64', Path(temporary) / 'out'
    out.mkdir()
    groups = {'winpthreads': ['COPYING'], 'crt': ['COPYING', 'COPYING.MinGW-w64-runtime.txt', 'COPYING.MinGW-w64.txt'], 'gcc': ['COPYING.RUNTIME', 'COPYING3']}
    originals = {}
    for group, names in groups.items():
        for name in names:
            source = root / 'share/licenses' / group / name
            source.parent.mkdir(parents=True, exist_ok=True)
            data = ('Synthetic installed notice ' + group + '/' + name + '\\n').encode()
            source.write_bytes(data)
            originals[group + '/' + name] = data
    inputs = ['libwinpthread.a', 'libpthread.a', 'libgcc.a', 'libmingw32.a', 'libmingwex.a', 'crt2.o']
    (root / 'lib').mkdir()
    for name in inputs:
        (root / 'lib' / name).write_bytes(('synthetic compiler input ' + name).encode())
    (root / 'lib/libpthread.a').unlink()
    (root / 'lib/libpthread.a').symlink_to('libwinpthread.a')
    captured = []
    def run(command, label):
        command = [str(value) for value in command]
        captured.append(command)
        if command[0] == 'fixture-gcc':
            return str(root / 'lib' / command[1].split('=', 1)[1])
        if command[0] == 'cygpath':
            return command[-1]
        if command[:2] == ['pacman', '-Qqo']:
            p = Path(command[2])
            if 'licenses' in p.parts:
                group = p.parent.name
            else:
                group = 'winpthreads' if p.name in ['libpthread.a', 'libwinpthread.a'] else 'gcc' if p.name == 'libgcc.a' else 'crt'
            return 'mingw-w64-x86_64-' + group + '\\n'
        if command[:2] == ['pacman', '-Q']:
            return command[2] + ' 1.2.3-4\\n'
        if command[:2] == ['pacman', '-Qi']:
            return 'Synthetic installed metadata for ' + command[2]
        raise AssertionError(command)
    record = windows_toolchain_materials('fixture-gcc', str(root), out, run)
    assert len(record['inputs']) == 6 and len(record['notices']) == 6 and len(record['packages']) == 3
    for notice in record['notices']:
        relative = notice['path'].removeprefix('licenses/mingw-w64/')
        assert (out / notice['path']).read_bytes() == originals[relative]
        assert notice['sha256'] == sha256(out / notice['path'])
    for item in record['inputs']:
        assert item['sha256'] == sha256(Path(item['installedPath']))
    for package in record['packages']:
        assert package['version'] == '1.2.3-4'
        assert package['sourcePackageUrl'].endswith('-1.2.3-4.src.tar.zst')
        assert package['sourcePackageRetained'] is False
    assert json.loads((out / 'licenses/mingw-w64/provenance.json').read_text()) == record
    assert not list(out.rglob('*.a')) and not list(out.rglob('*.o')) and not list(out.rglob('*.dll'))
    (root / 'share/licenses/winpthreads/COPYING').unlink()
    rejected = Path(temporary) / 'rejected'
    rejected.mkdir()
    captured.clear()
    try:
        windows_toolchain_materials('fixture-gcc', str(root), rejected, run)
    except RuntimeError as error:
        assert 'Missing installed MinGW runtime notice' in str(error)
    else:
        raise AssertionError('Accepted missing winpthread notices')
    assert not list(rejected.rglob('*'))
    assert not any(command[0] == 'fixture-gcc' for command in captured)
`)
  assert.equal(result.status, 0, result.stderr)
})
