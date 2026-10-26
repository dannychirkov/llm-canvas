# Desktop preview and headless server

LLM Canvas uses one Next.js/Prisma application in four distributions:

| Distribution | Wrapper | Data location | Verification |
| --- | --- | --- | --- |
| Windows | Electron + NSIS installer | `%APPDATA%/LLM Canvas` | rc7 x64 NSIS accepted |
| macOS | Electron + DMG | `~/Library/Application Support/LLM Canvas` | rc7 arm64 DMG accepted |
| Linux | Electron + AppImage / tar.gz | `${XDG_CONFIG_HOME:-~/.config}/LLM Canvas` | rc7 x64 AppImage accepted |
| Headless server | Docker / Node.js | Operator-managed SQLite and uploads | rc7 native Alpine image accepted; no graphical session required |

Desktop includes Chromium, Node.js, the compiled application, native Prisma and
media tools. It does not install or generate packages at startup. Models still
run at the providers you configure. A reachable local provider can work without
Internet; remote providers require their normal network connection.

The server runs in a separate bundled **standard Node.js 22.23.4** process. Its
bootstrap scripts and native dependencies live outside ASAR. This isolates
Sharp/libvips from Electron's Linux GLib symbols; the browser and system keyring
remain in Electron. Node's own license notices accompany the bundled executable.

## Build

Build on each target OS/CPU. Cross-copying Linux Prisma, Sharp or media binaries
into Windows/macOS installers is unsupported. Use exactly **Node.js 22.23.4**,
pinned in [`.nvmrc`](../.nvmrc); packaging checks the exact version. Provision the
native media compiler tools described in [MEDIA-NOTICES.md](MEDIA-NOTICES.md).

```sh
npm ci
npx --no-install prisma generate
npm test
npm run lint
npm run build
JOBS=2 bash ops/build-media.sh \
  --prefix /absolute/fresh-media-work \
  --out /absolute/fresh-media-build \
  --cache /absolute/media-source-cache
export LLM_CANVAS_MEDIA_BUILD=/absolute/fresh-media-build
npm run desktop:package -- /absolute/fresh-stage /absolute/desktop-output
```

Use native filesystem paths with symlink/junction support for staging and build
output, with at least 6 GB free for packaging. ExFAT/shared removable disks may reject permission
changes or dependency links; completed archives can be copied there afterward.
The **Native desktop acceptance** workflow builds on Windows, macOS and Linux,
then checks the actual installer payload before uploading accepted artifacts.
It supports manual dispatch and pushes to temporary validation branches
matching `feat/desktop-release-validation-*`; it does not publish releases.
The rc7 native checks pass on all three systems. Host gates pass 564 tests
(563 passed, zero failed, one separately covered Alpine-only skip), lint and build.
See [RELEASE-VERIFICATION.md](RELEASE-VERIFICATION.md) for actual artifact hashes,
checks and the explicit Windows CI occlusion workaround. These results do not
establish trusted signing or quarantined OS first launch.

For local debugging, first stage a package, then launch:

```sh
npm run desktop:runtime
LLM_CANVAS_DESKTOP_SERVER=/absolute/fresh-stage/server npm run desktop:start
```

Electron 45 downloads its development runtime with the explicit
`desktop:runtime` command. This is a developer setup step; packaged applications
already include the runtime and do not run it.

The `--dir` packaging argument builds an unpacked application for testing. Linux
AppImage needs FUSE; on hosts without it, use `--appimage-extract-and-run` or the
tar.gz package. Never disable Chromium's sandbox to work around startup errors.
Windows and macOS previews are unsigned. Their actual installation and runtime
checks pass; trusted signing/notarization and quarantined OS first launch are
not established by those checks.

## Install the preview

Use the matching asset from [Releases](https://github.com/dannychirkov/llm-canvas/releases).
Compare its SHA-256 with `SHA256SUMS`. A checksum verifies bytes against that
release record; it is not a publisher signature.

| System | Asset | Installation |
| --- | --- | --- |
| Windows x64 | `LLM-Canvas-0.1.0-rc.7-x64-Setup.exe` | Run the NSIS installer as your regular account, then open LLM Canvas. |
| macOS Apple silicon | `LLM-Canvas-0.1.0-rc.7-arm64.dmg` | Open the DMG, copy LLM Canvas to Applications, then open the copied app. Intel Macs are not an accepted target for this RC. |
| Linux x64 | `LLM-Canvas-0.1.0-rc.7-x86_64.AppImage` | Make it executable and run it with an unlocked supported system keyring. |

```sh
chmod +x LLM-Canvas-0.1.0-rc.7-x86_64.AppImage
./LLM-Canvas-0.1.0-rc.7-x86_64.AppImage
# Without FUSE:
./LLM-Canvas-0.1.0-rc.7-x86_64.AppImage --appimage-extract-and-run
```

Unsigned Windows downloads may show an unknown-publisher/SmartScreen prompt;
review the source and checksum before deciding to proceed. See
[Microsoft's reputation guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).
For the unsigned macOS preview, first attempt to open it, then use **System
Settings → Privacy & Security → Open Anyway** if you trust the verified download.
See [Apple's instructions](https://support.apple.com/102445). Managed OS policies
may prevent exceptions. Do not disable system protections or Chromium sandboxing.
The native CI checks do not simulate these downloaded-file reputation/quarantine
prompts. Trusted signing is not configured in this RC.

## Update notifications

RC5 has no update checker: users on `0.1.0-rc.5` must download and manually
install a newer desktop release once to gain update notifications.

Desktop releases since RC6 offer **Help → Check for Updates…** and check automatically
30 seconds after packaged startup, then every six hours. Native dialogs also
work in the unsigned macOS preview. Checks use only the public GitHub releases
feed for `dannychirkov/llm-canvas`: prerelease apps include RC releases (up to
100 releases from the feed are inspected); stable apps use GitHub's latest stable
release. The newest compatible newer SemVer release in that feed offers a Windows
x64 NSIS installer, macOS arm64 DMG, or Linux x64 AppImage for the running platform.
Automatic failures stay silent, and each available version prompts at most once
per application process. Manual checks report failures or missing installers.
Completed results, including failures, are reused for 60 seconds to limit requests.

**Download update** opens the matching GitHub asset in your browser. Quit the app
and install the downloaded release manually over the existing installation;
the local profile, accounts, canvases and encrypted credentials persist when
using the same OS account/keyring and profile. Back up the complete profile
first as described below. This is a notification and download-link feature,
not a full automatic updater: it never downloads or installs code itself.

Set `LLM_CANVAS_DISABLE_UPDATE_CHECKS=1` in the launching environment to disable
automatic checks; the Help menu check remains available. Development launches
do not check automatically. Native acceptance runs explicitly set this variable
to keep external release traffic and update dialogs out of deterministic runs.

## Appearance and application icons

Fresh profiles start in Dark. Use **Account → Appearance** for Light, Dark or System; explicit selections persist, and System resolves the OS preference on startup. Existing Light selections are retained. Browser/Apple and Windows/macOS/Linux package/window icons derive from the unchanged server favicon. Regenerate the platform assets with `node desktop/brand-assets.cjs`; larger sizes resample the original artwork.

## First launch and storage

The application creates an empty local profile and opens registration. Create
a local account, then configure providers. There is no bundled production
account, database, upload, API key, gateway workflow or production auth secret.
Desktop and a remote server have separate accounts and data. Docker DNS names
such as `omniroute` normally cannot be resolved from a user's computer; use the
gateway address reachable from that computer.

The private profile contains:

- `data/prisma/dev.db`: local account, canvases, settings and usage.
- `data/public/uploads`: private media, with existing owner checks.
- `auth-secret.bin`: an OS-encrypted installation secret, used by the same API
  credential encryption as the server.
- `backups`: database and any SQLite journal/WAL companions copied while the
  previous backend is stopped, before migration. Backups are local and currently
  retained until the user removes old copies.
- `migration.log`: diagnostics from migration only; no model requests.
- `runtime.json`: exclusive main/backend ownership lease. It is not user data.

Windows uses DPAPI, macOS Keychain, and Linux an unlocked supported system
keyring. Unavailable or unprotected Linux key storage fails closed. Unlock or
install the system keyring and restart. Never delete `auth-secret.bin` to fix an
error: replacing it makes previously stored provider credentials unreadable.
If a nonempty desktop database exists but its secret is missing, startup fails
closed instead of generating a replacement. Restore the original secret/profile.
The pinned Electron 45 Linux fallback check uses a deprecated synchronous
backend-identification API; reassess this guard before upgrading to Electron 46.

Back up the complete profile while the application is closed. The encrypted
secret also depends on the original OS account/keyring; a file copy alone does
not guarantee credential portability to another computer. Use canvas export/
import for moving workflows and enter provider credentials on the destination.
Do not share a live profile/SQLite file between desktop and a headless server.

## Process and browser boundaries

The backend binds only a random `127.0.0.1` port. Its canonical auth URL is that
origin, independent of any production `AUTH_URL` in the launching shell. The
renderer has sandboxing and context isolation enabled, without Node.js integration
or an application IPC bridge. Owned application windows can write sanitized
clipboard text; clipboard reads and device permissions remain denied. Media/CSV
popups for the application origin or `about:blank` inherit the same protections.
External navigation stays outside the renderer: only credential-free HTTP(S)
links with active user activation can open in the system browser. Other external
schemes, redirects and webviews are blocked. CSV preview filenames and contents
are assigned as DOM text, so uploaded text cannot become executable HTML.

Electron's single-instance lock and an additional PID lease exclude concurrent
backends for one profile. Storage mutations serialize within that backend.
Headless Linux deployments retain their cross-process kernel `flock` locks.
The main process sends heartbeats; an orphan backend shuts down after the
heartbeat expires. Closing the application requests Next.js cleanup, with a
bounded forced stop. Closing while model requests run can interrupt them.

If startup reports that the old server is running, wait for shutdown and retry.
Do not remove the lease while either recorded PID is alive. A PID reused by an
unrelated process intentionally requires manual confirmation that the old
desktop processes have stopped; the app never steals an active lease by age.

## Acceptance before distribution

Use an isolated OS profile with a real system keyring. Verify a clean first
launch, registration/login, provider configuration, chat/stream/image/media,
canvas save/reload, export/import, closing and reopening with credentials intact,
and process-death recovery. Check that the packaged native binaries execute and
that every dependency link stays inside the package. Repeat for each OS/CPU.

`desktop/acceptance.cjs` drives the installed NSIS app, the app copied from a
read-only DMG, or the extracted AppImage payload. The workflow supplies DPAPI,
an isolated macOS keychain, or a Linux Xvfb/D-Bus/Secret Service session. The
harness uses four launches: initial, clean restart, recovery after killing the
main process, and recovery after killing the backend. Browser and provider-wire
checks run on every launch; OS executable paths/profile ownership and saved
credential continuity are checked, along with a packaged FFmpeg/FFprobe PCM/WAV
round trip. A passing harness does not establish signing, notarization or macOS
Gatekeeper first-launch behavior. Windows/macOS previews remain unsigned.

For an isolated debug run with an explicitly enabled local CDP port, the
repository provides `node desktop/smoke.cjs PORT` and `--resume` for renderer
sandbox, authentication and persistent canvas checks. This creates a synthetic
local account; never point it at a real user profile. CDP is not enabled by the
application itself. Broader shared provider/protocol tests remain part of the
server suite; a package build alone is not proof of native desktop acceptance.

`node desktop/wire-smoke.cjs PORT` adds a synthetic local provider, checks chat,
SSE, context metadata and exact cached/reasoning/ledger accounting. Repeat with
`--resume` after restarting to verify saved credential decryption. Its fixture
key is not a real provider credential. Both scripts require an isolated profile.

## Media source distribution

Desktop packaging requires `LLM_CANVAS_MEDIA_BUILD` from the controlled source
build; Docker builds the same tools in a separate Alpine stage. Both distribute
a paired **FFmpeg/FFprobe 9.0.2**, with dav1d 1.5.4 and zlib 1.3.2. The helper
disables GPL/version3/nonfree and external-library autodetection, checks the
actual executables' license/configuration, and retains the exact source archives,
available signatures, build materials and notices in `media-sources.tar.xz`.
`manifest.json` records the target OS/CPU, source pins and SHA-256 file inventory;
desktop packaging verifies it before staging. Build objects are not distributed.

The old `ffmpeg-static`/`ffprobe-static` packages are development-only filesystem
fallbacks. Application code no longer imports their JavaScript wrappers, and
desktop/Docker runtime packages exclude those legacy GPL static distributions.
Keep the controlled source bundle and notices with the binaries and beside
installer downloads. See [MEDIA-NOTICES.md](MEDIA-NOTICES.md) for the exact pins,
license texts, build requirements and verification limits. The separate
[native source companion](NATIVE-SOURCE-MATERIALS.md) retains Sharp/libvips and
Electron Chromium FFmpeg sources, recipes and full published notices for all
four native environments, including Alpine. Distribute it beside the installers;
it is separate from the controlled CLI source archive inside each package.
The application source remains Apache-2.0; bundled third-party components retain
their own licenses.

For an AppImage-only Linux validation build, append `--appimage` to the packaging
command; default Linux packaging also creates a tar.gz archive. The packaged
AppRun never adds `--no-sandbox` or injects library-loader paths. The application
refuses `--no-sandbox`; configure supported operating-system sandboxing rather
than weakening it. Startup uses its own bounded deadline, so delayed queued IPC
heartbeats during synchronous module loading do not expire a running-server lease.
