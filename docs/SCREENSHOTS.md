# LLM Canvas screenshots

These screenshots show the actual application with a synthetic demonstration account and graph. The prompts and saved example replies were prepared for documentation; they are not live model benchmarks. No personal canvases, real provider keys or private uploads are included.

## Branch and combine

![A dark nine-node canvas with two review branches, source notes and a connected conclusion](images/canvas-demo.png)

Nine nodes form a top-to-bottom workflow: explore two perspectives, add source context, review each branch, then merge the findings. Each connection leaves the source at its bottom handle and enters the next node at its top handle. Arrows select context; use Run Selected to execute selected dependencies in order.

## Inspect context

![The node inspector showing connected demonstration context and a saved result](images/context-inspector.png)

Review connected context and the saved result in the node inspector. Token estimates and provider-reported usage have different meanings; see [tokens and caching](TOKENS_AND_CACHING.md).

## Connect your own endpoint

![The initial provider setup with a custom endpoint option](images/provider-setup.png)

Use a built-in provider, an OpenAI-compatible endpoint, or a supported ComfyUI workflow. Model discovery, manual model entries and per-model context capacity are configured through the same provider settings.

See [provider protocols](PROVIDER_PROTOCOLS.md) for the supported request types and server requirements, or [download a preview](https://github.com/dannychirkov/llm-canvas/releases) to try it.
