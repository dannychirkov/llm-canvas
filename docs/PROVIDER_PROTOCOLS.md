# Custom provider protocols

Custom providers use the same cards and model selection workflow as built-in providers. Configure **Settings → Providers → Add custom provider**, select an API type, enter the server's base URL and authentication, then test and save it. Empty key/header/workflow fields preserve previously encrypted values. Saving a provider does not require successful model discovery.

| API type / node mode | Request contract | Input | Output |
| --- | --- | --- | --- |
| OpenAI-compatible / Chat | `/chat/completions`, or `/responses` selected in Advanced settings | Graph text, CSV text, images and extracted video frames | Text, including streaming |
| OpenAI-compatible / Images API | JSON `/images/generations` | Text | Inline image data |
| OpenAI-compatible / Images API editing | Multipart `/images/edits` | Text and connected source images | Inline image data |
| OpenAI-compatible / Chat image output | Nonstream `/chat/completions` with image modalities | Text and optional images | Text and inline image data |
| ComfyUI / workflow | `/prompt`, own task `/history/{id}`, then same-server `/view` | API graph bindings, text and optional uploaded images | Private canvas image media |

These are distinct protocols. Model discovery, a model name or vision support does not establish support for every row. Use a provider/model that implements the chosen contract. The application does not retry a failed paid operation using another protocol automatically.

## OpenAI-compatible setup

Base URLs may use HTTP or HTTPS and retain existing prefixes such as `/v1`, `/api/v1` or `/inference`. An origin-only URL defaults to `/v1`. Do not include credentials, query strings or fragments in the URL. Choose Bearer authentication, encrypted custom headers or no authentication for a protected local server.

Connection testing requests `/models` with a ten-second timeout. Select discovered model IDs or enter them manually. Context capacity uses an explicit model override, then discovered metadata, then the endpoint fallback. Output-token limits are not substituted for context capacity. The application never asks a model to guess its capacity.

The default chat transport is Chat Completions. Select **Advanced settings → Chat API → Responses API** for servers implementing `/responses`. Responses requests disable provider-side response storage and translate the output limit to `max_output_tokens`. Unsupported settings such as Responses `seed` produce an explicit error. This release does not execute model-supplied functions or shell commands.

For Images API output, leave **Image response format** at Provider default for current GPT Image-style APIs, or explicitly request base64 for legacy-compatible APIs. Editing requires connected source images. The application validates and saves PNG/JPEG/WebP rasters and does not fetch arbitrary provider-returned image URLs. Model-specific features such as masks and every vendor extension are not advertised by this interface.

The implemented request shapes follow the [Responses streaming reference](https://developers.openai.com/api/reference/resources/responses/streaming-events) and [Images editing reference](https://developers.openai.com/api/reference/go/resources/images/methods/edit). Compatible servers may implement a subset.

## ComfyUI setup

Choose **ComfyUI workflow API** and the native server root or its reverse-proxy prefix, for example `http://comfyui:8188`. ComfyUI URLs do not receive an automatic `/v1` suffix. Test Connection checks `/system_stats`; it does not run a generation or infer a workflow from a model name.

Paste an exported **API-format graph**, containing `class_type` and `inputs` per node. A visual `nodes`/`links` editor export is a different format. The workflow is encrypted on the server, omitted from normal settings responses and preserved when its editor field is empty. Replace the configured graph explicitly to edit it, or use Remove stored workflow.

Bind workflow values as follows:

- `{{prompt}}`: the assembled graph context and node prompt; required somewhere in the graph.
- `{{seed}}`: an integer seed. The placeholder must occupy the whole value.
- `{{model}}`: the selected model/workflow alias, only if the template needs it.
- `{{image:0}}` through `{{image:3}}`: filenames of uploaded connected images. Each placeholder occupies the whole value; every input must have a matching binding.

Checkpoint/encoder/VAE names and the node graph must match the server installation. A model alias identifies this configured workflow; it is not automatic checkpoint discovery. Use separate providers for different graphs when needed. Text summarization is unavailable for ComfyUI endpoints, and an LLM context capacity does not apply.

Graphs are limited to 512 KiB, 500 nodes and bounded nesting. Workflow execution has a two-minute local deadline, with at most four output images, 20 MiB per raster and a 40 MiB output batch. Image dimensions and storage quotas are checked before persistence. The adapter reads only its submitted task's history and returns files from the configured server, with validated filenames. It never sends a global interrupt that might stop another user's work. A remotely queued job may continue after local cancellation or timeout.

ComfyUI workflows do not report LLM token billing: usage is **Not reported**. A zero placeholder is not a claim that inference was free. Generated images remain private Media records and can feed downstream nodes.

## Files, security and compatibility

Supported attachment types are raster images, CSV text and videos supported by the uploader. OpenAI-compatible text paths use extracted video frames; Gemini's built-in path can use video files. Raw PDF/Word extraction, audio/video generation, embeddings, arbitrary function execution and unrestricted vendor request JSON are outside this release's advertised matrix.

The installation owner may configure private gateway origins. Other accounts can use only origins explicitly allowed through `LLM_ALLOWED_PROVIDER_ORIGINS`. Provider redirects are refused. Allow only trusted servers: a configured ComfyUI graph executes on that external server and inherits its capabilities. Credentials and workflows are resolved from the current user's encrypted settings, never copied into canvas/debug output. Restore encrypted backups with the original installation secret, or re-enter the provider configuration.

Inside Docker, `localhost` refers to the application container. Put gateways on a shared network or use a reachable host address. A browser's ability to reach a server does not prove the application container can reach it. Keep unauthenticated inference servers on trusted networks.
