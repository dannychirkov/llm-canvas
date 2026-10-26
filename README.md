<p align="center"><img src="public/brand/icon.png" alt="LLM Canvas" width="80" height="80"></p>

# LLM Canvas

**Conversations branch. Your workspace should too.**

A visual workspace for working with language models. Put a question on the canvas, explore it with different models, and connect their replies to the next step. Keep the prompts, files and results together instead of copying between chats.

[Download desktop previews](https://github.com/dannychirkov/llm-canvas/releases) · [Self-host with Docker](#run-with-docker) · [Screenshots](docs/SCREENSHOTS.md) · [Support the project](#support-and-sponsorship)

![Original LLM Canvas screenshot showing a working canvas with model branches, media and persistent Memory](docs/images/canvas-demo.png?v=original)

*An original project screenshot, preserved unchanged: a working canvas with multiple model branches, media and persistent Memory. Captured with an earlier interface; see the [gallery](docs/SCREENSHOTS.md) for more original screenshots.*

Windows, macOS and Linux desktop previews share the same core as the headless server. Bring your own provider credentials or connect a local model server. Licensed under [Apache 2.0](LICENSE).

**Current release: 0.1.0-rc.7.** This is a preview: interfaces and export formats may change before a stable release. Read the [changelog](CHANGELOG.md) and keep backups when upgrading.

## Why a canvas?

A linear chat is useful until you want to explore two ideas at once, compare models, or bring earlier answers back into a new question. LLM Canvas makes those paths visible.

- **Explore a question from several angles.** Branch into research, tradeoffs and implementation, then feed those replies into a shared conclusion.
- **Compare prompts and models.** Give two model nodes the same source material and keep their answers beside each other.
- **Control what travels downstream.** Connect the prompts, replies and attachments a model should receive, then inspect the assembled context before running it.

An arrow carries context. It does not start an autonomous conversation or rerun a model by itself. **Run Selected** executes selected dependencies in order; saved replies from unselected ancestors can be reused. Read the [graph contract](docs/NODE_COMMUNICATION.md) for the details.

## What you can do

- Build and save graphs of text, model, summary, image, media, Memory and Notes nodes.
- Use OpenAI, Google Gemini, OpenRouter, custom OpenAI-compatible providers and native ComfyUI workflows. Configure credentials and select models in **Settings → Providers**.
- Stream model replies, inspect assembled context, and compare estimated input size with reported token usage.
- Pass uploaded images, CSV data and supported video inputs into connected models. Model capabilities still determine which inputs are accepted.
- Generate images through Gemini or supported custom image protocols. A model appearing in a model list does not establish image-generation support.
- Export/import canvas data and media. Provider credentials remain encrypted; keep the installation secret to reuse them on another installation.

## Available nodes

| Node | Use it for |
| --- | --- |
| Text | Add a prompt, instruction or source text to a branch. |
| OpenAI, Gemini, OpenRouter | Run a configured provider's model and keep its reply on the canvas. |
| Custom endpoint | Use a compatible remote or local endpoint with its own models and supported protocol. |
| Summarizer | Summarize connected material, including chunked processing for longer input. |
| Image generation | Generate or edit images with a compatible model or configured ComfyUI workflow. |
| Media | Attach images, CSV data and supported video inputs. |
| Memory | Keep reusable text available across the canvas. |
| Notes | Document the workflow without adding text to model requests. |

## How the graph works

In `A → B → C`, running B includes connected earlier prompts and available replies, plus B's own instruction. You can select several model nodes and use **Run Selected**: selected dependencies run first, independent branches can run together, and unselected ancestors reuse their saved results. An edge does not start a model automatically when another model finishes.

Visible Memory values are global to the canvas, even without edges. Notes do not enter the model context. Hidden nodes cut their upstream branch. A summary contributes its output alongside its raw ancestors; it does not automatically replace them. Each model node stores its current reply; represent earlier conversation turns with earlier nodes.

See [node communication](docs/NODE_COMMUNICATION.md), [tokens, context and caching](docs/TOKENS_AND_CACHING.md) and the [operator notes](docs/OPERATIONS.md) for the execution contract, accounting and recovery limits. Token estimates are approximate and are not provider billing records.

## Try it on your desktop

| Platform | Preview package |
| --- | --- |
| Windows x64 | NSIS installer (`*-x64-Setup.exe`) |
| macOS Apple Silicon | Disk image (`*-arm64.dmg`) |
| Linux x64 | AppImage (`*-x86_64.AppImage`) |
| Headless server | Docker image archive, or build from source below |

Choose the matching asset in [Releases](https://github.com/dannychirkov/llm-canvas/releases), then follow the [desktop installation guide](docs/DESKTOP.md#install-the-preview). Desktop includes the application runtime; it creates a local profile for your canvases and credentials. You still need a model provider or a reachable local model server.

Windows/macOS previews are unsigned. Read the installation guide before first launch. For a private server or access from several devices, use Docker.

<details>
<summary>Desktop runtime, sandbox and bundled media tools</summary>


The same application core supports desktop packages for Windows, macOS and Linux,
and a headless Docker server. Desktop starts its own loopback server and creates a
separate local profile with an OS-encrypted secret. Missing that secret beside an
existing database fails closed. The native workflow checks actual NSIS/DMG/
AppImage payloads with real OS key storage, four launches and two process-crash
recoveries. Native Windows x64, macOS arm64 and Linux x64 acceptance passes;
see the [verification record](docs/RELEASE-VERIFICATION.md). Windows/macOS
previews are unsigned; trusted signing, notarization and quarantined Gatekeeper
first launch are not verified. Download the matching installer from
[Releases](https://github.com/dannychirkov/llm-canvas/releases) and follow the
[installation instructions](docs/DESKTOP.md#install-the-preview).

Desktop and Docker ship a controlled FFmpeg/FFprobe 9.0.2 pair with exact retained
source/build materials, notices and a SHA-256 manifest. The old static npm
packages are development-only and excluded from runtime distributions. Desktop
packaging requires `LLM_CANVAS_MEDIA_BUILD`; see the [desktop guide](docs/DESKTOP.md)
and [media build requirements](docs/MEDIA-NOTICES.md). The [native source companion](docs/NATIVE-SOURCE-MATERIALS.md) supplies matching
Sharp/libvips and Electron FFmpeg sources, recipes and notices alongside releases.

Desktop media windows inherit the renderer sandbox. Clipboard text writes are
allowed for owned app windows; reads/device permissions remain denied. CSV
previews render filenames and contents as text rather than HTML.

</details>

## Run with Docker

Requirements: Docker Engine or Docker Desktop, Docker Compose v2, and enough disk space for the image, SQLite data and uploads. The first build downloads dependencies and may need several GB of free space. No Node installation on the host is required.

```bash
git clone https://github.com/dannychirkov/llm-canvas.git
cd llm-canvas
cp docker.env.example docker.env
docker compose --env-file docker.env up --build -d
```

Open [http://localhost:4250](http://localhost:4250). **The first registered account becomes the installation owner.** Create it before making a fresh installation reachable by other people. Later users need an invitation from the owner; the default installation limit is ten users.

The Compose file reads `docker.env`. Passing the same file with `--env-file` also supplies Compose variable interpolation; keep any exported shell variables consistent with it. Do not use a development `.env` containing a different authentication secret for Docker.

```bash
docker compose --env-file docker.env ps
docker compose --env-file docker.env logs --tail=100 llm-canvas
curl --fail http://localhost:4250/api/health
```

The default port mapping exposes port 4250 on host interfaces. For a private local installation, restrict access with your firewall or change the mapping to `127.0.0.1:4250:4250`. For remote access, follow the HTTPS guidance below.

### Persistent data and upgrades

Compose mounts two named volumes: `db` at `/app/prisma` and `uploads` at `/app/public/uploads`. Actual volume names depend on the Compose project name. The database volume also holds `.auth.secret`, generated on first Docker startup. That secret protects sessions and encrypts stored provider credentials. Existing installations reuse it, including when an environment secret is supplied later.

Before an upgrade:

1. Stop application writes and back up **both complete volumes**, including the secret file. A stopped application makes a coherent SQLite/files backup possible. Protect backups as private data.
2. Test the candidate image and any migrations on a separate copy of the database and uploads. Startup applies the packaged Prisma migrations automatically.
3. Keep the previous image, environment configuration and a verified backup. Rebuild/start the candidate only after those checks.
4. Verify login, dashboard, canvas loading, JS/CSS assets, private attachments and a model request after promotion. `/api/health` checks database/schema access and writable storage; it does not verify providers or the whole UI.

Keep the same Compose project name so upgrades attach the existing volumes. **Do not run `docker compose down -v` on data you need.** Image rollback does not roll back a database migration. An in-app export is useful for portability, but does not replace a full database/uploads/secret backup.

### HTTPS and remote deployment

Terminate TLS at a reverse proxy and set `AUTH_URL` in `docker.env` to the exact public URL, including any nondefault port, before recreating the application container. Forward the original host and protocol, allow streaming responses without proxy buffering, and set request/time limits suitable for model execution and uploads. Restrict direct access to the application port when the proxy provides the public entry point.

Always use that canonical HTTPS URL to sign in. Authentication cookies configured for HTTPS will not work through a different insecure address. Preserve `AUTH_SECRET` and the existing volume secret across deployments; changing the secret prevents decryption of saved provider keys.

## Run from source

Native headless setup requires Linux with local filesystem advisory locks, `/usr/bin/flock` (util-linux or BusyBox), exactly **Node.js 22.23.4** from [`.nvmrc`](.nvmrc), npm, Git, and OpenSSL (or another secure secret generator). Use the Linux Docker image for headless deployment on other host operating systems, or the native desktop build described above. Docker bundles the controlled FFmpeg/FFprobe pair. Source development can use the legacy development-only binary paths; set `FFMPEG_PATH` and `FFPROBE_PATH` to the controlled build's executables for video verification.

```bash
git clone https://github.com/dannychirkov/llm-canvas.git
cd llm-canvas
npm ci
cp .env.example .env
openssl rand -base64 32
```

Put the generated value in `AUTH_SECRET` in `.env`. Use `.env` for this setup because both Next.js and Prisma CLI load it; `.env.local` alone is not sufficient for Prisma CLI configuration. Keep `DATABASE_URL=file:./dev.db`: Prisma resolves this relative to `prisma/schema.prisma`, so the file is `prisma/dev.db`.

```bash
npx --no-install prisma generate
npx --no-install prisma migrate deploy
mkdir -p public/uploads
npm run dev
```

Open [http://localhost:4250](http://localhost:4250). For a native production process, run `npm run build` then `npm run start -- -p 4250` with the same secret and database configuration. The shipped Prisma schema fixes the CLI database URL to `file:./dev.db`; changing only the runtime `DATABASE_URL` does not redirect CLI migrations. Keep the default layout unless you also arrange migrations against the intended database.

## Configuration

Use [docker.env.example](docker.env.example) for Docker or [.env.example](.env.example) for native development. Never commit filled-in environment files, database files, backups or uploads. Provider keys are configured through authenticated settings, rather than global provider-key environment variables.

| Variable | Purpose |
| --- | --- |
| `AUTH_URL` | Canonical application URL; defaults in examples to `http://localhost:4250`. Use HTTPS remotely. |
| `AUTH_SECRET` | Required for native setup. Docker generates/persists it in the database volume if absent. Preserve it for the lifetime of stored credentials. |
| `DATABASE_URL` | Runtime Prisma database URL. Native default: `file:./dev.db`; Docker: `file:/app/prisma/dev.db`. See the CLI migration caveat above. |
| `MVP_USER_LIMIT` | Installation user limit; default `10`. Registration after the owner requires an invite. |
| `MVP_STORAGE_LIMIT_DEFAULT` | Per-user default storage allowance in bytes; default `1073741824` (1 GiB). The owner has no application storage quota. |
| `LLM_ALLOWED_PROVIDER_ORIGINS` | Comma-separated exact HTTP(S) origins allowed for non-owner custom endpoints, e.g. `https://gateway.example.com`. No paths; empty by default. The owner may configure private endpoints. |
| `FFMPEG_PATH`, `FFPROBE_PATH` | Native video tool paths; Docker sets `/app/media-tools/bin/ffmpeg` and `/app/media-tools/bin/ffprobe`. Desktop sets its bundled paths. |
| `LLM_CANVAS_MEDIA_BUILD` | Desktop packaging input: the controlled media output root with paired binaries, source bundle, notices and hash manifest. See [MEDIA-NOTICES.md](docs/MEDIA-NOTICES.md). |
| `ENABLE_CLIENT_ERROR_LOGS` | Optional client error-log ingestion; disabled by default in production. Enable intentionally with `true` when needed for diagnostics. |
| `NEXT_PUBLIC_ANALYTICS_ENABLED` | Analytics installation opt-in; disabled unless exactly `true`. User consent is also required. |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | PostHog configuration when opting into analytics. |

`NEXT_PUBLIC_*` values are embedded at build time. Setting them only in an already-built container does not reconfigure browser code. The standard Docker build keeps optional analytics disabled; enabling it requires supplying the public values to the build as well as obtaining user consent.

## Connect models

In **Settings → Providers**, configure a built-in provider or add a custom endpoint. Use the base URL reachable **from the application server**, including its API prefix. For a custom provider, choose **API type**: **OpenAI-compatible (chat and images)** or **ComfyUI workflow API**. OpenAI-compatible providers use `/models` when available; model IDs can also be entered manually. Context capacity comes from model metadata, a manual override, or an endpoint fallback, and can differ between models.

| Custom protocol | Configuration and behavior |
| --- | --- |
| Chat Completions | Default chat API: `POST /chat/completions`, with text/image context and streaming on compatible models. |
| Responses | Select **Responses API** under advanced **Chat API** settings to use `POST /responses`. This is an explicit protocol choice. |
| Images API | Choose image generation to call `POST /images/generations`, or image editing to send connected source images as multipart data to `POST /images/edits`. Requires a compatible image model. |
| Chat image output | Requests image output through `/chat/completions`; this requires a gateway/model supporting that response format. |
| ComfyUI workflow | Connect to the native ComfyUI base URL, without an OpenAI `/v1` suffix. Connection checks use `/system_stats`; execution submits `/prompt`, polls that job's history and saves returned images as private canvas media. |

Provider support varies. Selecting a protocol does not add that capability to a server. Image responses must contain supported image data; arbitrary external image-result URLs are not fetched. Image editing/workflow uploads are bounded to four images, 20 MiB per image and 40 MiB combined. ComfyUI jobs have a 120-second application deadline, so larger workflows may need to be reduced or run outside the canvas.

### Configure a ComfyUI workflow

Save an **API-format graph** containing `class_type` and `inputs` for each node, rather than the frontend layout export. The template must contain `{{prompt}}`; optional bindings are `{{seed}}`, `{{model}}` and `{{image:0}}` through `{{image:3}}`. Seed and image bindings must occupy an entire input value. Configure the required checkpoints and other model files inside the workflow; a catalog/model alias alone does not supply them. Use `{{model}}` only where the selected model entry is the value that workflow input expects.

Workflow templates are encrypted in server-side provider settings and limited to 512 KiB and 500 API nodes. Choose the explicit workflow output mode on a custom node; image-input workflows also need the corresponding image placeholders. The application uploads bound source images, follows its own job ID, and stores outputs as owned media. ComfyUI does not report LLM token billing, so its usage is shown as unreported rather than invented token counts.

Inside Docker, `localhost` refers to the application container. Reach another container through a shared network, or use a reachable host address. Public and private gateways can have different authentication and protocol requirements; an OpenAI-compatible model list alone does not establish support for every inference API.

See the [custom provider guide](docs/PROVIDER_PROTOCOLS.md) for protocol configuration and local-server examples. Adapter implementation and live model validation are separate; use a workflow and model verified on your own server.

## Development and reporting

```bash
npm test
npm run lint
npm run build
```

Tests use Node's built-in runner with the installed dependencies. Live integration scripts may require an isolated database/uploads copy and can incur provider charges; they are not part of the basic setup.

The RC7 host checkpoint passes **564 tests: 563 passed, zero failed,
one host BusyBox check skipped**. Lint/build, RC7 native installers and the fresh Alpine image pass; isolated
server integration checks and a data-preserving rollout also pass. The Alpine storage
check passes separately on native Alpine. Installed desktop checks and isolated
server Chromium/protocol/admission results are recorded in the
[verification record](docs/RELEASE-VERIFICATION.md).

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes. Report ordinary bugs through the repository's issue tracker with sanitized reproduction steps. For vulnerabilities, use the private channels in [SECURITY.md](SECURITY.md).

The stack is Next.js 16, React 19, TypeScript, React Flow, Prisma 6/SQLite and Auth.js/NextAuth v5 credentials authentication. This release candidate is intended for self-hosting; a broad public service needs its own operational review, monitoring and recovery plan.

## Support and sponsorship

LLM Canvas is an independent open-source project. I am looking for sponsors who want a practical, self-hostable workspace for working with models across providers.

Financial support would help cover maintenance, model/API compatibility testing, native build infrastructure, and desktop code signing and notarization. API credits, test hardware and help with accessibility testing would also be useful.

See [sponsorship and partnership opportunities](docs/SPONSORSHIP.md) for the project pitch and priorities. To discuss support, [open a sponsorship inquiry](https://github.com/dannychirkov/llm-canvas/issues/new?title=Sponsorship%20inquiry). Share only public information; a private contact can be arranged afterward. No payment page is currently configured.

You can also help by trying a release, reporting a reproducible bug, improving the docs, contributing a focused fix, or starring the repository so more people can find it.
