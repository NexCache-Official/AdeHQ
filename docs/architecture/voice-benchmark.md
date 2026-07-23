# Whole-pipeline voice benchmark (PR-18.2D)

## Purpose

This harness compares the path AdeHQ would actually ship, not provider marketing
latency. It starts timing before the request is built, consumes complete
responses, and records:

- input audio ready → final STT phrase ready;
- phrase ready → response headers, first bytes, first decodable audio,
  playback-ready (`decodable + configured device buffer`), and completion;
- input audio ready → playback-ready and completion for every configured STT/TTS
  pair when the full matrix is enabled;
- complete output bytes, throughput at configured concurrency, cost inputs, and
  blind quality-test artifacts.

Playback-ready is a reproducible client-side estimate, not a claim that a
physical speaker emitted sound. Provider SDK initialization, DNS/TLS state, and
network location are part of the process under test; record machine/region notes
alongside any result used for a decision.

## Candidate matrix

Managed TTS: xAI, Fish Audio S2.1 Pro, Cartesia Sonic 3.5, and ElevenLabs Flash
2.5. Self-hosted TTS endpoints: Fish Audio S2, Qwen3-TTS, CosyVoice 2, and
Kokoro. STT: xAI, Deepgram Flux, Moonshine v2, whisper.cpp, and faster-whisper.

The harness uses direct HTTP where the provider supports the request contract.
Streaming-only APIs and self-hosted processes can be placed behind a thin
benchmark endpoint with the same contract:

- STT: multipart `file` + `model` (Deepgram receives raw audio), returning
  `{ "text": "..." }`, `{ "transcript": "..." }`, or Deepgram's channel shape.
- TTS: JSON `{ text, model, stream, format, sample_rate_hz }`, returning a
  streamed PCM16, WAV, MP3, or Ogg Opus body.

Do not silently translate a different model into a listed candidate. If, for
example, the endpoint cannot run Flux or Moonshine v2, leave that candidate
unconfigured so the report says `skipped`.

## Deterministic run

The checked-in fixture suite contains fixed en-US, en-GB, es-ES, and fr-FR
phrases. Record each phrase once as a clean WAV and configure its matching
`VOICE_BENCHMARK_AUDIO_*` path. Do not replace fixture text between candidates.

```bash
# Registry and exact fixture text; no network or credentials
npm run benchmark:voice-worker -- --list

# Contract: every provider absent, every row explicitly skipped
npm run test:voice-benchmark

# Components at concurrency 4, three repetitions
VOICE_BENCHMARK_CONCURRENCY=4 VOICE_BENCHMARK_REPETITIONS=3 \
  npm run benchmark:voice-worker

# Real STT → TTS pair invocations; this can incur provider charges
VOICE_BENCHMARK_FULL_MATRIX=1 npm run benchmark:voice-worker
```

Output defaults to ignored `artifacts/voice-benchmark/` and contains
`report.json`, flat `report.csv`, `blind-test.json`, and complete audio files.
Use `--output-dir <path>` to retain named runs. Audio filenames are blind IDs;
the provider key remains in `report.json`. Score the blind sheet before opening
that report.

## Cost and concurrency

No prices are hard-coded. Configure the candidate-specific
`VOICE_BENCHMARK_*_USD_PER_MILLION_CHARACTERS` or
`VOICE_BENCHMARK_*_USD_PER_AUDIO_HOUR` variable shown by `--list`. Without a
rate, `costUsd` is `null` and `costBasis` states exactly which variable is
missing. Self-hosted rates should be measured amortized endpoint cost, including
idle capacity, rather than a guessed cloud-list price.

Concurrency is a bounded client worker pool. Reports preserve each request's
slot and include aggregate successful requests/second. Compare p50/p95 from the
CSV and inspect failures/throttling; a single warm request is not a capacity
result.

## Decision gate and roadmap

1. Run the no-credentials contract and typecheck in CI.
2. Run ≥3 repetitions at concurrency 1, 4, and the expected workspace peak from
   the same region as the voice worker.
3. Complete blind scoring with at least three listeners and retain raw sheets.
4. Reject candidates with fabricated/missing model identity, incomplete bodies,
   unacceptable multilingual quality, or unstable tail latency.
5. Only after a winner passes should its adapter be integrated into production.

The repository does not include provider credentials, model weights, fixture
recordings, or benchmark scores. Consequently PR-18.2D provides a repeatable
measurement system, not a declared winner.
