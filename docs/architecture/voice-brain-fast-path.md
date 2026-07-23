# Voice Brain Fast Path (PR-18.2A5–A10)

TTS is no longer the live-call bottleneck. AdeHQ splits spoken turns into three
lanes so ordinary conversation does not traverse the full workforce Brain.

## Lanes

| Route | When | Target |
|-------|------|--------|
| `local_instant` | Greetings, thanks, stop/repeat/shorter/continue, presence | Decision &lt;20 ms; audio &lt;250 ms with cache |
| `voice_fast` | Ordinary questions/advice with hot session snapshot | Prep &lt;100 ms; provider TTFT &lt;600 ms p50; first audio &lt;1.4 s |
| `work_full` | Research, CRM/tools, artifacts, approvals | Cached bridge &lt;300 ms, then full governed Brain |

## Hot path components

- `voice-latency-trace.ts` — waterfall marks (prep vs provider TTFT)
- `voice-session-snapshot.ts` — built at call connect, updated per turn
- `voice-brain-router.ts` — deterministic &lt;20 ms router (no model classifier)
- `voice-fast-brain.ts` — compact prompt, no tools/thinking/structured output, ≤120 tokens
- `async-effect-compiler.ts` — post-speech suggestions only
- `voice-prefetch.ts` — interim STT routing/prefetch (no premature LLM)

## TTS policy (unchanged)

- **Standard:** xAI
- **Economy/fallback:** SiliconFlow CosyVoice
- **Premium:** xAI behind premium flag (Cartesia stays benchmark-only)

## Voice gender + intelligent fillers

- `genderMode: auto | female | male` — Auto infers from the employee first name
  (Priya → female / Eve·Ara; David → male / Leo·Rex·Sal). Tone/pace stay separate.
- Progressive fillers (`intelligent-fillers.ts`) speak short thinking/searching
  beats while Brain/tools run, then stop when the first real answer phrase is ready.

## Benchmark

```bash
npm run benchmark:voice-brain
npm run test:voice-brain-fast-path
```

Rank providers by injected-text → first useful content token on the lean session
prompt, not total completion time.
