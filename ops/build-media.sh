#!/usr/bin/env bash
# The Python driver keeps JSON, archive validation and subprocess arguments portable.
set -euo pipefail
case "$(uname -s)" in
  MINGW*|MSYS*) media_python=/usr/bin/python3 ;;
  *) media_python=python3 ;;
esac
exec "$media_python" - "$0" "$@" <<'MEDIA_PYTHON'
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shlex
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request


def fail(message):
    raise RuntimeError(message)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


def artifact_name(artifact):
    url = urllib.parse.urlsplit(artifact['url'])
    allowed = {'ffmpeg.org', 'downloads.videolan.org', 'zlib.net'}
    name = url.path.rsplit('/', 1)[-1]
    if (url.scheme != 'https' or url.hostname not in allowed or url.username or
            url.password or url.port or url.query or url.fragment or
            not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', name) or
            not re.fullmatch(r'[a-f0-9]{64}', artifact['sha256'])):
        fail('Invalid pinned HTTPS artifact: ' + artifact['url'])
    return name


class UpstreamRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        old, new = urllib.parse.urlsplit(request.full_url), urllib.parse.urlsplit(url)
        if new.scheme != 'https' or new.netloc != old.netloc:
            fail('Refusing redirect outside the pinned HTTPS upstream')
        return super().redirect_request(request, fp, code, message, headers, url)


def fetch(artifact, cache, offline):
    destination = cache / artifact_name(artifact)
    if destination.is_symlink():
        fail('Refusing symlink in source cache: ' + str(destination))
    if destination.exists():
        if not destination.is_file() or sha256(destination) != artifact['sha256']:
            fail('SHA-256 mismatch in source cache: ' + str(destination))
        return destination
    if offline:
        fail('Missing offline source artifact: ' + str(destination))
    descriptor, temporary = tempfile.mkstemp(prefix='.download-', dir=cache)
    try:
        opener = urllib.request.build_opener(UpstreamRedirects)
        with os.fdopen(descriptor, 'wb') as output:
            with opener.open(artifact['url'], timeout=60) as response:
                length = 0
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    length += len(chunk)
                    if length > 64 * 1024 * 1024:
                        fail('Source download exceeds 64 MiB')
                    output.write(chunk)
        temporary = Path(temporary)
        if sha256(temporary) != artifact['sha256']:
            fail('SHA-256 mismatch downloading ' + artifact['url'])
        temporary.chmod(0o444)
        # A verified cache entry is never silently replaced, including on races.
        try:
            os.link(temporary, destination)
        except FileExistsError:
            if destination.is_symlink() or sha256(destination) != artifact['sha256']:
                fail('Conflicting source cache entry: ' + str(destination))
        return destination
    finally:
        Path(temporary).unlink(missing_ok=True)


def unpack(archive, destination, root_name):
    # Pinned upstream archives contain only regular files/directories. Do not
    # permit links, devices, traversal, or Windows drive/backslash paths.
    with tarfile.open(archive, 'r:xz') as source:
        members = source.getmembers()
        seen = set()
        for member in members:
            path = PurePosixPath(member.name)
            if (not path.parts or path.parts[0] != root_name or path.is_absolute() or
                    '..' in path.parts or '\\' in member.name or ':' in member.name or
                    not (member.isfile() or member.isdir()) or path in seen):
                fail('Unsafe source archive member: ' + member.name)
            seen.add(path)
        for member in members:
            target = destination / member.name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as stream, target.open('xb') as output:
                    shutil.copyfileobj(stream, output)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
    return destination / root_name


def binary_identity(path):
    with path.open('rb') as stream:
        header = stream.read(64)
        if header[:4] == b'\x7fELF':
            endian = '<' if header[5] == 1 else '>'
            machine = struct.unpack_from(endian + 'H', header, 18)[0]
            return 'linux', {62: 'x64', 183: 'arm64'}.get(machine, 'unsupported')
        if header[:2] == b'MZ':
            stream.seek(struct.unpack_from('<I', header, 60)[0])
            pe = stream.read(6)
            if pe[:4] == b'PE\0\0':
                return 'win32', {0x8664: 'x64', 0xaa64: 'arm64'}.get(struct.unpack_from('<H', pe, 4)[0], 'unsupported')
        if header[:4] == b'\xcf\xfa\xed\xfe':
            return 'darwin', {0x1000007: 'x64', 0x100000c: 'arm64'}.get(struct.unpack_from('<I', header, 4)[0], 'unsupported')
    fail('Not a supported native executable: ' + str(path))


def verify_cli(name, version_text, configuration_text, license_text, version):
    if not re.search(r'^' + name + r' version ' + re.escape(version) + r'(?:\s|$)', version_text, re.M):
        fail(name + ' reports the wrong version')
    for text in [version_text, configuration_text]:
        if re.search(r'--enable-(?:gpl|version3|nonfree)(?:\s|$|=)', text):
            fail(name + ' contains a forbidden licensing configuration')
    license_words = ' '.join(license_text.split())
    if ('GNU Lesser General Public License' not in license_words or
            'either version 2.1 of the License' not in license_words or
            'any later version' not in license_words or
            'GNU General Public License' in license_words):
        fail(name + ' runtime -L did not establish LGPL-2.1-or-later')
    for option in ['--disable-autodetect', '--enable-libdav1d', '--enable-zlib']:
        if option not in configuration_text.split():
            fail(name + ' is missing required configuration ' + option)


def target_platform():
    system = platform.system()
    if system == 'Linux':
        target = 'linux'
    elif system == 'Darwin':
        target = 'darwin'
    elif system.startswith(('MINGW', 'MSYS')):
        target = 'win32'
    else:
        fail('Use native Linux/macOS or MSYS2 with its /usr/bin/python3')
    machine = platform.machine().lower()
    architecture = {'x86_64': 'x64', 'amd64': 'x64', 'aarch64': 'arm64', 'arm64': 'arm64'}.get(machine)
    if not architecture or (target == 'win32' and architecture != 'x64'):
        fail('Supported targets: Linux/macOS x64/arm64, MSYS2 MinGW Windows x64')
    return target, architecture


def runtime_dependencies(platform_name, binary, run):
    if platform_name == 'win32':
        text = run(['objdump', '-p', str(binary)], binary.name + '-imports')
        names = re.findall(r'DLL Name:\s*(\S+)', text, re.I)
        system = {'advapi32.dll', 'bcrypt.dll', 'crypt32.dll', 'gdi32.dll', 'imm32.dll',
                  'kernel32.dll', 'msvcrt.dll', 'ntdll.dll', 'ole32.dll', 'oleaut32.dll',
                  'psapi.dll', 'secur32.dll', 'shell32.dll', 'shlwapi.dll', 'user32.dll',
                  'userenv.dll', 'ucrtbase.dll', 'version.dll', 'winmm.dll', 'ws2_32.dll'}
        unexpected = [n for n in names if n.lower() not in system and not n.lower().startswith(('api-ms-win-', 'ext-ms-win-'))]
    elif platform_name == 'darwin':
        text = run(['otool', '-L', str(binary)], binary.name + '-imports')
        names = [line.strip().split(' (', 1)[0] for line in text.splitlines()[1:] if line.strip()]
        unexpected = [n for n in names if not n.startswith(('/usr/lib/', '/System/Library/'))]
    else:
        text = run(['readelf', '-d', str(binary)], binary.name + '-imports')
        names = re.findall(r'\(NEEDED\).*?\[(.*?)\]', text)
        unexpected = [n for n in names if not re.fullmatch(r'(?:lib(?:c|m|pthread|dl|rt|gcc_s|atomic)\.so\.[0-9]+|libc\.musl-(?:x86_64|aarch64)\.so\.1|ld-linux[^/]*\.so\.[0-9]+)', n)]
    if unexpected:
        fail('Unexpected runtime dependencies for ' + binary.name + ': ' + ', '.join(unexpected) + '; no untracked DLL/library is copied')
    return {'path': 'bin/' + binary.name, 'osProvidedImports': names, 'bundledRuntimeLibraries': []}


def media_linker_flags(platform_name, install):
    flags = ['-L' + str(install / 'lib')]
    if platform_name == 'win32':
        # -static-libgcc alone still permits libwinpthread-1.dll, including via
        # the compiler's POSIX thread runtime. Keep all MinGW archives static.
        flags += ['-static', '-static-libgcc']
    return flags


def windows_static_thread_probe(compiler, work, install, run):
    source = work / 'thread-runtime-probe.c'
    source.write_text('#include <pthread.h>\nstatic void *thread(void *value) { return value; }\nint main(void) { pthread_t id; if (pthread_create(&id, 0, thread, 0)) return 1; return pthread_join(id, 0); }\n', encoding='utf-8')
    executable = work / 'thread-runtime-probe.exe'
    run([compiler, source, '-o', executable, '-pthread', *media_linker_flags('win32', install)], 'windows-static-thread-link')
    runtime_dependencies('win32', executable, run)
    run([executable], 'windows-static-thread-run')


def windows_toolchain_materials(compiler, mingw_prefix, out, run):
    root = Path(mingw_prefix).resolve()
    if not mingw_prefix or root.name not in ('mingw64', 'ucrt64'):
        fail('Windows runtime provenance requires the MSYS2 MINGW_PREFIX')
    package_prefix = 'mingw-w64-' + ('ucrt-' if root.name == 'ucrt64' else '') + 'x86_64-'
    materials = {'linkage': 'static MinGW compiler/thread runtime; Windows OS DLL imports remain dynamic',
                 'linkerFlags': ['-static', '-static-libgcc'], 'packages': [], 'inputs': [], 'notices': []}
    packages = {}

    def owner_of(filename, label):
        owner = run(['pacman', '-Qqo', filename], 'windows-owner-' + label).strip()
        if not re.fullmatch(re.escape(package_prefix) + r'[a-z0-9+_-]+', owner):
            fail('Unrecognized MSYS2 runtime package owner: ' + owner)
        if owner not in packages:
            identity = run(['pacman', '-Q', owner], 'windows-version-' + owner).strip().split()
            if len(identity) != 2 or identity[0] != owner or not re.fullmatch(r'[A-Za-z0-9.+:_-]+', identity[1]):
                fail('Invalid installed MSYS2 package identity')
            run(['pacman', '-Qi', owner], 'windows-package-' + owner)
            packages[owner] = {'name': owner, 'version': identity[1],
                               'metadataLog': 'logs/windows-package-' + owner + '.log'}
            materials['packages'].append(packages[owner])
        return owner

    required = {
        'winpthreads': ['COPYING'],
        'crt': ['COPYING', 'COPYING.MinGW-w64-runtime.txt', 'COPYING.MinGW-w64.txt'],
        'gcc': ['COPYING.RUNTIME', 'COPYING3'],
    }
    notice_sources = []
    for group, names in required.items():
        for name in names:
            source = root / 'share/licenses' / group / name
            if not source.is_file() or not source.read_bytes().strip():
                fail('Missing installed MinGW runtime notice: ' + str(source))
            owner = owner_of(source, group + '-' + name)
            if owner != package_prefix + group:
                fail('Wrong package owner for MinGW runtime notice: ' + str(source))
            notice_sources.append((group, name, source, owner))
    # Record the exact compiler-selected static inputs; do not copy toolchain
    # objects, DLLs, or libraries into the distributable/source archive.
    for name in ['libwinpthread.a', 'libpthread.a', 'libgcc.a', 'libmingw32.a', 'libmingwex.a', 'crt2.o']:
        selected = run([compiler, '-print-file-name=' + name], 'windows-input-' + name).strip()
        if not selected or selected == name:
            fail('Missing static MinGW runtime input: ' + name)
        selected_path = Path(run(['cygpath', '-u', selected], 'windows-path-' + name).strip())
        source = selected_path.resolve()
        if root not in source.parents or not source.is_file() or selected_path.name != name:
            fail('Compiler-selected runtime input escapes MINGW_PREFIX: ' + str(source))
        owner = owner_of(source, name)
        if owner not in (package_prefix + 'winpthreads', package_prefix + 'gcc', package_prefix + 'crt'):
            fail('Unreviewed static MinGW runtime input owner: ' + owner)
        materials['inputs'].append({'compilerSelection': name, 'selectedPath': str(selected_path), 'installedPath': str(source),
                                    'sha256': sha256(source), 'package': owner})
    for group, name, source, owner in notice_sources:
        destination = out / 'licenses/mingw-w64' / group / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        materials['notices'].append({'path': destination.relative_to(out).as_posix(),
                                     'installedPath': str(source), 'sha256': sha256(destination), 'package': owner})
    for group in required:
        package = packages[package_prefix + group]
        version = package['version'].split(':')[-1]
        package['sourcePackageUrl'] = 'https://mirror.msys2.org/mingw/sources/mingw-w64-' + group + '-' + version + '.src.tar.zst'
        package['sourcePackageRetained'] = False
    write_json(out / 'licenses/mingw-w64/provenance.json', materials)
    return materials


def main(script, argv):
    parser = argparse.ArgumentParser(description='Build paired pinned media tools; prefix holds work/install files, out holds distributable files only.')
    parser.add_argument('directories', nargs='*', metavar='PREFIX OUT')
    parser.add_argument('--prefix', type=Path)
    parser.add_argument('--out', type=Path)
    parser.add_argument('--cache', type=Path, default=Path.home() / '.cache/llm-canvas-controlled-media')
    parser.add_argument('--jobs', default=os.environ.get('JOBS', '2'))
    parser.add_argument('--asm', dest='assembly', choices=['auto', 'on', 'off'], default='auto')
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--fetch-only', action='store_true', help='Only populate/verify pinned source cache; no compiler/build tools required')
    args = parser.parse_args(argv)
    if args.directories:
        if len(args.directories) != 2 or args.prefix or args.out:
            parser.error('Use PREFIX OUT or --prefix PREFIX --out OUT')
        args.prefix, args.out = map(Path, args.directories)
    if not re.fullmatch(r'[1-9][0-9]*', str(args.jobs)) or not 1 <= int(args.jobs) <= 64:
        parser.error('JOBS/--jobs must be an integer from 1 to 64')
    if not args.fetch_only and (args.prefix is None or args.out is None):
        parser.error('--prefix and --out are required for a build')
    script = Path(script).resolve()
    lock_file = script.with_name('media-sources.json')
    notices_file = script.parent.parent / 'docs/MEDIA-NOTICES.md'
    lock = json.loads(lock_file.read_text(encoding='utf-8'))
    sources = lock['sources']
    if [(s['name'], s['version']) for s in sources] != [('ffmpeg', '9.0.2'), ('dav1d', '1.5.4'), ('zlib', '1.3.2')]:
        fail('Unexpected media source set')
    artifacts = [a for s in sources for a in [s['archive'], s['signature'], *s.get('evidence', [])]]
    names = [artifact_name(a) for a in artifacts]
    if len(names) != len(set(names)):
        fail('Duplicate source artifact filenames')
    cache = args.cache.expanduser().resolve()
    if not args.fetch_only:
        prefix, out = args.prefix.expanduser().absolute(), args.out.expanduser().absolute()
        if prefix.exists() or prefix.is_symlink() or out.exists() or out.is_symlink():
            fail('Use fresh, nonexistent prefix and output directories; existing data is never removed')
        prefix, out = prefix.resolve(), out.resolve()
        for a, b in [(prefix, out), (prefix, cache), (out, cache)]:
            if a == b or a in b.parents or b in a.parents:
                fail('Prefix, output and cache must be separate, non-nested directories')
        if re.search(r'\s', str(prefix)):
            fail('FFmpeg/Make require a prefix path without whitespace')
    cache.mkdir(parents=True, exist_ok=True)
    fetched = {artifact_name(a): fetch(a, cache, args.offline) for a in artifacts}
    if args.fetch_only:
        print(json.dumps({'verifiedArtifacts': names, 'cache': str(cache)}))
        return

    platform_name, architecture = target_platform()
    compiler = shutil.which(os.environ.get('CC', 'gcc' if platform_name == 'win32' else 'cc'))
    if not compiler:
        fail('Missing compiler (CC must name a single native compiler executable)')
    inspector = {'linux': 'readelf', 'darwin': 'otool', 'win32': 'objdump'}[platform_name]
    pkg_config = shutil.which('pkg-config') or shutil.which('pkgconf')
    required = ['bash', 'make', 'meson', 'ninja', 'ar', 'ranlib', 'nm', 'sed', 'awk', inspector]
    missing = [name for name in required if not shutil.which(name)]
    if missing or not pkg_config:
        fail('Missing build tools: ' + ', '.join(missing + ([] if pkg_config else ['pkg-config/pkgconf'])))
    if platform_name == 'win32' and any(not shutil.which(tool) for tool in ['pacman', 'cygpath']):
        fail('Windows runtime provenance requires MSYS2 pacman and cygpath')
    nasm = shutil.which('nasm')
    if args.assembly == 'on' and not nasm:
        fail('--asm on requires NASM; use auto or off for a portable C build')
    assembly = args.assembly != 'off' and nasm is not None
    prefix.mkdir(parents=True)
    out.mkdir(parents=True)
    work, install, logs = prefix / 'work', prefix / 'install', out / 'logs'
    for directory in [work, install, logs, out / 'bin', out / 'licenses']:
        directory.mkdir()
    inputs = prefix / 'archives'
    inputs.mkdir()
    # Snapshot verified bytes before compilation so a shared cache changed by
    # another build cannot alter the eventual corresponding source bundle.
    for artifact in artifacts:
        name = artifact_name(artifact)
        snapshot = inputs / name
        shutil.copyfile(fetched[name], snapshot)
        if sha256(snapshot) != artifact['sha256']:
            fail('Source cache changed while snapshotting ' + name)
        snapshot.chmod(0o444)
        fetched[name] = snapshot
    # Never record the caller's full environment or inherit arbitrary build flags.
    allowed_env = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'SystemRoot',
                   'WINDIR', 'COMSPEC', 'PATHEXT', 'MSYSTEM', 'MINGW_PREFIX',
                   'PYTHONPATH', 'LD_LIBRARY_PATH']
    env = {key: os.environ[key] for key in allowed_env if key in os.environ}
    env.update({'LC_ALL': 'C', 'LANG': 'C', 'CC': compiler, 'CFLAGS': '-O2',
                'PKG_CONFIG': pkg_config, 'PKG_CONFIG_PATH': '',
                'PKG_CONFIG_LIBDIR': str(install / 'lib/pkgconfig'),
                'PKG_CONFIG_SYSTEM_INCLUDE_PATH': '', 'PKG_CONFIG_SYSTEM_LIBRARY_PATH': ''})
    commands = []

    def run(command, label, cwd=work):
        command = [str(part) for part in command]
        commands.append({'argv': command, 'cwd': str(cwd), 'log': 'logs/' + label + '.log'})
        write_json(logs / 'commands.json', commands)
        print('media-build: ' + label, flush=True)
        with (logs / (label + '.log')).open('w', encoding='utf-8') as log:
            log.write('$ ' + shlex.join(command) + '\n')
            log.flush()
            result = subprocess.run(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
        text = (logs / (label + '.log')).read_text(encoding='utf-8', errors='replace')
        if result.returncode:
            fail(label + ' failed; see ' + str(logs / (label + '.log')))
        return text.split('\n', 1)[1]

    versions = {}
    for name, command in [('compiler', [compiler, '--version']), ('make', ['make', '--version']),
                          ('meson', ['meson', '--version']), ('ninja', ['ninja', '--version']),
                          ('pkgConfig', [pkg_config, '--version'])]:
        versions[name] = run(command, 'tool-' + name).strip()
    versions['compilerTarget'] = run([compiler, '-dumpmachine'], 'compiler-target').strip()
    if platform_name == 'win32' and not re.fullmatch(r'x86_64-w64-mingw32', versions['compilerTarget']):
        fail('Windows builds require the native MinGW-w64 x64 compiler, not MSYS/Cygwin gcc')
    toolchain_runtime = None
    if platform_name == 'win32':
        toolchain_runtime = windows_toolchain_materials(compiler, os.environ.get('MINGW_PREFIX', ''), out, run)
        windows_static_thread_probe(compiler, work, install, run)
    if nasm:
        versions['nasm'] = run([nasm, '-v'], 'tool-nasm').strip()
    if platform_name == 'darwin':
        env['SDKROOT'] = run(['xcrun', '--show-sdk-path'], 'macos-sdk-path').strip()
        versions['sdk'] = run(['xcrun', '--show-sdk-version'], 'macos-sdk-version').strip()
        env['MACOSX_DEPLOYMENT_TARGET'] = '11.0'
    write_json(logs / 'build-environment.json', {'controlledEnvironment': {k: env[k] for k in ['CC', 'CFLAGS', 'PKG_CONFIG', 'PKG_CONFIG_LIBDIR', 'SDKROOT', 'MACOSX_DEPLOYMENT_TARGET', 'PYTHONPATH', 'LD_LIBRARY_PATH'] if k in env}, 'tools': versions, 'jobs': int(args.jobs), 'assembly': assembly})

    trees = {}
    for source in sources:
        trees[source['name']] = unpack(fetched[artifact_name(source['archive'])], work, source['name'] + '-' + source['version'])
    zlib = trees['zlib']
    run(['bash', './configure', '--static', '--prefix=' + str(install)], 'zlib-configure', zlib)
    run(['make', '-j' + str(args.jobs)], 'zlib-make', zlib)
    run(['make', 'install'], 'zlib-install', zlib)
    dav1d_build = work / 'dav1d-build'
    run(['meson', 'setup', dav1d_build, trees['dav1d'], '--prefix=' + str(install),
         '--libdir=lib', '--buildtype=release', '--default-library=static', '--wrap-mode=nodownload',
         '-Denable_asm=' + str(assembly).lower(), '-Denable_tools=false', '-Denable_tests=false',
         '-Denable_examples=false', '-Denable_docs=false', '-Dxxhash_muxer=disabled'], 'dav1d-configure')
    run(['ninja', '-C', dav1d_build, '-j', args.jobs], 'dav1d-make')
    run(['ninja', '-C', dav1d_build, 'install'], 'dav1d-install')
    for package, expected in [('dav1d', '1.5.4'), ('zlib', '1.3.2')]:
        if run([pkg_config, '--modversion', package], 'dependency-' + package).strip() != expected:
            fail('Wrong installed dependency version: ' + package)
    ffmpeg = trees['ffmpeg']
    flags = ['--prefix=' + str(install), '--cc=' + compiler, '--disable-autodetect',
             '--disable-gpl', '--disable-version3', '--disable-nonfree', '--enable-static',
             '--disable-shared', '--disable-debug', '--disable-doc', '--disable-ffplay',
             '--disable-avdevice', '--enable-ffmpeg', '--enable-ffprobe',
             '--enable-libdav1d', '--enable-zlib', '--pkg-config=' + pkg_config,
             '--pkg-config-flags=--static', '--extra-cflags=-I' + str(install / 'include'),
             '--extra-ldflags=' + ' '.join(media_linker_flags(platform_name, install))]
    if not assembly:
        flags.append('--disable-asm')
    if platform_name == 'win32':
        flags += ['--target-os=mingw32', '--disable-pthreads', '--enable-w32threads']
    run(['bash', './configure', *flags], 'ffmpeg-configure', ffmpeg)
    run(['make', '-j' + str(args.jobs)], 'ffmpeg-make', ffmpeg)
    suffix = '.exe' if platform_name == 'win32' else ''
    binaries, dependencies = [], []
    for name in ['ffmpeg', 'ffprobe']:
        target = out / 'bin' / (name + suffix)
        shutil.copy2(ffmpeg / (name + suffix), target)
        actual_platform, actual_arch = binary_identity(target)
        if (actual_platform, actual_arch) != (platform_name, architecture):
            fail('Native binary target mismatch: ' + name)
        version = run([target, '-version'], name + '-version')
        configuration = run([target, '-buildconf'], name + '-buildconf')
        license_text = run([target, '-L'], name + '-license')
        verify_cli(name, version, configuration, license_text, '9.0.2')
        binaries.append({'path': 'bin/' + target.name, 'sha256': sha256(target),
                         'platform': actual_platform, 'architecture': actual_arch, 'license': 'LGPL-2.1-or-later'})
        dependencies.append(runtime_dependencies(platform_name, target, run))
    write_json(out / 'runtime-dependencies.json', dependencies)
    for name in ['ffmpeg', 'dav1d', 'zlib']:
        destination = out / 'licenses' / name
        destination.mkdir()
        names = ['LICENSE.md', *[p.name for p in trees[name].glob('COPYING.*')]] if name == 'ffmpeg' else ['COPYING' if name == 'dav1d' else 'LICENSE']
        for filename in names:
            shutil.copy2(trees[name] / filename, destination / filename)
    shutil.copy2(notices_file, out / 'MEDIA-NOTICES.md')
    # Preserve generated build inputs/configuration, never object files or a
    # caller's environment. Immutable release tarballs remain the source of truth.
    for tree, relative_files in [(zlib, ['configure.log', 'Makefile', 'zlib.pc']),
                                 (dav1d_build, ['meson-logs/meson-log.txt', 'meson-info/intro-buildoptions.json', 'build.ninja']),
                                 (ffmpeg, ['config.h', 'config_components.h', 'ffbuild/config.log', 'ffbuild/config.mak'])]:
        for filename in relative_files:
            origin = tree / filename
            if origin.is_file():
                destination = logs / tree.name / filename
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(origin, destination)
    record = {'schemaVersion': 1, 'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'platform': platform_name, 'architecture': architecture, 'ffmpegVersion': '9.0.2',
              'license': 'LGPL-2.1-or-later', 'files': binaries, 'sources': sources,
              'sourceChanges': 'No patches; upstream-generated configure/build files only.',
              'tools': versions, 'assembly': assembly, 'jobs': int(args.jobs),
              'runtimeDependencies': dependencies, 'signaturePolicy': 'Pinned SHA-256 checked for every retained archive/signature/evidence file; no signature verification performed by this build.',
              'codeSigning': 'Not performed by this build.'}
    if toolchain_runtime:
        record['toolchainRuntime'] = toolchain_runtime
    bundle = prefix / 'source-materials'
    (bundle / 'archives').mkdir(parents=True)
    (bundle / 'ops').mkdir()
    (bundle / 'docs').mkdir()
    for name, origin in fetched.items():
        shutil.copy2(origin, bundle / 'archives' / name)
    for artifact in artifacts:
        if sha256(bundle / 'archives' / artifact_name(artifact)) != artifact['sha256']:
            fail('Source snapshot changed before bundling')
    shutil.copy2(script, bundle / 'ops/build-media.sh')
    shutil.copy2(lock_file, bundle / 'ops/media-sources.json')
    shutil.copy2(notices_file, bundle / 'docs/MEDIA-NOTICES.md')
    shutil.copytree(logs, bundle / 'logs')
    shutil.copytree(out / 'licenses', bundle / 'licenses')
    write_json(bundle / 'build-record.json', record)
    (bundle / 'REBUILD.txt').write_text('Sources are unchanged upstream release archives. From this extracted directory, with the documented native toolchain:\nJOBS=2 bash ops/build-media.sh --offline --cache "$PWD/archives" --prefix /absolute/fresh-work --out /absolute/fresh-output\nThe original exact commands and compiler versions are in logs/. Old absolute paths are informational; the script generates fresh paths. No signing was performed.\n', encoding='utf-8')
    archive = out / 'media-sources.tar.xz'
    with tarfile.open(archive, 'w:xz', preset=0) as output:
        output.add(bundle, arcname='media-sources')
    record['sourceArchive'] = {'path': archive.name, 'sha256': sha256(archive)}
    # files is an exhaustive distributable inventory except manifest.json itself.
    record['files'] = [{'path': str(p.relative_to(out)).replace(os.sep, '/'), 'sha256': sha256(p)}
                       for p in sorted(out.rglob('*')) if p.is_file()]
    write_json(out / 'manifest.json', record)
    print('media-build: ready ' + str(out / 'manifest.json'), flush=True)


if __name__ == '__main__':
    try:
        main(sys.argv[1], sys.argv[2:])
    except (RuntimeError, OSError, ValueError, KeyError, tarfile.TarError) as error:
        print('media-build: ' + str(error), file=sys.stderr)
        sys.exit(1)
MEDIA_PYTHON
