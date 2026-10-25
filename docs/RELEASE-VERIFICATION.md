# RC6 verification record

Version **0.1.0-rc.6**, 25 October 2026. One shared application core, three native desktop distributions and a headless server. These are measured acceptance results for the listed targets.

## Accepted binary identity

[Native workflow 40220321927](https://github.com/dannychirkov/llm-canvas/actions/runs/40220321927) builds fresh Windows x64, macOS arm64, Linux x64 and Alpine artifacts from clean source `1833937b787021e4261aea1391f716361528a067`. Each job succeeds. The exact 374-file build-source archive has SHA-256 `a311fb8e8b229331e2d4c4b4409793f8331605890814f8c94db9553531832512`. The published source adds only release documentation; the release manifest records both revisions and the unchanged application/build inputs.

| Target | Accepted artifact | SHA-256 |
| --- | --- | --- |
| Windows x64 | `LLM-Canvas-0.1.0-rc.6-x64-Setup.exe` | `55ffa02707f4f015cacfe2c893791335144883f451bf028071d149320c27674a` |
| macOS arm64 | `LLM-Canvas-0.1.0-rc.6-arm64.dmg` | `cf3dd583347bd4e214770613aa25f8d38060ed418c6e4a9f8c87cc3e6b3b0368` |
| Linux x64 | `LLM-Canvas-0.1.0-rc.6-x86_64.AppImage` | `e70899f8759745faca34dbc83c21d53162ef44cb69b96f411f3470f3fc6dfb79` |
| Headless Linux x64 | `headless-image.tar.gz` | `f6f2da1adf7ec7b9f7dd20f175a24e131ca14e2f9b001bd18bec27b88547aad5` |

Load the headless Docker archive with `docker load --input headless-image.tar.gz`; its loaded tag is `llm-canvas-headless:validation`. Follow the [operations guide](OPERATIONS.md) before connecting persistent data. Its isolated first start, paired media and native Alpine storage/process-death tests pass. All 19 exported layers pass the private-path scan with zero private artifacts. This scoped scan is not a general security certification.

## Installed desktop acceptance

Each actual NSIS/DMG/AppImage payload passes four launches and eight browser/provider checks with a fresh synthetic profile, real DPAPI/Keychain/Secret Service, installed payload provenance and Chromium renderer isolation. Both main-process and backend termination are followed by verified recovery. No real provider account or paid inference is used.

| Check | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Installer/copy/extraction | NSIS installed | DMG mounted/app copied | AppImage extracted |
| Account/session/canvas persistence | Pass | Pass | Pass |
| Saved encrypted provider credential | Pass | Pass | Pass |
| Chat/SSE; 18 tokens/call, 3 cached, 2 reasoning, 36 ledger delta | Pass | Pass | Pass |
| Clipboard write/read denied; renderer has no Node | Pass | Pass | Pass |
| Native paired FFmpeg/FFprobe 9.0.2 WAV and standard-Node Sharp PNG | Pass | Pass | Pass |
| Main-process death: orphan backend stopped | 112ms | 105ms | 103ms |
| Backend death: resume after explicit modal-main cleanup | Pass | Pass | Pass |
| Update-selection/native-UI wiring regressions | 19 pass | 19 pass | 19 pass |

Native media builds additionally pass metadata/JPEG/frame extraction on six synthetic H.264 MP4/MOV, HEVC MKV, VP8/VP9 WebM and AV1 MKV fixtures. AppImage preserves sandboxing; `--no-sandbox` is rejected.

Windows acceptance retains the explicit hosted-CI `--disable-backgrounding-occluded-windows` launch switch. Native startup/security/accounting assertions and installer bytes are unchanged by that harness condition; interactive testing of every window-manager configuration is not implied.

Previews remain unsigned. SmartScreen reputation, downloaded-file quarantine, Gatekeeper and notarization are not established by installation/copy tests. Intel macOS and other CPU builds are not provided. See [installation](DESKTOP.md#install-the-preview).

## Update checks

The main-process checker uses the official public GitHub feed, strict SemVer/channel selection, exact compatible assets, bounded response/deadline, cooldown/singleflight and shutdown cancellation. Nineteen mocked regressions exercise selection, errors, cancellation, consent and actual main-process Help-menu wiring on each OS. A real public feed check also selects the correct RC5 installer for all three simulated RC4 targets. These checks do not establish automatic installer execution: Download update only opens a browser link. Native acceptance disables background checks to remain deterministic; it does not exercise a live GitHub dialog on each OS.

Users of RC5 need one manual installation of RC6 to gain notifications. Builds with the checker provide Help → Check for Updates and packaged automatic checks; [update behavior and offline opt-out](DESKTOP.md#update-notifications) are documented.

## Core/server checks

Host Node 22.23.4: 549 tests, 548 pass, zero fail, one Alpine-only skip; lint, TypeScript and all 33 build pages pass. Native Alpine storage/SIGKILL checks cover that skip. Eight mounted-React custom-onboarding regressions pass on all three desktop jobs.

RC6 leaves shared application/provider/context/database/runtime/media code and dependency declarations unchanged from the RC5 build source. The last complete isolated server Chromium/Responses/vision/multipart/usage/privacy/admission/cancel/slow-body checkpoint and data-preserving production rollout remain RC5, as documented in the [RC5 record](https://github.com/dannychirkov/llm-canvas/blob/v0.1.0-rc.5/docs/RELEASE-VERIFICATION.md). The existing production server remains RC5; this desktop/documentation release does not migrate or redeploy its data.

The README [gallery](SCREENSHOTS.md) shows three actual RC5 Chromium captures using prepared synthetic content. They are presentation examples, not model benchmarks or production-account screenshots.

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
