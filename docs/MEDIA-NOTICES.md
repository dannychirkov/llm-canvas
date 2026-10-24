# Controlled desktop media tools

`ops/build-media.sh` builds a matched FFmpeg/FFprobe pair from unchanged upstream
FFmpeg 9.0.2 sources, with dav1d 1.5.4 and zlib 1.3.2. It does not install tools,
modify application packaging, sign binaries, or download binary distributions.
Native compilation and media acceptance are required on every target OS/CPU.

The intended FFmpeg executable license is **LGPL-2.1-or-later**. The build disables
GPL, version3, nonfree, and external-library autodetection, and checks **both
actual executables' `-L`, `-version`, and `-buildconf` output before writing a
successful manifest**. Native codecs/demuxers and filters remain enabled;
dav1d supplies software AV1 decoding and zlib supports compressed formats.
The application currently needs metadata, JPEG thumbnails and JPEG frame
extraction. Test H.264/HEVC/VP8/VP9/AV1, MP4/MOV/MKV/WebM, and those exact
operations before asserting functional equivalence to an earlier distribution.

## Pinned primary sources

| Source archive | SHA-256 | Verification when pinned |
| --- | --- | --- |
| [FFmpeg 9.0.2](https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz) | `8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e` | Downloaded archive measured; detached release signature verified |
| [dav1d 1.5.4](https://downloads.videolan.org/pub/videolan/dav1d/1.5.4/dav1d-1.5.4.tar.xz) | `686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5` | Downloaded archive equals upstream's published `.sha256` |
| [zlib 1.3.2](https://zlib.net/zlib-1.3.2.tar.xz) | `d7a0654783a4da529d1bb793b7ad9c3318020af77667bcae35f95d0e42a792f3` | Downloaded archive equals the checksum on [zlib.net](https://zlib.net/) |

These checks were performed on 2026-10-24. The FFmpeg release key fingerprint is
`FCF986EA15E6E293A5644F10B4322F04D67658D8`, published on its
[download page](https://ffmpeg.org/download.html). Its key, detached signature,
and dav1d's checksum file are retained as evidence. All three detached upstream
signatures are retained with their own pinned hashes. Dav1d/zlib signatures were
**not cryptographically verified**. Each build verifies pinned SHA-256 for every
archive, signature and evidence file; it does not invoke GPG or a keyserver.
Changing a pin requires downloading and reviewing the upstream materials again.

The exact URLs, licenses, hashes and verification notes are in
`ops/media-sources.json`. Existing bad cache entries fail closed and are never
silently redownloaded. Source downloads only use the pinned upstream HTTPS host;
cross-host/downgrade redirects fail. Source extraction rejects links, devices,
duplicate paths, traversal and Windows drive/backslash names.

## Build requirements and invocation

Use a native filesystem supporting hardlinks and execution, and fresh prefix
and output directories. Keep prefix/output/cache separate and non-nested. The
prefix path must contain no whitespace (FFmpeg/Make limitation). The output path
may contain spaces. No administrator rights are needed to run the build.

All targets require Bash, **Python 3.8+ with lzma/SSL**, a native C compiler and
archiver/binutils, GNU Make, Meson, Ninja, pkg-config (or pkgconf), and standard
POSIX shell utilities. Python, not Node, drives this helper; Node 22.23.4 remains
the surrounding application's separate toolchain requirement. `CC` may name a
single compiler executable; arbitrary inherited compilation/linker flags are
not used. `JOBS`/`--jobs` defaults to **2**, accepts 1–64. There is no cross-build
mode and no dependency installation in this script.
Operator-provided `PYTHONPATH` and `LD_LIBRARY_PATH` tool locations are preserved
and recorded so private, uninstalled Meson/pkgconf toolchains can execute.

- **Linux x64/arm64:** native GCC/Clang toolchain plus `readelf`, Meson, Ninja and
  pkgconf. Use the oldest supported distribution baseline for portable glibc
  requirements. This helper does not force static libc linkage.
  Alpine/musl builds are supported as Linux targets; runtime import validation
  recognizes the native musl libc as well as glibc. An Alpine build stage needs
  Bash, Python (SSL/lzma), GCC/binutils, musl development headers, Make, Meson,
  Ninja, pkgconf, NASM (optional), and the standard POSIX utilities. Downloads use
  Python's HTTPS client; curl is not required by this helper.
- **macOS x64/arm64:** Xcode Command Line Tools (`cc`, `ar`, `make`, `xcrun`,
  `otool`), plus Python, Meson, Ninja and pkgconf supplied by the build operator.
  Deployment target is explicitly 11.0; the selected SDK version/path is logged.
  Build separately on each native architecture, without depending on Rosetta.
- **Windows x64:** run inside **MSYS2 MINGW64 or UCRT64**, not Git Bash, Cygwin,
  plain PowerShell, or the default MSYS compiler environment. The driver selects
  MSYS `/usr/bin/python3`; build tools/compiler are from the MinGW prefix in PATH.
  Windows arm64 is not implemented by this MinGW recipe.

For Windows CI, provision these packages in a separate setup step (the following
is documentation, not something the helper executes):

```sh
# MINGW64: MSYS2 setup step / pacman -S --needed ...
python make tar xz diffutils
mingw-w64-x86_64-gcc mingw-w64-x86_64-winpthreads
mingw-w64-x86_64-meson
mingw-w64-x86_64-ninja mingw-w64-x86_64-pkgconf
mingw-w64-x86_64-nasm
```

For UCRT64 use the corresponding `mingw-w64-ucrt-x86_64-*` packages consistently.
Install `winpthreads` explicitly: it supplies the headers, static archives and
`share/licenses/winpthreads/COPYING`. The separate `libwinpthread` package supplies
the DLL and its own notice, which do not replace those development materials.
The MSYS2 base supplies Bash/core utilities. Do not mix a native Windows Python
driver with POSIX `/c/...` paths. Convert CI runner paths inside the MSYS2 shell:

```sh
JOBS=2 bash ops/build-media.sh \
  --prefix "$(cygpath -u "$RUNNER_TEMP")/desktop-media-work" \
  --out "$(cygpath -u "$RUNNER_TEMP")/desktop-media-build" \
  --cache "$(cygpath -u "$RUNNER_TEMP")/desktop-media-cache"
```

On Linux/macOS:

```sh
JOBS=2 bash ops/build-media.sh \
  --prefix /absolute/fresh-media-work \
  --out /absolute/fresh-media-build \
  --cache /absolute/media-source-cache
```

`bash ops/build-media.sh PREFIX OUT --cache CACHE` is equivalent. `--asm auto`
enables FFmpeg/dav1d assembly when NASM is on PATH, otherwise disables both for a
portable C build. `--asm off` forces the C build (also supported on arm64);
`--asm on` requires NASM and a compatible native assembler/toolchain. An installed
NASM must satisfy the pinned upstream projects' minimum version. No CPU-specific
`-march=native` flags are added.

To fetch or check source bytes **without compiling or requiring build tools**:

```sh
bash ops/build-media.sh --fetch-only --cache /absolute/media-source-cache
bash ops/build-media.sh --fetch-only --offline --cache /absolute/media-source-cache
```

Use `--offline` with a populated cache for the full build too. It fails if an
archive/signature/evidence file is missing. The cache uses read-only files named
by upstream version; updates never reuse a filename with different content.

## Distribution contract

Only the **output root** is distributable. The prefix contains extracted sources,
build objects and private static dependency installation; do not package it.
On failure the logs remain, but there is no successful `manifest.json`.

```text
bin/ffmpeg[.exe]
bin/ffprobe[.exe]
licenses/{ffmpeg,dav1d,zlib}/...
logs/...                         compiler/build logs and generated configuration
MEDIA-NOTICES.md
runtime-dependencies.json
media-sources.tar.xz
manifest.json
```

Manifest schema version 1 includes:

```json
{
  "platform": "linux | darwin | win32",
  "architecture": "x64 | arm64",
  "ffmpegVersion": "9.0.2",
  "license": "LGPL-2.1-or-later",
  "files": [{ "path": "bin/ffmpeg", "sha256": "<64 hex characters>" }],
  "sources": [{ "name": "ffmpeg", "version": "9.0.2", "archive": { "url": "...", "sha256": "..." } }],
  "sourceArchive": { "path": "media-sources.tar.xz", "sha256": "<64 hex characters>" }
}
```

`files` lists **every output file except manifest.json itself**, including both
binaries, the source archive, notices and logs. Paths are relative with `/`
separators. Additional fields record compiler/tool versions, assembly setting,
build time, runtime imports and signature policy. Binary architectures are read
from ELF/Mach-O/PE headers and must match the native target, independently of
their directory names. CLI license/version checks run before manifest creation.

Static FFmpeg/dav1d/zlib libraries are built into the tools. The script inventories
runtime imports with `readelf`, `otool` or Windows `objdump -p`; it rejects
unexpected dependencies rather than copying an untracked DLL/library. Windows
uses native Win32 threads for FFmpeg and **`-static -static-libgcc`** when linking
the tools. `-static-libgcc` alone does not prevent a compiler POSIX thread runtime
from importing `libwinpthread-1.dll`. An initial native CI build demonstrated that
failure; the Windows recipe now checks a small pthread create/join executable's
imports and execution before compiling the media tools. Final imports are still
checked for both FFmpeg and FFprobe. The OS DLL allowlist is unchanged, and
**no extra runtime DLLs are bundled**. Linux/macOS linking is unchanged. Existing
Linux source archives remain independent snapshots of their original build.

Windows also requires the installed MSYS2 runtime provenance, rather than a
download of current license text. Before compiling, it retains exact bytes from
`${MINGW_PREFIX}/share/licenses/`:

- `winpthreads/COPYING`: the combined MIT and BSD-3-Clause notices.
- `crt/COPYING`, `crt/COPYING.MinGW-w64-runtime.txt`, and
  `crt/COPYING.MinGW-w64.txt`: the installed MinGW-w64 CRT notices.
- `gcc/COPYING.RUNTIME` and `gcc/COPYING3`: the GCC runtime exception and its
  accompanying GPLv3 text. These compiler-runtime terms are recorded separately
  from FFmpeg's checked LGPL-2.1-or-later configuration.

These files are copied under `licenses/mingw-w64/{winpthreads,crt,gcc}/` and into
the source bundle. `licenses/mingw-w64/provenance.json` and the manifest's
`toolchainRuntime` record their hashes, package owners/versions, exact compiler
selections and hashes for `libwinpthread.a`, `libpthread.a`, `libgcc.a`,
`libmingw32.a`, `libmingwex.a`, and `crt2.o`. `pacman -Qi` metadata is retained in
`logs/windows-package-*.log`. No compiler archives or object files are copied.
Source-package URL references are derived from those installed versions using
`https://mirror.msys2.org/mingw/sources/mingw-w64-{gcc,crt,winpthreads}-VERSION.src.tar.zst`.
This filename format matches MSYS2's published source-only links for the reviewed
MINGW64 packages. Per-build URLs remain **unverified references, not retained**:
the helper does not download them or check their availability. They do not claim
bundled compiler/runtime source. The three media source
archive pins remain unchanged. Missing notices, unrecognized package ownership,
missing static inputs or unexpected final DLL imports fail the build.

The installed paths and notices follow the primary MSYS2 file lists for
[winpthreads](https://packages.msys2.org/packages/mingw-w64-x86_64-winpthreads),
[CRT](https://packages.msys2.org/packages/mingw-w64-x86_64-crt), and
[GCC](https://packages.msys2.org/packages/mingw-w64-x86_64-gcc). See also
[upstream winpthreads COPYING](https://github.com/mingw-w64/mingw-w64/blob/master/mingw-w64-libraries/winpthreads/COPYING)
and [GCC link options](https://gcc.gnu.org/onlinedocs/gcc/Link-Options.html).
Retaining these materials does not replace review of any different toolchain's
terms. The manifest makes no claim that binaries are signed/notarized.

The source bundle contains the exact archives/signatures/evidence, this script,
the source lock, these notices, license texts, generated configurations, command
logs and a build record containing binary hashes. It excludes object files and
binaries. Its `REBUILD.txt` describes offline rebuilding after extraction; fresh
paths replace the original absolute paths recorded in logs. This is a rebuild
recipe, not a claim of byte-for-byte reproducibility across toolchains.

Keep the source bundle and notices with the application and offer that same
archive beside each installer download. Packaging should validate the manifest,
both binary hashes/native target and source archive before its staging inventory.
The parent packaging/Docker work handles application executable paths and removes
the superseded static npm wrappers/binaries.

FFmpeg license details: [upstream LICENSE.md](https://github.com/FFmpeg/FFmpeg/blob/n9.0.2/LICENSE.md),
[LGPLv2.1](https://github.com/FFmpeg/FFmpeg/blob/n9.0.2/COPYING.LGPLv2.1),
and [FFmpeg's distribution guidance](https://ffmpeg.org/legal.html).
Dav1d: [BSD-2-Clause notice](https://github.com/videolan/dav1d/blob/1.5.4/COPYING).
Zlib's unchanged license is included from its source archive. The source bundle
and runtime checks document these particular media artifacts; they do not make
a blanket licensing determination about the combined desktop product.
