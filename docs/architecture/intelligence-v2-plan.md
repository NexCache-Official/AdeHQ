# Intelligence v2 — Lightning-Fast, Genuinely Smart AI Employees

## Implementation status (updated 2026-07-11)

| Phase | Status | Notes |
|---|---|---|
| 1 — Ambient context | ✅ Done | `ambient-context.ts` built + emitted at top of system prompt |
| 2 — Instant answers | ✅ Done | `instant-answers.ts` + `instant_answer` fast-path; 0 LLM tokens for date/time/math/workspace-facts |
| **3a — Deterministic orchestrator** | ✅ **Done (2026-07-11)** | DMs + @mentions were already deterministic. Channels: `classifyRoomMessageWithSteward` already tried a regex classifier first — the remaining gap (regex fallback / unranked task-question-opinion requests going straight to an LLM `generateObject` call) is now closed by an **embedding-based role match** (`employee-role-embeddings.ts`, ~100-700ms cosine similarity, cached per employee) inserted between the regex and LLM steward. Confirmed live: a legal-review question against a mixed roster correctly picked the legal specialist in ~1.6s with **zero LLM steward calls**. |
| 3b — Router as tool inside composer | ❌ Not started | `intelligence-router.ts` is still a serial pre-flight LLM call |
| 3c — Tiered prompts | ✅ Done (cache gap) | Core/Work/Full tiers live; stable-prefix prompt-cache ordering **not** done |
| 4 — Streaming + effects split | 🟡 Partial | SSE token streaming for conversational replies via `streamSiliconFlowText`; **only the poster sees live tokens (no Realtime `message_chunks`); no fire-and-forget effects post-pass** (work requests still block on `{reply,effects}` JSON) |
| **5a — Exa-first routing** | ✅ **Done + verified live (2026-07-11)** | Steward routes `company_fact`/`current_fact`/`news`/`market_research`/`source_verification` to Exa (`search-steward.ts::preferredFactProvider`). `EXA_API_KEY` is now configured — confirmed live: "What is Oracle's revenue in 2026?" went from **~20-30s (Tavily fallback)** to **4.26s total** (`searchLatencyMs: 1744`, `synthesisLatencyMs: 2197`) via `gateway_exa`/`exa`, 10 real cited sources, correct/richer answer. |
| 5a — Parallelize search w/ context load | ❌ Not started | Search still runs strictly after `retrieveFileContext` + `enrichIntelligenceContext` in `process-queued-run.ts` (enrich depends on file context, so needs a fast-path-first refactor to fire search concurrently) — would shave more off the remaining ~4s |
| 5b — Clickable citations | ✅ Done (minor gap) | `CitationChip` + expandable "+N more"; hover card is native `title` only, not a rich card. Confirmed rendering correctly with live Exa-sourced answers. |
| 5 — Per-workspace search budget | ❌ Not started | Only general daily token/cost caps in `cost-guard.ts`; no search-specific cents budget |
| 6 — Scale governors | 🟡 Partial | Cache-first blackboard ✅ (`search-cache` checked before every search); fan-out capped to 2; **`thinkingBudget` caps defined but not enforced**; no `consult_teammate` tool; no per-workspace max-concurrent/searches-per-hour |
| Instrumentation (ttft/wall) | 🟡 Partial | Per-layer `durationMs` captured; **no `ttft_ms`/`wall_ms`** |

**Side-effect fix (2026-07-11):** verifying 3a surfaced that the configured embedding model (`ADEHQ_EMBEDDING_MODEL`/`DEFAULT_EMBEDDING_MODEL` = `BAAI/bge-large-en-v1.5`) isn't in this SiliconFlow account's catalog and 404s every call — silently breaking file-search RAG (and the new embedding role-match) 100% of the time. Switched default to `Qwen/Qwen3-Embedding-0.6B` (confirmed available, same 1024 dims as the existing pgvector column).

**Original plan below.**

**Status:** Approved strategy, ready to engineer.
**Goal:** First visible token in **< 1.5s**, trivial questions answered in **< 3s** end-to-end, search answers in **< 8s**, with zero loss of the "coworker, not chatbot" feel — and an architecture that behaves identically with 1 AI employee or 100.

This document is written to be implemented directly. Each phase lists the exact files to touch, the contract changes, and the acceptance criteria.

---

## 0. Diagnosis — where 43 seconds actually went

Real production trace, message: *"Whats the date today?"* (7-word reply):

| Stage | Time | Why |
|---|---|---|
| `POST /messages` (orchestrator) | 4.2s | LLM intent call runs **before** the run is even queued; user sees nothing |
| Fast-path | ~0ms | Regex missed → `needs_router` (good design, bad coverage) |
| Router LLM (`intelligence-router.ts`) | 5.3s | A SiliconFlow `generateObject` call to decide something `new Date()` answers |
| Composer LLM | 20.3s | 5,134 input tokens (full role/collab/workflow prompt for a DM), **1,521 output tokens** of `{reply, effects}` JSON for "July 10, 2026. What's up?" |
| Process-route overhead | ~14s | Context reads, memory fetch, hold timers, sequential awaits |
| **Total** | **~43s** | User perceives dead air the entire time — nothing streams |

Five root causes, in order of impact:

1. **Nothing streams.** `streamText`/`streamObject` appear nowhere in the codebase. The full JSON envelope must finish generating before one character reaches the user.
2. **The `{reply, effects}` monolith.** Because reply and effects are one JSON object, the reply is held hostage by effects generation, JSON syntax overhead, and schema-repair retries. It also forbids token streaming (you can't stream half a JSON object to a chat bubble).
3. **Serial LLM chain.** Orchestrator → router → composer are three sequential network round-trips, each with cold-start and queueing. ChatGPT/Claude run classification either deterministically, in parallel with generation, or as tool-calls *inside* generation — never as a serial pre-flight of separate LLM calls.
4. **One-size-fits-all prompt.** A DM "hi" gets the same ~5k-token system prompt (sales workflow, collaboration etiquette, health-compliance rules, JSON schema) as a complex multi-agent task. Cost, latency, and dilution.
5. **No ambient world context.** No date, time, timezone, locale, workspace facts in the prompt — so the model can't answer "what's the date" without a lucky guess, and the pipeline burns a router call deciding how to find out.

---

## Phase 1 — Ambient Context Block (ship first, ~half a day)

**What ChatGPT does:** every conversation carries a lightweight system header — current date, user locale, capabilities. Zero latency; pure string interpolation.

**Build:** `src/lib/ai/ambient-context.ts`

```ts
export type AmbientContext = {
  nowIso: string;          // server time, ISO
  dateHuman: string;       // "Thursday, July 10, 2026"
  timeHuman: string;       // "4:32 PM"
  timezone: string;        // from workspace settings, fallback user profile, fallback UTC
  locale: string;
  workspaceName: string;
  userName: string;
  userRole?: string;
  businessContext?: string; // one-liner from workspace profile: industry, stage, HQ city
};

export function buildAmbientBlock(ctx: AmbientContext): string;
```

Rendered as a compact block **at the top** of the system prompt in `buildEmployeeSystemPrompt` ([src/lib/ai/prompts.ts](../src/lib/ai/prompts.ts)):

```
## Current context
Today is Thursday, July 10, 2026, 4:32 PM (America/New_York).
Workspace: NexCache (B2B SaaS, seed stage, New York). You're talking with Shubham Kumar (Founder).
Treat this as ground truth. Never say you don't know the current date or time.
```

- Timezone/location come from a new `workspace_settings` row (add columns: `timezone`, `locale`, `hq_location`) with a settings UI later; fall back to request headers (`x-vercel-ip-timezone` on Vercel) until then.
- Keep it under ~80 tokens. **Static text first, dynamic values last** doesn't apply here (it's tiny), but see Phase 3 for prompt-cache ordering of the big sections.

**Acceptance:** "what's the date/time/day" answers correctly from any employee with zero search/router involvement.

---

## Phase 2 — Instant Answers Layer (deterministic, 0 LLM calls)

Before any LLM runs, a synchronous resolver handles the class of questions a real coworker answers without thinking. Extend `classifyMessageFastPath` ([src/lib/ai/intelligence/classify-message-fast-path.ts](../src/lib/ai/intelligence/classify-message-fast-path.ts)) with a new decision `instant_answer` and add:

**Build:** `src/lib/ai/intelligence/instant-answers.ts`

- Date / time / day-of-week / "how many days until X" → computed from ambient context.
- Simple arithmetic and unit conversions.
- Workspace facts already in hand: "who's in this room", "what tasks are open", "what's this topic about" — answered from data already fetched for the prompt.

Instant answers still render **in the employee's voice**: pass the computed fact through a tiny template with the employee's tone ("July 10 — Thursday. What's up?"), not a robotic system message. Respect `minimumReplyHoldMs` from [adaptive-timing.ts](../src/lib/ai/intelligence/adaptive-timing.ts) so it feels like a person glancing at their watch (~600–900ms), not a bot.

**Important calibration:** the hold-timer philosophy inverts once streaming lands (Phase 4). Fast feels *human* when the reply streams word-by-word; artificial multi-second delays feel like lag, not humanity. Keep holds ≤ 900ms everywhere.

**Acceptance:** date/time/team/task questions round-trip in < 2s with `researchLevel: 0`, zero LLM tokens.

---

## Phase 3 — Kill the serial pre-flight; one brain with tools

This is the structural fix. Today: orchestrator LLM → fast-path → router LLM → composer LLM, serially. Target: **at most one LLM round-trip before generation begins**, usually zero.

### 3a. Orchestrator goes deterministic-first

The 4.2s spent inside `POST /messages` before queuing is pure perceived dead time. In DM rooms the answer is always "the assigned employee replies" — no LLM needed. In channels:

1. Explicit `@mention` → deterministic (regex), pick mentioned employee(s).
2. No mention, single AI employee in room → deterministic, they reply.
3. No mention, multiple employees → **embedding-based role match** (cosine similarity between message and employee role/skill embeddings, precomputed per employee) — ~50ms, no LLM.
4. Only genuinely ambiguous cases (rare) fall back to the LLM orchestrator — and even then, queue the run **optimistically for the top embedding match immediately** and let the LLM result cancel/redirect if it disagrees.

**Acceptance:** `POST /messages` p95 < 400ms for DMs and mention cases.

### 3b. Router becomes a tool decision inside the composer, not a pre-flight

Replace the separate `intelligence-router.ts` LLM call with **tool-calling on the composer model** for the ambiguous middle: give the employee model a `web_search` tool (and later `consult_teammate`, `browse`). The model decides mid-generation whether to search — that's how Claude and ChatGPT do it, and it makes the router's 5.3s disappear entirely for direct answers.

Keep the regex fast-path for the obvious ends (`obvious_search` skips straight to search; `greeting`/`instant_answer` skip the model or use the tiny prompt). The `needs_router` bucket routes to the composer-with-tools instead of a standalone router. `thinkingBudget` caps (`maxSearches`, etc.) become tool-use limits enforced in the tool executor — the budget concept survives, the extra round-trip doesn't.

### 3c. Tiered prompt assembly + prompt caching

Split `buildEmployeeSystemPrompt` into composable tiers, selected by fast-path decision:

| Tier | Contents | ~Tokens | Used for |
|---|---|---|---|
| **Core** | Ambient block, identity, voice, room, "reply like Slack" rules | ~600 | Greetings, instant answers, short DM chat |
| **Work** | Core + role workflow + effects/tool instructions | ~2,000 | Direct work requests |
| **Full** | Work + collaboration/panel rules + file rules + compliance | ~5,000 | Multi-agent, files, artifacts |

Order every tier **stable-prefix-first** (identity and rules before per-message context) so provider prompt caching hits: with Anthropic/DeepSeek prompt caching, the big static prefix costs near-zero after the first call. This alone cuts the 5,134 input tokens for a DM smalltalk turn to a few hundred effective tokens.

**Acceptance:** DM smalltalk composer calls use the Core tier; input tokens < 1,200; router LLM call count drops to ~0 in logs.

---

## Phase 4 — Streaming end-to-end + split reply from effects

The single biggest perceived-speed win. Two changes that must land together:

### 4a. Reply is plain streamed text; effects move out-of-band

Stop asking the model for `{reply, effects}` JSON. Instead:

- **Composer call:** `streamText` (AI SDK) with plain-prose output and **tools** for anything that must happen inline (`web_search`, and structured tools for `crm.createContact`, `email.createDraft`, etc. — tool calls ARE the effects for actions). The reply streams to the client token-by-token.
- **Effects harvest:** memory suggestions, work-log entries, task extraction — things that are *annotations about* the reply, not actions — move to a **fire-and-forget post-pass** on the cheap model after the reply is delivered (the `background-learning.ts` pattern already does exactly this for search memory; generalize it). Users never see effects in the bubble anyway, so nothing about them should block the bubble.

This kills: JSON syntax token overhead (a large slice of those 1,521 output tokens), schema-repair retries, `normalize-model-response.ts` complexity on the hot path, and the entire "wait for the whole object" delay.

### 4b. Transport: stream to the client

- Change `POST /api/agent-runs/[runId]/process` to return an SSE/streamed response (Vercel Fluid Compute handles long-lived streams fine; keep `maxDuration` generous), or persist token chunks to a `message_chunks` channel on Supabase Realtime so every room member sees the same live typing — the Realtime path is the right one for multi-user rooms since the poster's HTTP connection isn't the only viewer.
- Client (`RoomChat.tsx`): render the streaming bubble with the existing typing indicator morphing into real text. Status chips (`statusChipForIntelligence`) stay for the pre-first-token phase ("Checking current sources…"), then hand off to live text.

**Acceptance:** time-to-first-visible-token < 1.5s for direct replies; the "date" question shows text streaming within ~1s.

---

## Phase 5 — Search: Exa-first routing, real citations, honest voice

### 5a. Provider routing (Exa vs Gateway/Perplexity vs Tavily)

Exa is stronger at semantic/entity research; Perplexity-style gateway search is fine for headline facts; the +$0.002/request delta is noise next to a single composer call (~$0.0025). Route in `search-router.ts` by the already-computed `searchNeed`:

| Need | Provider | Why |
|---|---|---|
| `fast_fact` (score, price, date-stamped headline) | Gateway/Perplexity, cache-first | Cheapest, good enough, already synthesized |
| `company_fact`, entity/people/funding research | **Exa** (with `highlights` + `text`) | Better retrieval quality; we control synthesis |
| Deep research / multi-query sessions | **Exa** research sessions (already built in `research-session.ts`) | Purpose-built |
| Provider down / over budget | Fall through in that order, then Tavily | Resilience |

Add a per-workspace daily search budget (cents) enforced in `cost-guard.ts`; when exceeded, degrade to cache + training-data-with-caveat, never silence.

**Parallelize:** when fast-path says `obvious_search`, fire the search **concurrently with** context loading and prompt assembly, not after. The 9.4s search + 4s synthesis in the Apple trace should overlap the ~5s of setup that currently precedes it.

### 5b. Citations that are actually links

Current failure: synthesis emits plain-text `[5][6][7]`, the footer shows "+1 more" with no way to see it, and the voice leaks internals ("Based on the provided sources…").

**Contract change** — synthesis output becomes `{ text, sources }` where `text` contains inline markers `[n]` and `sources` is the ordered array `{ n, title, url, domain, publishedAt?, snippet? }`. Enforce in the synthesis prompt (`search-synthesis.ts`):

- Every factual claim carries `[n]` immediately after the claim.
- Never renumber; `n` indexes into the sources array.
- **Voice rules:** answer as a coworker sharing what they found. Banned openers: "Based on the provided sources", "According to the search results". If data is partial, say it naturally: "FY2026 isn't closed yet — the first two quarters came in at…"

**Renderer** (`RoomMessageItem.tsx` + the markdown renderer):

- Regex-map `[n]` in message text → superscript citation chip, hyperlinked to `sources[n].url`, hover card with title/domain/date/snippet.
- Sources footer: favicon + domain + title, each a real `<a target="_blank">`; "+N more" expands in place (accordion), never hides content with no affordance.
- Store `sources` in the existing `web_sources` artifact payload so history renders identically.

**Acceptance:** every `[n]` in a search answer is clickable; expanding "+N more" shows all sources; no "provided sources" phrasing in 20 sampled answers.

---

## Phase 6 — Scale: 1→100 employees without O(N) chaos

Principles (this is how you keep 100 agents from feeling like a spam channel):

1. **Deterministic-first orchestration** (Phase 3a) scales O(1)-ish: embeddings + mention parsing don't care if the roster is 3 or 300.
2. **One lead, consult-on-demand.** Default every request to a single lead employee. Other employees join only via (a) explicit @mention, (b) the lead's `consult_teammate` tool call, or (c) an offer chip the human clicks. Kill broadcast/stagger patterns for anything but explicitly requested panels.
3. **Shared workspace blackboard.** Search results, memory writes, and topic summaries go to workspace-scoped stores (`search-cache.ts`, `topic-search-coordination.ts` already exist — make them the mandatory path) so employee #2 never re-searches what #1 found in the same topic. Cache key: normalized query + topic + freshness window.
4. **Concurrency + budget governors.** Per-workspace caps: max concurrent runs, max searches/hour, max collaboration fan-out per message (the `thinkingBudget` fields already model this — enforce them centrally in the tool executor, not per-call-site).
5. **Work-hours accounting stays honest.** Every run already writes usage; surface "AI hours saved" per employee per week so the reduce-work-hours story is measurable, not vibes.

---

## Rollout order & measurement

| Order | Phase | Effort | Expected effect on the "date" trace |
|---|---|---|---|
| 1 | Ambient context | 0.5d | Correct date knowledge everywhere |
| 2 | Instant answers | 1d | 43s → **< 2s** for that class |
| 3 | Deterministic orchestrator + tiered prompts + tool-routing | 3–4d | Removes 4.2s + 5.3s; composer input 5k → <1.2k |
| 4 | Streaming + effects split | 3–4d | Perceived wait 20s → **< 1.5s** to first token |
| 5 | Exa routing + citations | 2–3d | Search answers ~14s → ~6–8s, links clickable |
| 6 | Scale governors | 2d | Safe at high employee counts |

**Instrument from day one:** the `intelligence.steps[]` timeline already captures per-layer `durationMs` — add `ttft_ms` (first token) and `wall_ms` (send → first visible text) to every run, log p50/p95, and set SLO alerts: TTFT p95 < 2s, direct-reply wall p95 < 4s, search wall p95 < 9s. Every phase must show its number moving before the next ships.

**Non-goals:** no artificial "thinking" delays beyond 900ms; no per-message multi-agent debates by default; no second synthesis model when the composer can cite directly from tool results.
