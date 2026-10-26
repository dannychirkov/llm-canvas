# RC7 verification record

Version **0.1.0-rc.7**, 26 October 2026. One shared application core, three native desktop distributions and a headless server. These are measured results for the listed targets.

## Accepted binary identity

[Native workflow 40248424585](https://github.com/dannychirkov/llm-canvas/actions/runs/40248424585) builds fresh Windows x64, macOS arm64, Linux x64 and Alpine artifacts from clean source `b0b14005c9388f9f706ff03f7bec6015e4ebd115`. Every job succeeds. The exact 383-file build-source archive has SHA-256 `6dabefb265cf25fe6c653afc96b711f7870815f960d2387ce5753a03106562a2`. Published source changes only release documentation afterward; manifests retain both revisions and prove all runtime/build inputs match.

| Target | Accepted artifact | SHA-256 |
| --- | --- | --- |
| Windows x64 | `LLM-Canvas-0.1.0-rc.7-x64-Setup.exe` | `73efc25f9621a830df1dc236931d2401d46ca164ad7397e220924dcaaaf444de` |
| macOS arm64 | `LLM-Canvas-0.1.0-rc.7-arm64.dmg` | `420f8d56f1b5e9162949b46863f9086a95c7157cb5f591db764f66e23e504651` |
| Linux x64 | `LLM-Canvas-0.1.0-rc.7-x86_64.AppImage` | `7ded4164fc31d64ccbca25fdd47e1f0a8cdb4c3d6935379b9ac55a61df028afc` |
| Headless Linux x64 | `headless-image.tar.gz` | `4af5bad61e6280102f8b14a752a64f59c28a8b22723fca4230ee4bc42f51705c` |

Load the headless Docker archive with `docker load --input headless-image.tar.gz`; its tag is `llm-canvas-headless:validation`. Follow the [operations guide](OPERATIONS.md) before connecting persistent data. Isolated first start, paired media and Alpine storage/process-death tests pass. All 19 image layers pass the scoped private-path scan with zero private artifacts.

## Installed desktop acceptance

Each actual NSIS/DMG/AppImage payload passes four launches/eight browser/provider checks with a fresh synthetic profile, real DPAPI/Keychain/Secret Service, installed payload provenance and renderer isolation. Both main-process and backend termination are followed by verified recovery. No real provider account or paid inference is used.

| Check | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Installer/copy/extraction | NSIS installed | DMG mounted/app copied | AppImage extracted |
| Account/session/canvas persistence | Pass | Pass | Pass |
| Saved encrypted credential | Pass | Pass | Pass |
| Chat/SSE; 18 tokens/call, 3 cached, 2 reasoning, 36 ledger delta | Pass | Pass | Pass |
| Clipboard restrictions; renderer has no Node | Pass | Pass | Pass |
| Standard-Node Sharp PNG and paired FFmpeg/FFprobe 9.0.2 WAV | Pass | Pass | Pass |
| Main-process death: orphan backend stopped | 112ms | 225ms | 103ms |
| Backend death: resume after explicit modal-main cleanup | Pass | Pass | Pass |
| Settings lifecycle regressions | 8 pass | 8 pass | 8 pass |
| Update-check regressions | 19 pass | 19 pass | 19 pass |
| Branding/artwork/native format/ASAR regressions | 7 pass | 7 pass | 7 pass |

Media metadata/JPEG/frame checks also pass on six synthetic H.264 MP4/MOV, HEVC MKV, VP8/VP9 WebM and AV1 MKV fixtures. The AppImage preserves sandboxing; `--no-sandbox` is rejected. Windows retains the documented hosted-CI occlusion-testing switch.

A later copied-data browser gate also exposed stale settings requests during document navigation. The corrected release cancels superseded/session/unmount/pagehide requests and reloads after cached-page restoration; eight mounted lifecycle regressions pass. Exact public branding paths also bypass authentication; neighboring and private-media paths remain protected. Fresh standalone requests verify HTTP 200 before login for both PNGs. Earlier artifacts are superseded.

The initial RC7 run stopped before Windows packaging because its ASAR test passed a POSIX-separated member path. The corrected fixture uses node:path; no asset/pixel/format assertion was removed. This record covers the fresh complete corrected run above.

Previews remain unsigned. Signing, reputation, downloaded-file quarantine and notarization are not established by CI. Intel macOS and other CPU builds are not provided; [installation instructions](DESKTOP.md#install-the-preview) retain that scope.

## Dark theme, branding and documentation

The canonical server favicon is byte-identical. Browser/Apple/native formats derive from that artwork; all original ICO frames remain. Reproducible generation and seven regressions verify decoded pixels, transparency, formats and actual ASAR inclusion. App headers and native package/window configuration use the same mark; visual inspection of every OS launcher surface is not claimed.

Actual Chromium on a private RC7 standalone verifies the cold Dark default with a light OS, saved Light/System after reload, visible branding and native control color scheme. The [gallery at the RC7 tag](https://github.com/dannychirkov/llm-canvas/blob/v0.1.0-rc.7/docs/SCREENSHOTS.md) contains the original three dark captures. Its nine-node/eight-edge hero has exact bottom-source/top-target endpoints, descending geometry, no clipping/overlap/crossings and a 70px minimum vertical gap. Prepared synthetic replies are examples, not model benchmarks; no inference is submitted for those captures.

The current [README gallery](SCREENSHOTS.md) expands the documentation example to a 21-node/21-edge creative project, captured from the same RC7 application. It includes product/reference imagery, CSV feedback, two global Memory nodes, two excluded drafts, summarization, image editing and parallel copy production. The revised hero and inspector pass fresh layout/context/privacy checks; sample photographs and replies are prepared fixtures. This documentation update leaves the accepted application binaries, version, tag and release assets above unchanged.

Desktop release checks remain available since RC6. Download update opens the matching official installer after consent; installation stays manual. Background checks are disabled in deterministic native acceptance. See [update behavior](DESKTOP.md#update-notifications).

## Host and server checks

Pinned Node 22.23.4: 564 tests, 563 pass, zero fail, one host BusyBox-only skip covered on native Alpine. Lint/build/TypeScript and all 33 pages pass. Eight mounted-React custom-onboarding regressions pass on each desktop OS.

Model execution/context/accounting APIs and database schema are unchanged by this branding/theme release. On a consistent private persistence copy, the new native image passes real Chromium login, custom setup/discovery/model selection/Finish, inspector/Undo/Restore, fresh selected dependency execution, Save/reload/usage/logout. Responses JSON/SSE/vision, multipart editing/private media/usage and actual HTTP admission/cancel/slow-body checks pass using synthetic fixtures.

Server promotion uses a fresh stopped-volume backup and retains the previous image. Database bytes/all logical rows/uploads/installation secret remain unchanged; canonical authentication and all compiled static asset bytes match. No production inference is used to validate this UI release. This is scoped acceptance, not a general security or universal-platform certification.

## Sources and notices

Each controlled CLI media build includes its corresponding sources/build scripts,
configuration, notices and file hashes. Desktop packages retain package-supplied
production/client notices; see [MEDIA-NOTICES.md](MEDIA-NOTICES.md).

The separate **337963926-byte** native companion covers sharp0.35.5 /
sharp-libvips1.3.4 /libvips8.18.7 on glibc, musl, Windows and macOS, plus the exact
Electron45 Chromium FFmpeg sources/configuration. It retains357 Rust crates,
832 notice files and2902 verified archive files. Companion SHA-256:
`80ecf75edead2f0ab1981502268feca2b477ce4be6bb5625d8c32d1de96d2461`.
Distribute it alongside the binaries. [Rebuild/verification instructions](NATIVE-SOURCE-MATERIALS.md)
distinguish complete scoped source materials from unperformed native rebuilds,
full compiler/SDK provisioning and legal determinations.

The release contains no original private Git history. Continue using only the
clean release history; never merge an old installation's historical refs.
