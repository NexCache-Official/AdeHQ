# AdeHQ voice worker

CPU-only Node.js/TypeScript orchestration foundation for live AI calls. It is
intentionally separate from the Next.js process and contains no model weights or
GPU runtime.

## Local commands

```bash
npm install
npm run typecheck
npm test
npm start
```

`GET /healthz` is process liveness. `GET /readyz` reports provider, Brain,
Cloudflare Calls API, and peer-media capabilities separately. It returns 503
until every capability is usable. Do not put values in `fly.toml`; inject them as
Fly secrets if this service is deployed.

Required runtime variables:

```bash
ADEHQ_BRAIN_API_BASE_URL=
ADEHQ_WORKER_TOKEN_SECRET= # random, at least 32 bytes
CLOUDFLARE_REALTIME_APP_ID=
CLOUDFLARE_REALTIME_API_TOKEN=
XAI_API_KEY=
# xai (default) or fish:
ADEHQ_LIVE_TTS_STANDARD_PROVIDER=xai
# Required when the provider is fish:
FISH_AUDIO_API_KEY=
```

`fly.toml` and `Dockerfile` are deployment definitions only. They describe one
shared CPU and do not deploy anything.

## Boundaries

- `XaiStreamingSttProvider` is a concrete xAI WebSocket STT implementation.
  `XaiStreamingTtsProvider` and `FishStreamingTtsProvider` stream HTTP response
  audio behind the provider-neutral `VoiceInferenceProvider`.
- `SfuMediaAdapter` isolates Cloudflare Realtime session and track mechanics.
  `CloudflareRealtimeSfuAdapter` requires an injected WebRTC/signaling
  implementation; Node does not provide `RTCPeerConnection`.
- `BrainApiClient` calls protected AdeHQ Brain turn/cancel routes with the
  ephemeral worker token.
- `LocalOnnxTurnDetector` accepts injected Silero VAD and Smart Turn CPU model
  sessions. No weights or ONNX runtime are bundled. If either model is absent,
  detector status reports `unavailable`; turn completion falls back to an energy-VAD
  silence timeout.

The frame pipeline takes inspiration from Pipecat's frame-oriented lifecycle,
but does not depend on or claim to run Pipecat. Pipecat is Python-first and is not
a suitable in-process dependency for this Node worker. The local contract is
deliberately narrow: audio, transcript, turn, interrupt/cancel, end, and error
frames.

## Session API

- `POST /v1/sessions` starts and owns an orchestrator session.
- `GET /v1/sessions/{callId}` reads its state.
- `POST /v1/sessions/{callId}/interrupt` cancels active Brain/TTS work.
- `DELETE /v1/sessions/{callId}` stops media and removes the session.

Every session endpoint requires a scoped five-minute bearer token. Start also
requires an existing Cloudflare `{sessionId, trackName}` input track.

This is usable with an injected `CloudflarePeerTransport`, but is not a production
media cutover. Cloudflare's Calls API only performs signaling; Node has no native
`RTCPeerConnection`. The default runtime installs
`UnavailableCloudflarePeerTransport`, therefore `/readyz` returns 503 and
`cutoverReady: false`. A native WebRTC implementation or external media bridge,
plus browser SFU publication/event bridging, remains required.
