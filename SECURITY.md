# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately. Use the repository's **Security → Report a vulnerability** option if private reporting is enabled, or email **dannychirkov@gmail.com**, the maintainer contact listed in `package.json`.

Include the affected version/commit, deployment method, impact and a minimal reproduction using synthetic data. Describe any authentication required. Sanitize logs and proof-of-concept files: do not send real API keys, session cookies, private prompts, environment files or full databases. Coordinate public disclosure after the maintainer has had an opportunity to investigate.

This is a community-maintained release candidate. There is no guaranteed response time or support service. The current development/release-candidate line is the focus of fixes; older snapshots do not have a promised security backport schedule. A release-candidate label does not establish security or public-hosting readiness.

## Self-hosting boundaries

- **Bootstrap:** the first registered account becomes owner. Restrict access during first registration; later accounts require owner-issued invites and are subject to the installation user limit.
- **Transport:** use HTTPS remotely and set `AUTH_URL` to the exact canonical URL. Keep direct application ports private when using a reverse proxy. Public deployment also needs operational controls appropriate to its users and network.
- **Secrets:** keep `AUTH_SECRET`, environment files, the database and backups private. Provider keys and custom headers are encrypted using a key derived from `AUTH_SECRET`; ordinary execution resolves them on the server. An explicit authenticated reveal operation can expose a saved built-in key to its owner, and initially entering a key necessarily sends it to the server.
- **Secret continuity:** Docker persists the installation secret at `/app/prisma/.auth.secret`. Back up and restore it with the database. Changing or losing it prevents decryption of saved credentials. Native deployments must preserve their configured secret as well.
- **Outbound requests:** the owner can configure arbitrary HTTP(S) provider origins, including private network services. Only grant ownership to trusted administrators. Non-owner custom endpoints require an exact origin in `LLM_ALLOWED_PROVIDER_ORIGINS`; the default list is empty. Apply network-level egress controls if the server can reach sensitive services.
- **Provider data:** connected graph content and selected attachments are sent to the chosen provider. Review that provider's retention and billing policies. Debug payloads and exported graphs can contain sensitive content even when credentials are encrypted.
- **Workflow execution:** use trusted ComfyUI workflow templates and servers. A workflow can invoke the node types installed on that server; template validation and application time/size limits are not a sandbox for a remote workflow engine.
- **Storage:** database and upload volumes contain private user data. Uploaded media is served through ownership checks, but host/container administrators can read storage. Protect host permissions and disk capacity; the owner has no application storage quota.
- **Backups:** stop writes or use a verified consistent snapshot procedure. Preserve the database, complete uploads and installation secret together; protect backup archives like the original data. Test recovery on a separate instance.
- **Updates:** review the changelog, dependency advisories and migrations before upgrading. Validate candidates on copies. Do not delete volumes to resolve a failed upgrade or publish an image containing runtime data.

## Optional telemetry

Analytics is disabled unless the build sets `NEXT_PUBLIC_ANALYTICS_ENABLED=true`, supplies PostHog configuration, and the authenticated user opts in. Public environment values are embedded in the browser build; changing runtime container variables alone does not enable or disable an existing bundle. The current error-log route does not implement the commented-out external Sentry/PostHog forwarding integrations.

Client error-log ingestion is disabled by default in production. Set `ENABLE_CLIENT_ERROR_LOGS=true` only when intentionally enabling that diagnostic path, and treat collected diagnostics as potentially sensitive.

## Release hygiene

Before publishing a source archive or container, inspect it for environment files, secrets, databases, uploads, private fixtures and identifying diagnostics. Audit Git history separately: removing a file from the current tree does not remove older copies. Historical audit/deployment reports and screenshots also need a privacy review before public distribution.

Development dependency findings and protocol-specific limitations must be assessed separately from production dependencies and tested application behavior. Do not infer complete coverage from a successful build, health check or dependency audit.
