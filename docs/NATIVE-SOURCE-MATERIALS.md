# Native source and notices companion / REBUILD

This companion contains source bytes, full published notice/license files,
patches, build recipes and platform version evidence for **sharp 0.35.5,
sharp-libvips 1.3.4 / libvips 8.18.7**, plus **Electron 45.0.0's bundled
Chromium FFmpeg**. It covers Linux x64 glibc, Linux x64 musl (including the
Alpine headless image), Windows x64 and macOS arm64. It is separate from the
application's CLI FFmpeg 9 source materials in `ops/media-sources.json`.

The companion is a technical source/notice inventory. Native binaries were not
rebuilt here; it does not establish byte-identical binary reproduction or make
a legal determination. The source identity is established through the matching
upstream recipes, per-platform package versions, registry integrity and source
checksums. Compiler/SDK/container images are referenced by those recipes rather
than supplied as a verified, reproducible toolchain.

## Artifact and offline verification

The actual cache and companion archive are stored outside Git, as regular flat
files, under:

```text
/mnt/usb6tb/codex-builds/llm-canvas-desktop/phase32/native-sources/
```

The release companion is `llm-canvas-native-sources-sharp1.3.4-electron45.tar.gz`.
Its sibling `.sha256` file contains the whole archive's SHA-256. Source archives,
registry packages and Electron ZIP remain flat cache inputs; they are never
installed. The companion includes registry **metadata/notices**, not the binary
packages or Electron runtime ZIP themselves.

Python 3.11 or newer is the only tool required. From the repository root:

```sh
cache=/mnt/usb6tb/codex-builds/llm-canvas-desktop/phase32/native-sources
archive="$cache/llm-canvas-native-sources-sharp1.3.4-electron45.tar.gz"
python3 ops/native-source-materials.py verify-cache --cache "$cache"
python3 ops/native-source-materials.py verify --archive "$archive" \
  --sha256 "$(cat "$archive.sha256")"
node --test tests/nativeSourceMaterials.test.js
```

`verify-cache`, `assemble` and `verify` do not access the network. The verifier
checks every companion member against the local pins, rejects missing/extra/
duplicate paths and non-regular members, validates sizes, normalized TAR
metadata, SHA-256 and gzip CRC. `--sha256` also checks every compressed byte,
including headers and padding, against the independently retained archive hash.
Keep the pins and checksum with the artifact; a checksum is not a signature.

To acquire the exact pinned bytes on another machine, use the explicit network
command. It does not refresh or silently replace mismatching cached files:

```sh
python3 ops/native-source-materials.py fetch --cache "$cache"
```

To assemble again, choose a fresh output name:

```sh
python3 ops/native-source-materials.py assemble --cache "$cache" \
  --out "$cache/reassembled-native-sources.tar.gz" \
  > "$cache/reassembled-native-sources.tar.gz.sha256"
cmp "$archive" "$cache/reassembled-native-sources.tar.gz"
```

Assembly streams the compressed inputs and writes only the companion and its
temporary regular file. It performs no source-tree extraction, chmod, build,
database access, package installation or publication. TAR entries have fixed
order, UID/GID 0, mode 0644 and mtime 0; gzip has no original filename and mtime
0. Repeat assembly with the same Python/zlib, tooling, documentation, pins and
cache bytes produces the same archive. Both archive and temporary file require
space on the output filesystem. Failed hash checks fail the operation.

The root of the companion contains `MANIFEST.json`, `native-source-pins.json`,
`native-source-materials.py` and this document as `REBUILD.md`. The manifest lists
every payload path, size, SHA-256 and origin, and every acquisition URL/version.
Notice entries are identified by `role: notice` in the pins and manifest. Each
expanded notice retains its original upstream path under
`notices/<input-archive>/<original-path>`. The full original source archives are
also retained, including source-header notices that are not separate files.
`inventory/` holds selected lockfiles, manifests and build configurations;
`evidence/` holds the authenticated binary package metadata.

For verification without a repository, copy only the four root tooling files
to a working directory and run its `native-source-materials.py verify` with the
archive and retained whole-archive hash. Do not unpack upstream trees onto the
ExFAT cache. The verifier itself never extracts archive paths.

## Sharp/libvips source correspondence

The authoritative POSIX recipe is
[sharp-libvips tag v1.3.4](https://github.com/lovell/sharp-libvips/tree/v1.3.4),
including `versions.properties`, `build/posix.sh`, `build.sh`, platform Dockerfiles,
Meson cross files, CMake toolchains and the upstream third-party notice table.
The table alone is not used as the license payload. The previously suggested
aggregate tagged `COPYING` does not exist; the archive instead supplies the
actual libraries' source archives and their published full license files.

All four downloaded platform `versions.json` inventories agree. The Windows
package is `@img/sharp-win32-x64@0.35.5`, which includes the libvips DLLs and its
own versions file; it is not a nonexistent `sharp-libvips-win32-x64` package.
Linux/macOS packages are `@img/sharp-libvips-<platform>@1.3.4`. Their npm tarballs
are verified against the exact `package-lock.json` SHA-512 integrity values
recorded in the pins. No npm install is performed.

The 28 reported native-library components are pinned at their reported versions:
aom, archive, cairo, cgif, exif, expat, ffi, fontconfig, freetype, fribidi, glib,
harfbuzz, heif, highway, imagequant, lcms, mozjpeg, pango, pixman, png,
proxy-libintl, rsvg, tiff, uhdr, vips, webp, xml2 and zlib-ng. The companion also
contains GLib's forced gvdb subproject at
`2b42fc75f09dbe1cd1057580b5782b08f2dcb400`. Proxy-libintl is used on musl/macOS
and Windows; the common versions file also lists it for glibc. Libnsgif's
complete source and COPYING are already inside the libvips release archive.
The sharp addon source is retained at tag v0.35.5.

External POSIX patches are separate SHA-256 pinned inputs: GLib without GRegex,
mozjpeg FDCT saturation, librsvg embedded-image memory limits, libultrahdr PR
383, and the libvips C++ SONAME patch. Inline `sed` changes and feature flags
are preserved in the exact recipe, including the librsvg GIF/WebP and Cairo
PDF/PS exclusions. Mutable PR URLs are frozen by the downloaded bytes' hash;
a future changed response fails verification rather than updating the patch.

Windows uses
[build-win64-mxe tag v8.18.7](https://github.com/libvips/build-win64-mxe/tree/v8.18.7),
not the POSIX build. Its full recipes/overrides/plugins/patches are included,
along with its referenced MXE branch `llvm-mingw-20260924`, resolved to commit
`c36160b231e66e1cbe032ed54aef7617e8b259da`. All 28 source archives are matched
against the **Windows recipe SHA-256 checksums** in `closure.windowsChecksums`.
Where Windows consumes a different release tarball/compression layout, that
exact archive is supplied too; this includes mozjpeg's tarball endpoint and
highway's release archive. Keeping only same-version autogenerated archives
would not satisfy that checksum check.

## Rust sources and notice provenance

The librsvg 2.63.2 release has no vendored registry sources. All **357 registry
crates** in its original `Cargo.lock` are supplied as original `.crate` archives
from `static.crates.io`, each checked against the lockfile's SHA-256 checksum.
The verifier independently parses the retained release lockfile and compares
its entire registry identity/checksum set with the supplied crates. There are
no git dependencies in that lockfile.

This is deliberately the entire lockfile superset, including optional,
development and other-target crates, rather than an assertion that 357 crates
are linked into every binary. The POSIX recipe changes feature selections and
runs `cargo update --workspace`; the MXE librsvg patch explicitly records its
lockfile pruning. The included superset retains sources for the packages before
that feature pruning. Crate archive files and Cargo manifests retain original
authors, licensing declarations, headers and included notices.

Eleven crate packages publish no standalone license file: anes, block,
defmt-parser, difflib, malloc_buf, mutants, objc-foundation, objc_id, selectors,
winapi-i686-pc-windows-gnu and winapi-x86_64-pc-windows-gnu. This is recorded as
`licenseFileAbsentFromCrate`, not hidden by inventing a crate license file.
Available license files from the exact upstream VCS commit/release are supplied
for anes, defmt-parser, mutants and the winapi import-library package family.
The original repository snapshots are retained as provenance supplements.

For block, difflib, malloc_buf, objc-foundation and objc_id, which lack a
standalone file in their matching upstream tree as well, the full MIT text is
supplied from the [Open Source Initiative](https://opensource.org/license/mit).
For selectors, its MPL source-header notices and original manifests are
retained along with the full [MPL 2.0 text from Mozilla](https://www.mozilla.org/en-US/MPL/2.0/).
These are clearly identified license-text supplements, not claimed to be
missing original copyright notices. No copyright holder/year is fabricated.

## Electron's bundled FFmpeg

The actual official Electron 45.0.0 Linux x64 runtime ZIP was downloaded and
checked against `checksums.json` in the integrity-verified Electron npm package,
and the release's `SHASUMS256.txt` is retained. Its full
`LICENSES.chromium.html`, `LICENSE` and `version` are included as evidence. The
HTML matches the installed runtime's notice bytes and contains FFmpeg's LGPL
2.1-or-later notice. This is the bundled media library, separate from CLI FFmpeg.

The exact source chain is:

| Evidence | Reference |
| --- | --- |
| [Electron DEPS](https://github.com/electron/electron/blob/v45.0.0/DEPS) | Electron v45.0.0 |
| Chromium version | 156.0.8078.48 |
| Chromium tag commit | d0c02bfad08ec92a6ffcf989e53cd995e6381a4c |
| [Chromium DEPS](https://chromium.googlesource.com/chromium/src/+/156.0.8078.48/DEPS) | `ffmpeg_revision` = 9db86ce5b5b454dfc96c435f9f0723012980c37f |
| [Bundled FFmpeg source](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/9db86ce5b5b454dfc96c435f9f0723012980c37f/) | Full source archive at that exact commit |

The companion retains the raw Gitiles base64 Chromium DEPS response, its tag
commit metadata, Chromium `build/` and `media/ffmpeg/` recipe subtrees, and the
full FFmpeg fork archive. That archive includes CREDITS.chromium, COPYING files,
BUILD.gn, ffmpeg_options.gni, ffmpeg_generated.gni, Chromium patch history and
the generated `Chrome` configuration headers for Linux x64, Windows x64 and
macOS arm64. Electron's complete source archive retains its FFmpeg patch and
GN args. Default release args select `ffmpeg_branding="Chrome"`,
`proprietary_codecs=true`, `is_component_ffmpeg=true`; the separate
`build/args/ffmpeg.gn` selects a different branding for replacement FFmpeg
packages and must not be mistaken for the default runtime configuration.

## Rebuild native libraries from these materials

Use a spacious POSIX filesystem for source trees and build output. The cache on
ExFAT is for regular archive files only. First verify the companion and inputs
as above. The source archives, not generated notice copies, are the input source
of truth. `MANIFEST.json` maps each source/patch/recipe to its primary URL,
version and checksum, including the alternative Windows archive variants.

1. Unpack `recipes/sharp-libvips-v1.3.4.tar.gz` into a fresh build workspace.
   Unpack the component source archives into the dependency directories named
   by `build/posix.sh`. Apply each external patch at the point recorded in that
   script and retain its inline edits. Use its platform Meson/CMake files and
   configure flags without substituting system versions of bundled libraries.
   GLib's forced `gvdb` fallback must use the included exact gvdb commit.
2. Restore the registry `.crate` files to a Cargo vendor directory on that
   filesystem: unpack each to `<name>-<version>`, generate Cargo's
   `.cargo-checksum.json` with the original archive checksum as `package` and
   SHA-256s for its files, and configure `[source.crates-io] replace-with =
   "vendored-sources"` plus `[source.vendored-sources] directory = "..."` in
   `.cargo/config.toml`. Preserve the release lockfile; apply the same feature
   edits/lockfile pruning shown in the recipe. Run Cargo with
   `CARGO_NET_OFFLINE=true`. The original lockfile superset is included so that
   removing optional features does not require finding more runtime sources.
3. The upstream POSIX entrypoints are `./build.sh linux-x64`,
   `./build.sh linuxmusl-x64` and, on a macOS host with the required SDK,
   `./build.sh darwin-arm64v8`. Their Dockerfiles describe the Linux environment.
   To build without network, replace recipe downloads with the corresponding
   verified cache inputs and disable the rustup/cargo-c installation step after
   provisioning the referenced tools. Original scripts are retained unmodified
   in the archive for comparison. They otherwise fetch from the network and
   reference an unpinned nightly Rust compiler; running them unchanged is not a
   claim of an offline or byte-identical rebuild.
4. For Windows, unpack `build-win64-mxe-v8.18.7.tar.gz` and the included MXE
   snapshot, preserving the source overrides and patches. Seed MXE's `pkg/`
   cache with the exact files identified by `closure.windowsChecksums`. Use
   `./build.sh --without-prebuilt -t x86_64-w64-mingw32.static vips-web` with
   the preserved `mozjpeg`, `zlib-ng`, `web-deps` and `proxy-libintl` plugins.
   Provision the compiler/container prerequisites from the archived Dockerfiles;
   they are not in this companion. This produces the upstream static-dependency
   libvips DLL configuration used by `build/win.sh`, not the `all` or FFI variant.
   `sharp-libvips/build/win.sh` describes its subsequent DLL packaging.
5. For the sharp binding, use the included sharp v0.35.5 source and its build
   configuration, with the rebuilt platform libvips. Its JavaScript/build
   dependency installation belongs to the application's separately pinned npm
   source/dependency export. No npm dependencies are installed by this tool.
6. For Electron FFmpeg, use the retained Electron DEPS and Chromium commit to
   provision a Chromium/Electron build workspace, place the included exact FFmpeg
   fork at `src/third_party/ffmpeg`, and apply Electron's
   `patches/ffmpeg/link_with_loader_path.patch` through its patch configuration.
   Use the recorded release GN args and platform `Chrome` generated configs;
   the `//third_party/ffmpeg` GN target supplies the shared library. Chromium's
   FFmpeg source-generation tools and GN build settings are included. Full
   Chromium/Electron build dependencies and generic toolchains are referenced by
   their DEPS, not silently represented as present in this scoped companion.

No native rebuild, signing, publication, runtime QA, server release or source
export integration is performed by this source-materials tooling.
