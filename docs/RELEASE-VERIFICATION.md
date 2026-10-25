# RC5 verification record

Version **0.1.0-rc.5**, 25 October 2026. One Next.js/Prisma core, three native
desktop distributions and a headless server. This record describes measured
acceptance; it does not establish support on every OS version or a security
certification.

## Accepted binary identity

The binaries were built from the clean application source revision
`738c0d5d6c5a6f76b351d3f879f70a5bef7c4c4e`. Later release-tooling, documentation
and test-harness changes do not change those application or packaging inputs.
Rechecking the installers compares Git blob hashes and modes of all build/runtime
inputs to the original native build and checks the original installer checksum.
The exact367-file build-source archive has SHA-256
`89396ce9da31290cd3e0e637bcb58ff83a97262785a125b8ac2070601e91dfcc`.

| Target | Accepted artifact | SHA-256 |
| --- | --- | --- |
| Windows x64 | `LLM-Canvas-0.1.0-rc.5-x64-Setup.exe` | `fb14220d70761c8efca4ff16230de373581c0e3ae9b64a6082b4406a95977400` |
| macOS arm64 | `LLM-Canvas-0.1.0-rc.5-arm64.dmg` | `c28832a8e140a2b35ce6608d392184510058e13eaf3bd8e645b6831c0fa322b8` |
| Linux x64 | `LLM-Canvas-0.1.0-rc.5-x86_64.AppImage` | `9b36784ca297260e7d11fbf5b6bfe94e95227f24cd3e55729209be9ed8d2341f` |
| Headless Linux x64 | `headless-image.tar.gz` | `a60ad4b5897e5a34749f1019f2aea2c9551153c1c79899ade5826e7159a54748` |

The headless image ID is
`sha256:ab6d817570b8caf8ab26d05b89c59a69f55ae72c3bfb037583319135bcd86ac4`.
Load its Docker archive with `docker load --input headless-image.tar.gz`;
its loaded tag is `llm-canvas-headless:validation`. Review the
[operations guide](OPERATIONS.md) before connecting persistent data. The image
has no Electron, production data, accounts, provider keys or installation secret.
All19 exported layers passed the private-path scan. This scan does not establish
absence of every possible secret or OS vulnerability.

## Installed desktop acceptance

Each target passes four launches/eight browser/provider checks: initial
registration, clean restart, restart after terminating the main process, and
restart after terminating the backend. Tests use a new synthetic profile,
real DPAPI/Keychain/Secret Service, actual installed/extracted payload paths and
Chromium renderer isolation. No real provider account or paid inference is used.

| Check | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Installer/copy/extraction | NSIS installed | DMG mounted/app copied | AppImage extracted |
| Account/session/canvas persistence | Pass | Pass | Pass |
| Saved encrypted provider credential | Pass | Pass | Pass |
| Chat/SSE,18 tokens/call,3 cached,2 reasoning,36 ledger delta | Pass | Pass | Pass |
| Clipboard write/read denied; renderer has no Node | Pass | Pass | Pass |
| Native paired FFmpeg/FFprobe9.0.2 WAV and standard-Node Sharp PNG | Pass | Pass | Pass |
| Main-process death: orphan backend stopped | 105ms | 104ms | 101ms |
| Backend death: resume after explicit modal-main cleanup | Pass | Pass | Pass |

Native media builds additionally pass metadata/JPEG/frame extraction on six
synthetic H.264 MP4/MOV, HEVC MKV, VP8/VP9 WebM and AV1 MKV fixtures. The AppImage
launcher and desktop entry preserve sandboxing; `--no-sandbox` is rejected.

The hosted Windows session initially delayed canvas loading while reporting a
focused/visible page. Its accepted harness launch includes
`--disable-backgrounding-occluded-windows`, Chromium's dedicated
[occlusion test switch](https://chromium.googlesource.com/chromium/src/+/HEAD/content/public/common/content_switches.cc).
The installer/application bytes and every readiness/security/accounting assertion
are unchanged. This proves acceptance under that explicit CI condition; it does
not replace interactive testing of every desktop/window-manager configuration.
No sandbox, permission or authentication override is used.

All previews are unsigned. SmartScreen reputation, downloaded-file quarantine,
Gatekeeper and notarization are not established by CI installation/copy tests.
See [installation](DESKTOP.md#install-the-preview). Intel macOS and other CPU
builds, automatic updates and trusted code signing are not provided in this RC.

## Core/server checks

Eight mounted-React onboarding regressions pass, including local no-auth, manual
models, back/retry identity, ComfyUI workflow and edited built-in key validation.

Host Node22.23.4:530 tests,529 pass,zero fail,one Alpine-only skip. Lint,
TypeScript and all33 build pages pass. Real native Alpine storage/SIGKILL checks
cover that host skip. Later validation-only changes pass their focused regressions.

A fresh native candidate on a consistent private persistence copy passes:

- Real Chromium: login, initial Custom endpoint wizard, discovery, actual model
  selection modal, Finish with the saved Bearer key, inspector edit, Undo, connected
  selected dependency execution with fresh upstream response, Restore, Save/reload,
  token ledger and logout; zero page/console/asset errors or RSC404.
- Actual Responses JSON/SSE/vision, output-limit translation and `store:false`;
  cached/reasoning subsets and explicit provider-reported zero persist correctly.
- Multipart image-edit bytes and private generated media; anonymous access401;
  ledger/statistics match, encrypted endpoint headers and no plaintext settings key.
- Three executions/user and six globally, excess rejected before provider submission,
  cancelled-body slot recovery, slow-body408 and health available under saturation.

Headless rollout preserves database bytes/logical rows/uploads/installation secret
with a verified stopped-volume backup and retained previous image. Secure canonical
CSRF/session continuity and all42 static asset bytes pass after deployment.

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
