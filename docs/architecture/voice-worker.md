# CPU voice worker foundation (PR-18.2C/D)

## Status

The worker now has authenticated start/status/interrupt/stop endpoints, session
lifecycle management, concrete xAI streaming STT, xAI/Fish streaming-response TTS,
a Cloudflare Calls API client, and matching protected Brain turn/cancel routes.
Production traffic remains on Vercel WebSockets. No Fly app was deployed and no
ONNX weights are bundled.

## Runtime shape

```text
Cloudflare Realtime SFU
  ↕ SfuMediaAdapter
CPU Node voice worker
  ├─ typed frame pipeline + interrupt/cancel lifecycle
  ├─ local turn detector boundary (Silero VAD + Smart Turn ONNX)
  ├─ VoiceInferenceProvider (managed API or external GPU endpoint)
  └─ BrainApiClient
       ↕ signed ephemeral worker token
AdeHQ Brain API
```

The worker is CPU-only. TTS and STT inference stays behind
`VoiceInferenceProvider`; a Fly machine never assumes local GPU access. This lets
managed services and dedicated GPU endpoints be changed independently of call
orchestration.

Pipecat informs the frame model, but is not installed. Its runtime is Python-first,
so pretending it is a Node dependency would create an invalid architecture.
`services/voice-worker/src/contracts.ts` implements only the frame concepts AdeHQ
needs.

## Authentication

The app token utility can mint a short-lived worker token after an authenticated
session route authorizes the workspace participant and call. The implemented
token envelope is HS256 with:

- issuer `adehq-app` and audience `adehq-voice-worker`;
- subject, workspace ID, call ID, nonce, issue/expiry times;
- explicit `sfu:connect`, `sfu:publish`, `sfu:subscribe`, and `brain:turn` scopes;
- a maximum five-minute lifetime.

The worker verifies signature, audience, expiry, and required scopes. The signing
secret is server-only and injected at runtime. A production issuer/verifier should
also consume nonces (or use a central one-time token exchange) to prevent replay.
Provider credentials are separate worker secrets and are never carried in the
ephemeral token or sent to browsers.

Before fewer than 60 seconds remain, `HttpBrainApiClient` exchanges the still-valid
token at the protected refresh route. The app rechecks the durable active call and
identity before issuing another five-minute token; token lifetime is never
extended without reauthorization.

The Brain routes additionally query the durable `calls` row and require the token
workspace, call, and subject to match the active call and initiating user. The
request body cannot override token identity.

## Turn detection

`LocalOnnxTurnDetector` accepts injected CPU model sessions for Silero VAD and
Smart Turn. Model files and an ONNX runtime are intentionally absent. Until a
loader is configured, readiness/status must say the models are unavailable. PCM16
input then uses a basic energy VAD and silence timeout; it does not claim semantic
turn detection. Unsupported compressed frames do not produce a fabricated result.

## Transport flag and rollout

The planned server-side selector is:

```bash
ADEHQ_LIVE_CALLS_TRANSPORT=vercel_ws
# opt-in after integration:
ADEHQ_LIVE_CALLS_TRANSPORT=cloudflare_worker
```

`vercel_ws` remains the production default. The live-session route now resolves
the flag server-side and probes worker readiness when `cloudflare_worker` is
requested. Missing configuration, an unreachable/unready worker, or the absent
browser SFU event bridge all explicitly fall back to `vercel_ws`; the response
reports the requested/selected transport and fallback reason.

Worker process readiness is stricter than configuration presence:

- xAI STT and the selected xAI/Fish TTS must be configured;
- the Brain base URL and Cloudflare Calls API credentials must be configured;
- an injected `CloudflarePeerTransport` must report usable.

The default process has no native peer transport, so `/readyz` is 503 and
`cutoverReady` is false even with credentials. Cloudflare's Calls API exchanges
SDP and track requests but cannot itself decode or inject media. Production
cutover remains blocked on either a tested Node native `RTCPeerConnection`
implementation or an external media bridge, plus browser publication and worker
event delivery. The flag cannot silently create a media-less call.

## Benchmark

The repeatable PR-18.2D protocol, candidate matrix, endpoint contract, cost
inputs, and blind-test workflow live in
[`voice-benchmark.md`](./voice-benchmark.md).

Run the offline registry check:

```bash
npm run benchmark:voice-worker -- --list
```

Run configured candidates using `.env.local`:

```bash
npm run benchmark:voice-worker
```

Missing endpoints, keys, voice IDs, fixture audio, and cost rates remain explicit
in output; the harness does not invent scores. Set
`VOICE_BENCHMARK_FULL_MATRIX=1` to perform new STT and TTS requests for every
configured pair. This can incur provider charges.
