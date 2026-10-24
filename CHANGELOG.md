# Changelog

## Unreleased

Changes after the release-candidate baseline will be recorded here. A version bump does not publish a release or establish release readiness.

## 0.1.0-rc.4 — 2026-10-25

- Pin the build and bundled standard Node.js runtime to 22.23.4 through `.nvmrc`.
- Build a matched FFmpeg/FFprobe 9.0.2 pair with dav1d 1.5.4 and zlib 1.3.2 from pinned sources, disabling GPL/version3/nonfree. Retain exact source archives, build materials, available signatures, notices and a SHA-256 manifest; require `LLM_CANVAS_MEDIA_BUILD` for desktop packaging. See [media notices](docs/MEDIA-NOTICES.md).
- Remove static npm wrapper imports from application code; keep the legacy static packages development-only and exclude them from desktop/Docker runtime distributions.
- Add native acceptance for actual NSIS/DMG/AppImage payloads using OS key storage, four launches, browser/provider checks and recovery after killing the main process and backend. Run it manually or through isolated private validation branches matching `feat/desktop-release-validation-*`, alongside isolated headless Docker checks.
- Allow sanitized clipboard text writes in owned desktop windows while denying reads/device access; protect media/CSV child windows with the same sandbox and restrict external navigation. Render CSV filenames and contents as DOM text.
- Fail closed when an existing desktop database has lost its encrypted secret; fix import directory copying for Node 22.23.4 while retaining exclusive-copy options.
- Host gates: 482 tests, 481 passed, zero failed, one BusyBox check skipped; lint/build pass. Native CI [run 40143049074](https://github.com/dannychirkov/llm-canvas/actions/runs/40143049074) is **in progress** at this checkpoint; all OS acceptance results remain pending. Previews remain unsigned, with no signing, notarization, Gatekeeper or public release claim.

## 0.1.0-rc.3 — 2026-10-24

- Add an Electron desktop wrapper around the existing Next.js server, with a private local database/media profile and OS-encrypted authentication secret.
- Keep the renderer sandboxed without Node or application IPC, bind the backend to loopback, and enforce one backend per desktop profile with a lease/watchdog.
- Preserve headless Linux kernel quota locking and serialize local desktop writes without relying on Linux-only flock.
- Fix native Windows/UNC media containment; verify installer resources against a complete server inventory and retain native Prisma/media dependencies.
- Prepare manual Windows/macOS/Linux packaging jobs and native Linux archive/browser/protocol/persistence checks. Public desktop distribution still needs native acceptance, a tested unsigned/signing policy and matching media-tool source/notices.

## 0.1.0-rc.2 — 2026-10-24

- Protect installation ownership during self-deletion; strictly validate storage-limit updates.
- Replace racing login router transitions with one authenticated navigation.
- Recover storage reservation ownership automatically after process death with kernel advisory locks, without stealing active locks by age or PID.
- Add body read deadlines and shared per-user/global admission for expensive operations; keep stream permits until cancellation cleanup completes.
- Parse execution input once, bound remaining metadata/settings/avatar/notes readers, and preserve three-way selected execution.

## 0.1.0-rc.1 — 2026-10-24

Release-candidate preparation following 0.0.4. Open-source publication review is still in progress.

### Added

- A typed provider registry and multiple custom OpenAI-compatible endpoint configurations, alongside built-in OpenAI, Gemini and OpenRouter providers.
- Shared English provider cards and model selection; model discovery, manually entered model IDs, discovered context capacities and explicit overrides.
- Encrypted per-user endpoint keys/custom headers, configurable authentication, bounded connection checks, chat/SSE execution and protocol-specific image output modes.
- Custom endpoints can explicitly select Chat Completions or Responses, image generation, multipart image editing, or chat image output according to server/model capabilities.
- Native ComfyUI endpoint configuration with encrypted API workflow templates, prompt/seed/model/image bindings, bounded job polling, owned output images and unreported token usage.
- Server-persisted execution usage with provenance, cumulative summaries and clearer distinctions between input estimates, model capacity and reported usage.
- Private generated-media persistence and downstream image reuse; backward-compatible settings/graph import and export.
- Dependency-aware **Run Selected** with bounded independent branches, captured batch inputs, cycle checks, and failure propagation without rerunning unselected parents.
- Regression coverage for actual React editor execution, context/media integrity, provider wire formats, token accounting, authentication and storage.
- English setup, deployment, contribution and security-reporting documentation, plus separate Docker/native environment examples.

### Fixed

- Server-side credential resolution, explicit authenticated/no-store key reveal, canvas/media ownership checks and private attachment access.
- Search/debug rendering, provider-error normalization, bounded streams/summaries, cancellation and interrupted-response accounting.
- Conflicting canvas writes, import/export reference handling, upload quotas, session invalidation on password changes and non-owner endpoint egress controls.
- ReactFlow connection gestures no longer persist a dangling temporary edge that blocks Save; target-handle node creation preserves direction and handle IDs.
- Fresh Docker installations keep the compiled native Prisma Client and validate its schema without deleting it or downloading runtime dependencies.
- Missing frontend static assets in standalone deployments, coherent artifact validation and data-preserving deployment checks.
- Custom-provider dashboard/inspector token displays, cached/reasoning subset accounting, provider context previews and video-frame handling.
- Stale dependency results in selected runs, duplicated CSV context, silent attachment/video omissions, incomplete summary forwarding and unlabeled failed partial responses.
- Nano automatic modes, false Edited completion states, generated-image forwarding, overlapping executions and incomplete Restore behavior.

### Compatibility and operations

- Existing provider JSON remains readable; custom connections are additive settings. Preserve `AUTH_SECRET` when moving encrypted settings between installations, or re-enter credentials.
- Packaged additive migrations add `users.authVersion` and `token_usage.usageSource`; test upgrades against a copy before startup applies them.
- Use Node.js 22 for the documented native setup and Docker runtime. Authentication remains credentials-based, with the first account as owner and later registrations requiring invites.
- Docker persistence includes the database, uploads and the generated installation secret. Keep all three together in backups; changing the application image does not replace them.

### Known limitations

- ComfyUI endpoints require a configured workflow and compatible checkpoint/node installations. A catalog entry is not proof of a supported chat/image protocol or successful generation; live Qwen validation remains a separate check.
- Development dependency findings require separate review; a production-only dependency audit does not cover development tooling.
- Missing historical media bytes cannot be reconstructed from database metadata. A process killed during a filesystem quota operation may leave a stale lock requiring verified administrative cleanup.
- Large editor components remain maintenance debt. Synthetic HTTP/React tests are not full browser interaction, accessibility or layout coverage.

See the current audit and phase reports for measured outcomes and remaining release blockers. Historical reports describe the code and environment at the time of each check.
