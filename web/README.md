# X2Streaming-TTS Demo

A bilingual project website using the existing moon-holding beaver, real engine
recordings, a downloadable quick start, and the Qwen3TTS-Streaming browser implementation.

## Run locally

Requires Node.js 22.12+ and npm. From this directory:

```bash
npm ci
npm run dev -- --port 4173
```

Open `http://127.0.0.1:4173/`. The recorded demo works without an engine.
No model inference runs in the browser or on the preview host.

## Live synthesis

Start the matching engine with the [quick-start script](../docs/quickstart.md).
It downloads the official weights, builds the runtime and prints a verified address.

Select **Live playground**, enter the complete engine WebSocket address, and
connect. The page first discovers `/v1/capabilities`, then opens the advertised
Realtime WebSocket when synthesis starts. This requires the matching
Qwen3TTS-Streaming Realtime protocol and its Qwen extensions; an arbitrary
WebSocket service is not sufficient.

The supported path is CustomVoice with PCM16 mono audio, complete or incremental
text input, disabled output VAD, and guarded delivery. Voices and input modes
come from engine capabilities. NativeCursor highlighting requires a runtime
that emits NativeCursor progress events. Other progress is labeled as engine
progress. The two-character input schedule demonstrates incremental text arrival;
it is not connected to an LLM.

The address remains in component memory and is cleared when the live panel is
closed. It is not saved in browser storage or embedded in the build. Endpoints
with credentials or query parameters are not accepted. Use an authenticated
gateway if your deployment needs access control.

An HTTPS website needs an HTTPS/WSS engine. The engine must allow the site's
origin for the capabilities request and WebSocket handshake. GitHub Pages
serves only the static website and does not host the inference engine.

For local development behind the optional Vite proxy:

```bash
X2_DEMO_ENGINE=http://127.0.0.1:8000 npm run dev -- --port 4173
```

Enter `ws://127.0.0.1:4173/engine/v1/realtime` in the page. Replace the environment
variable with your actual engine's HTTP origin. The proxy destination stays on
the development server and is never bundled. A published site needs its own
engine endpoint or separately configured reverse proxy.

The live view supports pause/resume, interruption, WAV export and replay.
Highlighting uses server-provided text anchors at the actual playback clock.
Dialogue history after interruption uses conservative integer raw-text
boundaries, never display interpolation or a character/audio-duration ratio.
Reported client first-audio timing includes transport and request preparation;
server TTFT is shown separately only when the server provides it.

## Build and publish

```bash
npm test
npm run build
```

The standalone artifact is `packages/demo/dist/`. Relative asset URLs support
hosting beneath a repository path. The build also includes full dependency
license notices.

The repository includes a **Demo Pages** workflow that runs on website changes to `main`, or manually. After
pushing to GitHub, select **Settings → Pages → GitHub Actions**, then use a website push or
**Actions → Demo Pages → Run workflow** from `main`. The same `dist/` can be served by another static host.

## Frontend verification without a GPU

```bash
npm run test:server
```

This optional local protocol fixture listens at
`ws://127.0.0.1:4174/v1/realtime`. It advertises **TEST TONE — not a TTS model** and
emits a quiet tone with deterministic anchors. Use it only to check transport,
playback, cancellation and export. It is not imported by the website, cannot
measure model quality or latency, and is not a replacement for engine validation.

Unit tests cover SDK contracts, PCM playback, WAV encoding, reverse-proxy URL
resolution, and playback-aware interruption boundaries. Actual engine quality
and NativeCursor accuracy require separate inference validation.

## Sources

- Browser SDK and playback components: Qwen3TTS-Streaming `dev`, commit
  `9a4658498a24009f35495468ccabb6b1f10ea78a`.
- Imported files: `packages/browser-sdk/` and `packages/demo/src/upstream/`.
  `upstream-source.json` records source hashes, the test-fixture relocation and whitespace cleanup.
- Original mascot, figures, and recordings: `../docs/assets/`.
- Layout references: the official [F5-TTS demo](https://swivid.github.io/F5-TTS/)
  and [MaskGCT demo](https://maskgct.github.io/). Their media, text and source code
  are not included.
- License and attribution: [NOTICE](NOTICE), [MIT License](../LICENSE), and
  [third-party components](../THIRD_PARTY.md).
