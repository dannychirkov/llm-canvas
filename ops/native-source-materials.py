#!/usr/bin/env python3
"""Acquire pinned native sources, assemble deterministically, verify without network.

Python 3.11+, standard library only. Archives are read as streams, never extracted.
The cache contains regular, flat files (including on ExFAT); chmod is not used.
"""
import argparse
import base64
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tarfile
import tomllib
import urllib.request
from urllib.parse import urlsplit
import zipfile

HERE = Path(__file__).resolve().parent
DEFAULT_PINS = HERE / 'native-source-pins.json'
MAX_TEXT = 16 * 1024 * 1024


def canonical(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=True) + '\n').encode()


def safe_path(name):
    if (not isinstance(name, str) or not name or name.startswith('/')
            or '\\' in name or ':' in name or '\x00' in name
            or '..' in name.split('/')):
        raise ValueError(f'Unsafe archive path: {name!r}')
    normalized = str(PurePosixPath(name))
    if normalized == '.':
        raise ValueError(f'Unsafe archive path: {name!r}')
    return normalized


def regular(path):
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError(f'Expected regular file: {path}')


def digest(stream, algorithm='sha256'):
    h = hashlib.new(algorithm)
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        h.update(chunk)
    return h.hexdigest()


def file_hash(path):
    regular(path)
    with path.open('rb') as stream:
        return digest(stream)


def load_pins(path):
    data = json.loads(path.read_bytes())
    if data.get('schema') != 1 or not data.get('materials'):
        raise ValueError('Unsupported or empty pins')
    seen = set()
    for row in data['materials']:
        name = row['file']
        if safe_path(name) != name or '/' in name or name in seen:
            raise ValueError(f'Unsafe or duplicate cache filename: {name}')
        seen.add(name)
        if not re.fullmatch('[a-f0-9]{64}', row['sha256']) or row['size'] <= 0:
            raise ValueError(f'Invalid pin: {name}')
        if urlsplit(row['url']).scheme != 'https':
            raise ValueError(f'Expected HTTPS primary source: {name}')
        for member in row.get('members', []):
            safe_path(member['name'])
            safe_path(member['path'])
        if (row['kind'] in ('source', 'crate') and not row.get('noticeSupplement')
                and not any(m.get('role') == 'notice' for m in row.get('members', []))):
            raise ValueError(f'Missing full notice/license inventory: {name}')
    by_file = {r['file']: r for r in data['materials']}
    for row in data['materials']:
        for name in row.get('noticeSupplement', []):
            if name not in by_file or not (by_file[name]['kind'] == 'license-text' or any(m.get('role') == 'notice' for m in by_file[name].get('members', []))):
                raise ValueError(f'Missing supplemental full license: {name}')
    return data


def verify_input(cache, row):
    path = cache / row['file']
    if not path.exists():
        raise ValueError(f'Missing offline source artifact: {path}; URL {row["url"]}')
    if file_hash(path) != row['sha256'] or path.stat().st_size != row['size']:
        raise ValueError(f'SHA-256/size mismatch: {path}')
    if row.get('integrity'):
        algorithm, expected = row['integrity'].split('-', 1)
        if algorithm != 'sha512':
            raise ValueError('Unsupported registry integrity algorithm')
        with path.open('rb') as stream:
            actual = base64.b64encode(bytes.fromhex(digest(stream, algorithm))).decode()
        if actual != expected:
            raise ValueError(f'Registry integrity mismatch: {path}')
    if row.get('lockChecksum', row['sha256']) != row['sha256']:
        raise ValueError(f'Cargo.lock checksum mismatch: {path}')


def selected_members(path, row):
    """Read selected text only; never follow archive links or write archive paths."""
    wanted = {m['name']: m for m in row.get('members', [])}
    if not wanted:
        return {}
    found, seen = {}, set()

    def accept(name, is_file, size, reader):
        normalized = safe_path(name)
        if normalized in seen:
            raise ValueError(f'Duplicate source archive path: {name}')
        seen.add(normalized)
        if name not in wanted:
            return
        if not is_file or size > MAX_TEXT:
            raise ValueError(f'Unsafe selected member type/size: {name}')
        with reader() as stream:
            content = stream.read(MAX_TEXT + 1)
        pin = wanted[name]
        if len(content) != pin['size'] or hashlib.sha256(content).hexdigest() != pin['sha256']:
            raise ValueError(f'Selected member SHA-256 mismatch: {name}')
        found[name] = content

    if row['format'] == 'zip':
        with zipfile.ZipFile(path) as archive:
            for member in archive.infolist():
                mode = member.external_attr >> 16
                accept(member.filename, not member.is_dir() and not stat.S_ISLNK(mode),
                       member.file_size, lambda m=member: archive.open(m))
    elif row['format'] == 'tar':
        with tarfile.open(path, 'r|*') as archive:
            for member in archive:
                accept(member.name, member.isfile(), member.size,
                       lambda m=member: archive.extractfile(m))
    else:
        raise ValueError(f'Unexpected format for selected members: {row["format"]}')
    if set(found) != set(wanted):
        raise ValueError(f'Missing source archive members: {sorted(set(wanted) - set(found))}')
    return found


def verify_closure(data, cache):
    """Check the component/target and Rust source inventory, not legal conclusions."""
    closure = data['closure']
    if closure['status'] != 'materials-complete' or closure.get('unresolved'):
        raise ValueError('Native source materials are incomplete')
    by_file = {r['file']: r for r in data['materials']}
    components = {r['name']: r for r in closure['components']}
    for component in components.values():
        for name in component['materials']:
            if name not in by_file or by_file[name]['kind'] != 'source':
                raise ValueError(f'Missing component source: {name}')
    for target in closure['platforms']:
        row = by_file[target['evidence']]
        members = selected_members(cache / row['file'], row)
        versions = json.loads(members[target['versionsMember']])
        versions.pop('sharp', None)
        if versions != {n: c['version'] for n, c in components.items() if n != 'gvdb'}:
            raise ValueError(f'Platform version inventory mismatch: {target["name"]}')
        if target['recipe'] not in by_file:
            raise ValueError('Missing platform recipe')
    rust = closure['rust']
    row = by_file[rust['archive']]
    members = selected_members(cache / row['file'], row)
    packages = tomllib.loads(members[rust['lockMember']].decode())['package']
    registry = {(p['name'], p['version']): p['checksum'] for p in packages
                if p.get('source', '').startswith('registry+')}
    supplied = {(r['crate'], r['version']): r['sha256'] for r in data['materials'] if r['kind'] == 'crate'}
    if registry != supplied:
        raise ValueError('Cargo.lock source closure mismatch')
    if any(p.get('source', '').startswith('git+') for p in packages):
        raise ValueError('Unaccounted git Rust dependency')
    for check in closure.get('windowsChecksums', []):
        if by_file[check['material']]['sha256'] != check['recipeChecksum']:
            raise ValueError(f'MXE source checksum mismatch: {check["component"]}')
    if 'electron' in closure:
        electron = closure['electron']
        row = by_file[electron['recipe']]
        members = selected_members(cache / row['file'], row)
        deps = members[electron['depsMember']].decode()
        if not re.search(r"'chromium_version':\s*'" + re.escape(electron['chromiumVersion']) + "'", deps):
            raise ValueError('Electron/Chromium DEPS mismatch')
        chromium = base64.b64decode((cache / electron['chromiumDeps']).read_bytes()).decode()
        if not re.search(r"'ffmpeg_revision':\s*'" + electron['ffmpegRevision'] + "'", chromium):
            raise ValueError('Chromium/FFmpeg DEPS mismatch')
        row = by_file[electron['ffmpegSource']]
        if electron['ffmpegRevision'] not in row['url']:
            raise ValueError('FFmpeg source URL does not match DEPS')
        members = selected_members(cache / row['file'], row)
        for name in electron['ffmpegConfigurations']:
            if name not in members:
                raise ValueError(f'Missing FFmpeg build configuration: {name}')
        row = by_file[electron['binaryEvidence']]
        members = selected_members(cache / row['file'], row)
        if b'ffmpeg' not in members['LICENSES.chromium.html']:
            raise ValueError('Electron FFmpeg notice missing')


def support_files(pins_path):
    doc = HERE.parent / 'docs' / 'NATIVE-SOURCE-MATERIALS.md'
    if not doc.exists():
        doc = HERE / 'REBUILD.md'
    return {'native-source-pins.json': pins_path.read_bytes(),
            'native-source-materials.py': Path(__file__).read_bytes(),
            'REBUILD.md': doc.read_bytes()}


def expected_files(data, support):
    expected = {}

    def add(name, size, sha, origin):
        if safe_path(name) != name or name in expected:
            raise ValueError(f'Unsafe or duplicate companion path: {name}')
        expected[name] = dict(path=name, size=size, sha256=sha, origin=origin)

    for row in data['materials']:
        if row.get('include', True):
            add(row['path'], row['size'], row['sha256'], row['file'])
        for member in row.get('members', []):
            add(member['path'], member['size'], member['sha256'], row['file'] + '#' + member['name'])
    for name, content in support.items():
        add(name, len(content), hashlib.sha256(content).hexdigest(), 'companion-tooling')
    return expected


def manifest_bytes(data, expected):
    return canonical({'schema': 1, 'closure': data['closure'],
                      'materials': data['materials'],
                      'files': [expected[n] for n in sorted(expected)]})


def tar_add(archive, name, size, stream):
    member = tarfile.TarInfo(name)
    member.size, member.mode, member.mtime = size, 0o644, 0
    member.uid = member.gid = 0
    member.uname = member.gname = ''
    archive.addfile(member, stream)


def assemble(data, pins_path, cache, output):
    if output.exists() or output.is_symlink():
        raise ValueError('Output must be fresh and nonexistent')
    for row in data['materials']:
        verify_input(cache, row)
    verify_closure(data, cache)
    support = support_files(pins_path)
    expected = expected_files(data, support)
    temporary = output.with_name(output.name + '.part')
    if temporary.exists() or temporary.is_symlink():
        raise ValueError('Temporary output already exists')
    try:
        with temporary.open('xb') as raw, gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0, compresslevel=6) as compressed:
            with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.PAX_FORMAT) as archive:
                for row in sorted(data['materials'], key=lambda r: r['file']):
                    if row.get('include', True):
                        with (cache / row['file']).open('rb') as stream:
                            tar_add(archive, row['path'], row['size'], stream)
                    content = selected_members(cache / row['file'], row)
                    for member in sorted(row.get('members', []), key=lambda m: m['path']):
                        tar_add(archive, member['path'], member['size'], io.BytesIO(content[member['name']]))
                for name, content in sorted(support.items()):
                    tar_add(archive, name, len(content), io.BytesIO(content))
                content = manifest_bytes(data, expected)
                tar_add(archive, 'MANIFEST.json', len(content), io.BytesIO(content))
        verify_archive(data, pins_path, temporary)
        # ExFAT has no hard links; reserve the final name with exclusive create.
        with output.open('xb') as destination, temporary.open('rb') as source:
            shutil.copyfileobj(source, destination, 1024 * 1024)
    finally:
        if temporary.exists():
            temporary.unlink()
    return file_hash(output)


def verify_archive(data, pins_path, path):
    regular(path)
    support = support_files(pins_path)
    expected = expected_files(data, support)
    content = manifest_bytes(data, expected)
    expected['MANIFEST.json'] = dict(size=len(content), sha256=hashlib.sha256(content).hexdigest())
    seen = set()
    with tarfile.open(path, 'r|gz') as archive:
        for member in archive:
            name = safe_path(member.name)
            if name != member.name or name in seen or name not in expected or not member.isfile():
                raise ValueError(f'Unexpected, duplicate or unsafe companion member: {member.name}')
            seen.add(name)
            wanted = expected[name]
            if (member.size != wanted['size'] or member.uid != 0 or member.gid != 0
                    or member.mtime != 0 or member.mode != 0o644 or member.uname or member.gname):
                raise ValueError(f'Companion member metadata/size mismatch: {name}')
            with archive.extractfile(member) as stream:
                if digest(stream) != wanted['sha256']:
                    raise ValueError(f'Companion SHA-256 mismatch: {name}')
    if seen != set(expected):
        raise ValueError(f'Missing companion members: {sorted(set(expected) - seen)}')
    # Read to gzip EOF as well: validate its CRC, including bytes after TAR EOF.
    with gzip.open(path, 'rb') as stream:
        while stream.read(1024 * 1024):
            pass
    return len(seen)


def fetch(data, cache):
    cache.mkdir(parents=True, exist_ok=True)
    for row in data['materials']:
        path = cache / row['file']
        if not path.exists():
            temporary = path.with_name(path.name + '.part')
            if temporary.exists() or temporary.is_symlink():
                raise ValueError(f'Temporary download exists: {temporary}')
            try:
                request = urllib.request.Request(row['url'], headers={'User-Agent': 'llm-canvas-native-sources/1'})
                with urllib.request.urlopen(request, timeout=90) as source, temporary.open('xb') as dest:
                    shutil.copyfileobj(source, dest, 1024 * 1024)
                verify_input(cache, dict(row, file=temporary.name))
                with path.open('xb') as dest, temporary.open('rb') as source:
                    shutil.copyfileobj(source, dest, 1024 * 1024)
            finally:
                if temporary.exists():
                    temporary.unlink()
        verify_input(cache, row)
    verify_closure(data, cache)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pins', type=Path, default=DEFAULT_PINS)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ['fetch', 'verify-cache', 'assemble']:
        command = commands.add_parser(name)
        command.add_argument('--cache', type=Path, required=True)
        if name == 'assemble':
            command.add_argument('--out', type=Path, required=True)
    command = commands.add_parser('verify')
    command.add_argument('--archive', type=Path, required=True)
    command.add_argument('--sha256', help='Expected whole-archive hash, including gzip headers/padding')
    args = parser.parse_args()
    data = load_pins(args.pins)
    if args.command == 'fetch':
        fetch(data, args.cache)
    elif args.command == 'verify-cache':
        for row in data['materials']:
            verify_input(args.cache, row)
        verify_closure(data, args.cache)
    elif args.command == 'assemble':
        print(assemble(data, args.pins, args.cache, args.out))
    else:
        if args.sha256 and file_hash(args.archive) != args.sha256:
            raise ValueError('Whole archive SHA-256 mismatch')
        print(f'Verified {verify_archive(data, args.pins, args.archive)} pinned files offline')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, tarfile.TarError, zipfile.BadZipFile) as error:
        print(f'native-source-materials: {error}', file=sys.stderr)
        sys.exit(1)
