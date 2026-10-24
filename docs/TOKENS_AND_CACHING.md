# Tokens, context and caching

## Different numbers answer different questions

- **Model context capacity** uses an explicit per-model override, then provider-discovered metadata, then the endpoint fallback. It is a limit, not the amount consumed by a request.
- **Largest Input (est.)** on the dashboard is the largest node input/context estimate or recorded input count in the saved graph. Custom nodes and summarizers are included. It is not the model capacity or total billed usage.
- **Estimated input** on an unexecuted/edited node includes its prompt, relevant ancestors, permanent memory and media metadata. It does not fetch media bytes. Text/media conversion remains an estimate, not a model-specific tokenizer promise.
- The inspector shows this next-request preview for custom endpoints and edited/retryable nodes, using the selected summary provider's estimate. Summary cards use discovered per-model capacity and keep recorded chain history separate; completed execution strategy is not rewritten by a preview. Array and wrapped video-frame metadata produce the same estimates and execution attachments.
- **Provider-reported usage** is the authoritative execution total, including a legitimate zero. The server records each physical request before delivering completion. Totals are not supplied by the browser.
- **Estimated / Not reported / Source unavailable** distinguish fallback estimates, absent provider usage and historical records without provenance. A numeric zero placeholder for unreported image usage is not a free-generation claim.

The active graph view describes current successful node results. The cumulative history contains all recorded physical executions, including earlier reruns and completed summary steps when a later step fails. Closing a tab cannot erase usage the server has already observed. If a connection fails before the provider reports usage, exact upstream billing remains unavailable.

## Cached and reasoning tokens

Cached tokens are a subset of input tokens. OpenAI-compatible reasoning tokens are normally a subset of output tokens. Gemini text reports thoughts separately; NanoBanana normalizes thoughts into output. Provider `total_tokens` / `totalTokenCount`, including zero, take precedence over reconstructed totals. Detail categories are informational and must not simply be summed.

The application does **not** implement a shared response cache or skip a provider request because a graph looks unchanged. A new run makes a new request. Provider-side prompt caching, eligibility, retention and pricing are controlled by the gateway/upstream provider. A cached-token count does not establish a particular monetary discount; the UI is not an invoice.

Dashboard metric caching is unrelated: it caches graph measurements, refreshes on save or when stale, and uses revision-conditional writes so a delayed refresh cannot undo a newer save. Preview calculations use metadata rather than repeatedly downloading image/video payloads.

## Debug and document persistence

Debug previews are bounded and explicitly mark omissions/truncation. Inline binary data and sensitive header/key fields are omitted from debug previews. Actual prompt/response content and restore snapshots remain available; a truncated raw debug preview must not be mistaken for the complete provider wire response.

Document saves use revision checks. A conflict preserves the local draft instead of overwriting another tab. New edits made during an in-flight save stay dirty, and Save-and-leave does not discard them. Historical large debug payloads are compacted when read/saved; this release does not silently rewrite every production document during migration.
