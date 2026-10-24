These six small public synthetic clips contain only FFmpeg's `testsrc2` pattern:
128×96, 4 fps, one second, no audio. No recordings, external images, user data
or credentials are used. Total video payload: 46,959 bytes.

Run from a checkout with its existing dependencies, using native host Node 22:

```sh
node desktop/video-smoke.cjs /absolute/path/to/media-tools
node desktop/video-smoke.cjs /absolute/path/to/media-tools /absolute/path/to/fixtures
VIDEO_SMOKE_MEDIA_ROOT=/absolute/path/to/media-tools node --test tests/videoSmoke.test.js
```

On PowerShell, set `$env:VIDEO_SMOKE_MEDIA_ROOT` before running the test command.
The media root must contain the controlled FFmpeg 9 pair in `bin/ffmpeg` and
`bin/ffprobe` (`.exe` on Windows). Both must have the same version/configuration,
with GPL/version3/nonfree/autodetection disabled and dav1d/zlib enabled. Either
the native build output or the packaged `server/media-tools` directory works.
The caller builds/provisions the tools separately; this runner never installs
or builds anything. No display, application profile, provider or database is used.

The script loads the checkout's real `src/lib/videoUtils.ts` through the existing
`tests/loadSource.js` TypeScript loader, without overrides or mocks. It requires
checkout dependencies and is a development/release tool, not an ASAR entrypoint.
It overrides both media executable paths, checks sample hashes and exact FFprobe
metadata, then invokes the real metadata, thumbnail and frame functions. The
application's defaults produce a 1024×768 JPEG thumbnail and one 1024×768 JPEG
frame at timestamp 0 for each clip. JPEG markers, dimensions, MJPEG codec,
pixel format, MIME type, size, filenames and returned frame metadata are checked.
One JSON report goes to stdout; failures exit nonzero with a bounded phase/code,
without raw native stderr. Generated images live only in a fresh temporary
directory removed on success or failure; inputs and neighboring files are kept.
The report records fixture/tool/source hashes and cleanup evidence. Tool hashes
identify the exercised executables; release inventory verification remains the
caller's responsibility. Integration tests skip unless `VIDEO_SMOKE_MEDIA_ROOT`
is set; fixture integrity and CLI failure tests always run.

`manifest.json` records SHA-256, exact expected metadata, generator/source
version and each full argv command (run from the repository root). Generation
used only the already installed `node_modules/ffmpeg-static/ffmpeg` 7.0.2 and
the recorded `JOBS=1`, `OMP_NUM_THREADS=1` environment. Commands explicitly limit
codec/filter threads to one; x265 also uses `pools=1:frame-threads=1`. Run commands
sequentially. MP4/MOV use libx264, HEVC uses libx265, VP8/VP9 use libvpx and AV1
uses libaom. These GPL-enabled generation tools are not redistributed. The
controlled runtime only decodes these formats and encodes JPEG using FFmpeg's
native MJPEG encoder, so it needs no GPL video encoders. Container-generated
identifiers may change when regenerating; recompute manifest sizes/hashes after
an intentional regeneration. Never regenerate as part of the smoke itself.
