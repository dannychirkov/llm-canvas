# Contributing to LLM Canvas

Keep discussions respectful and changes focused. For a substantial behavior change, describe the use case and expected graph semantics before starting a large implementation.

## Development setup

Follow the [source setup in README](README.md#run-from-source): use Node.js 22.18+ in the 22.x line, `npm ci`, a private `.env`, a generated authentication secret, and a local database initialized with the packaged migrations. Use synthetic accounts and files for development. Do not point tests or migrations at somebody's live installation.

Create a `feat/*` branch from `develop` for your change. Do not push directly to `master` or `develop`. Keep dependency changes explicit; commit the updated lockfile when they are necessary. Do not include unrelated formatting or generated build output.

## Implementation guidelines

- Use TypeScript and existing typed provider/context interfaces. Avoid adding `any` or duplicating provider-name unions; the registry is `src/lib/providers/registry.ts`.
- Keep changes local. Prefer a small shared helper where multiple callers need the same behavior.
- Preserve ownership checks for canvas/media operations. Resolve saved provider credentials on the server; do not send them back through ordinary settings or execution responses.
- Use normalized public errors and structured, sanitized logs. Never log API keys, authentication cookies, raw provider headers or private prompts.
- Keep user-facing text in English. Explain new protocol/capability settings in terms of what the user can do.
- Keep database migrations additive and test them on a separate database copy first. Never use a destructive reset or `db push` as an upgrade procedure.

## Validation

Before submitting a change, run:

```bash
npm test
npm run lint
npm run build
```

Add a focused regression when fixing a meaningful behavior defect. Assert the user-visible or provider-wire contract, rather than just reproducing the implementation. Include failure and cancellation cases when changing execution, streaming, storage or accounting.

The default tests use Node's built-in test runner. Some test harnesses mount actual editor callbacks with React/JSDOM; they do not provide full browser layout or end-to-end interaction coverage. Say which checks you ran and what they establish.

Live scripts under `reports/` and installation-specific helpers under `ops/` are not a generic test environment. Inspect their guards and requirements first. Use an isolated database/uploads copy, explicit test credentials, loopback ports and a bounded number of paid calls. Never run them against production just to satisfy a test checklist.

## Reporting bugs

Include the application version or commit, operating system, browser, deployment method, expected behavior and minimal reproduction steps. For a graph issue, a small synthetic graph is often more useful than a screenshot. For a provider issue, include the protocol, sanitized model ID and HTTP status when available.

Remove prompts containing private information, tokens, keys, cookies, environment files and database exports before sharing logs or screenshots. Do not attach an export from a real account as a reproduction fixture. Send security findings through [SECURITY.md](SECURITY.md), rather than a public issue.

## Preparing a change for review

Use English [Conventional Commit](https://www.conventionalcommits.org/) messages, such as `fix: preserve generated images in downstream context` or `docs: clarify native database setup`.

Describe the problem, the resulting behavior, relevant validation, and any compatibility or migration impact. Keep review requests small enough to assess independently. New provider features should state the protocol they implement, supported inputs/outputs, and known limitations; a model name is not a capability test.

The project is licensed under [Apache 2.0](LICENSE). Preserve existing license and attribution notices.
