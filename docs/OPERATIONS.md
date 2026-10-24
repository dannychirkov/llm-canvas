# Operating a release candidate

Back up the database volume, uploads volume and persisted authentication/encryption secret together. Take a consistent snapshot while all application instances using those volumes are stopped, or use SQLite's backup facilities for a live database. Verify archive integrity and test restoration on a separate copy before relying on it. Keep backups private and outside temporary directories.

Do not regenerate the authentication secret when restoring a database: stored provider keys and workflows depend on it. Roll back application images independently of persistent data. Schema changes must remain additive and be tested on a database copy first.

## Runtime database client

Docker images contain a native Prisma Client generated during the build. Startup compares its bundled schema with the application schema. A fresh or stale volume marker does not trigger regeneration or dependency downloads. A missing/mismatched client fails with a rebuild instruction; rebuild the image from the matching locked source rather than installing packages inside a running container. The former SKIP_PRISMA_GENERATE override is no longer needed and cannot bypass this validation.

## Storage reservation after an interrupted process

Reservations now use kernel advisory locks via `/usr/bin/flock` on persistent marker files under `public/uploads/.quota-locks`. The marker is initialized and flushed before atomic publication. The Node process retains the open file description; the helper exits. Process termination or container restart releases ownership automatically, without comparing ages, PIDs or container namespaces. A successor locks the same inode. **Never delete or replace these persistent lock files while any writer is running.** An old mtime is not evidence of an orphan.

This requires Linux, a local filesystem with working advisory locks, and compatible util-linux or BusyBox `flock`. Docker's Alpine runtime includes the compatible BusyBox applet. Native Linux installations must provide `/usr/bin/flock`. Missing/unusable locking fails closed; network filesystems and multi-host storage are unsupported.

Legacy empty-directory locks and unexpected entries are deliberately not stolen. For an upgrade/recovery:

1. Stop **every** process/container sharing the uploads volume and verify none is writing.
2. Make and verify a private database/uploads/encryption-secret backup.
3. Inspect legacy lock directories. Remove only confirmed **empty directories** named with 64 lowercase hexadecimal characters using `rmdir`; it refuses nonempty directories.
4. Leave recognized regular lock files untouched. Investigate symlinks, malformed files, unexpected names or nonempty directories separately. Never recursively delete `.quota-locks` or uploads.
5. Restart, check `/api/health`, then verify a small owned save/upload. Interrupted pre-publication `.candidate-*` files are inactive, but cleanup also requires all writers stopped.

## Request and workload limits

API mutations check Origin/Content-Type directly at the route boundary. API paths bypass the Next.js proxy, whose request-body cloning otherwise waits for the complete upload before route read deadlines/admission can run. A coverage regression exercises every exported mutation and the compiled matcher.

Body readers enforce actual bytes, strict JSON objects/UTF-8 and an absolute read deadline: 15 seconds for settings/metadata/notes JSON, 120 seconds for canvas/execution JSON and multipart uploads. Existing 128 MiB canvas/execution, 50 MiB video and 128 MiB archive limits remain; smaller avatar/key/settings limits also apply. Slow bodies return 408, oversized bodies 413. Execution JSON is parsed once and reused by adapters instead of buffering a tee and parsing twice.

The supported single Node process shares admission across route bundles. There is no waiting queue: excess expensive operations return 429 with Retry-After: 1 before provider submission or body work. Limits are:

| Work | Global | Per user |
| --- | --- | --- |
| Model execution and summaries | 6 | 3 |
| Import/export/upload/avatar | 1 | 1 |
| Canvas/notes/provider-settings writes | 2 | 1 |
| Provider discovery/validation/context/reveal | 4 | 2 |

Across these lanes there are at most 8 active operations globally and 4 per user. Run Selected's three independent branches fit the execution budget. Streaming replies and ZIP exports retain admission until EOF/cancellation; cancellation waits for the provider producer to unwind. Ordinary JSON replies release after processing. Password work keeps its separate bounded authentication budget.

These are process-local controls for a single instance, not a distributed queue or a provider's billing limit. A cancelled ComfyUI request may leave its already-submitted remote GPU job running; no global backend interrupt is sent. Size/time limits and controlled admission checks do not establish an exhaustive memory/DoS guarantee.

## Hosting boundary

This candidate targets trusted, invited users on a single application instance with persistent local volumes. Authentication and storage quotas do not establish a complete server workload budget. Before running an untrusted public shared service, load-test these budgets against the actual server/workflows and configure reverse-proxy body, connection and timeout limits. Review the actual workload rather than copying limits that would break legitimate media requests.

Create the first owner privately before exposing registration, keep inference servers on trusted networks and restrict non-owner provider origins. Owner self-deletion is refused while other users remain. Sole-owner deletion resets an empty installation; ownership transfer/recovery for an already ownerless legacy database is not automated. Monitor disk space, backup retention and failed writes. Client error ingestion is off by default; enabling it uses a bounded global diagnostic budget and does not replace server monitoring.
