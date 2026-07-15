# AI Workforce Live Test Report — Real Estate Negotiation Scenario

**Status: IN PROGRESS — this file is updated incrementally as each test runs, so partial results survive if the session is interrupted.**

## Test setup
- Persona: CEO of a small real-estate investment/brokerage business, working with two AI employees as a workforce (not just chatbots) — delegating real business judgment calls.
- Scenario: negotiating a commercial property deal with a difficult client/counterparty, plus general strategy asks.
- Environments tested: (1) Direct Message with a single AI employee, (2) shared Room with multiple AI employees.
- Measured per message: wall-clock time from send to fully-rendered reply, and a quality judgment (relevance, actionability, business judgment, tone as a coworker not a bot).
- Account: shubhamzinbox@gmail.com / TestSpace workspace, employees Elena Rossi and David Kim (+ Maya, Sofia York available).

## Log

### Test 1 — DM with Elena Rossi (Product Manager role, used here as "deal strategist" employee)

**Prompt (CEO voice):**
> "Elena, I'm meeting with the seller's broker tomorrow on the 40-unit Riverside Commons deal — they're asking $8.2M, I want to land at $7.3M. They know we're motivated because our 1031 exchange deadline is in 3 weeks. What's our strongest negotiating angle here, and how do I not tip our hand on the timeline pressure?"

**Reply:**
> "Your strongest angle is the 1031 exchange deadline — frame it as a 'time-sensitive opportunity' rather than explicitly stating the 3-week window. Emphasize your financial flexibility by offering a $7.3M proposal with a 10% buffer ($810k) to show you're not desperate. Also, highlight the property's unique value (e.g., 'prime location', 'high demand') to justify the lower offer. @Priya Nair can help draft a value proposition deck if you need visual assets for the negotiation. Let me know if you want to refine this further."

**Timing:** Server-side model call alone took **82.2s** (`durationMs: 82248`, provider `siliconflow`, model **`Qwen/Qwen3-8B`** — a fallback model, NOT the employee's fast primary DeepSeek-V4-Flash). Total wall time from send to rendered reply was **~2 minutes** of dead air (no streaming for this class of message). Input tokens 4563, output 832, cost $0.0031.

**Quality assessment:**
- ✅ Directly answers both parts of the ask (negotiating angle + not tipping hand on timeline).
- ✅ Concrete, usable tactic ("time-sensitive opportunity" framing instead of stating the exact deadline).
- ✅ Acted like a workforce, not a chatbot: proactively @mentioned a teammate (Priya Nair) to pull in help on a deliverable (value prop deck) — this is the coworker-delegation behavior we want.
- ⚠️ Numeric inconsistency: "$7.3M proposal with a 10% buffer ($810k)" — 10% of $7.3M is $730k, and 10% of $8.1M is ~$810k, so the number doesn't cleanly reconcile with the stated logic. For a CEO making real financial decisions, an unexplained/slightly-wrong number in a negotiating brief is a real trust problem — this needs tightening, an AI advising on live deal numbers must show its arithmetic or not invent numbers that don't check out.
- ⚠️ **82 seconds for the model call is too slow for a "meeting tomorrow" urgency scenario**, and the fallback to a smaller/cheaper model (Qwen3-8B instead of the primary model) suggests either the primary model was overloaded/erroring, or the routing logic is being conservative. This is the single biggest gap versus "instant coworker" framing.

---

## CRITICAL FINDINGS (testing paused to fix before continuing)

Two serious issues surfaced from Test 1. Both are now FIXED in code (not yet re-tested live — awaiting go-ahead).

### Bug A — AI employee invented a teammate who does not exist ("@Priya Nair")
**Symptom:** Elena @mentioned "@Priya Nair", who is not in this workspace at all.
**Root cause (confirmed, NOT a data leak):** The system prompt in `src/lib/ai/prompts.ts` hard-coded fake example names — `"@Priya Nair can you own…"`, `"Priya's research will inform…"`, `"employeeName": "Priya"`, plus `"Neil"` / `"Green Cutting Inc."` in the JSON schema examples. The model simply copied an example name into its reply. There is no cross-workspace access — `extractMentions()` in `queue-follow-up-runs.ts` only matches names against the *actual* room roster, so "Priya Nair" resolved to nobody (no phantom run was triggered). But it reads as a hallucinated/leaked colleague, which destroys trust.
**Why it mattered structurally:** the system prompt never told the model WHO is actually in the conversation — the real roster was only in the user prompt. So the model had example names but no ground-truth roster to constrain itself.
**Fix applied:**
- Added a `buildTeamRoster(ctx)` block to the **system prompt** that lists the real AI teammates (name + role) and people actually in this conversation, with strict rules: "ONLY @mention someone in this list; NEVER invent a teammate or reference anyone from another workspace; in a 1:1 DM there are no teammates to loop in."
- Replaced every fake example name with generic placeholders (`@[teammate name]`, `<contact name>`, `<company name>`, "the lead").
- Updated mention etiquette to explicitly say only roster names are valid.

### Bug B — Far too slow (82s), and using a fallback model instead of the fast one
**Root cause:** This class of message (a substantive strategy question) is `structured_chat`, which was NOT covered by Phase 4 streaming (only greetings/acks were). So it went through the blocking, structured-JSON path, which: (1) asks the model for the whole `{reply, effects}` JSON envelope (slow, extra tokens), and (2) runs a model-fallback loop — DeepSeek-V4-Flash apparently timed out on the larger request and fell through to the slow **Qwen/Qwen3-8B** (~10 tok/s). On top of that, the message classified as `needs_router`, adding a separate ~5s router LLM round-trip before the composer even started.
**Fixes applied (this is the "make Phase 0–4 actually felt" work):**
1. **Broadened streaming (Phase 4) from `quick_reply` → all conversational replies** (`structured_chat`) in `employee-queued-runtime.ts`. Strategy/advice/Q&A now stream token-by-token as plain prose via `streamText` on the fast model directly (DeepSeek-V4-Flash, no JSON envelope, no fallback loop). Artifact drafts and explicit tool-work (CRM/email/task/calendar creation, detected by `messageLikelyNeedsStructuredEffects`) stay on the structured path so nothing is dropped. @mentions in the streamed prose still trigger teammate follow-ups, and the topic-summary refresh still captures learnings — so delegation + memory survive without the JSON envelope.
2. **Skip the router LLM for advice/strategy questions.** Added an `ADVICE` pattern to `classify-message-fast-path.ts` so "how do I…/what's our…/walk me through/should we…" route straight to `direct` (no ~5s router round-trip), since they need the employee's judgment, not a web lookup. Public-fact questions still route to search (the search checks run first).
3. **Refined the plain-prose contract** so streamed replies still give real depth on substantive questions (headings/bullets/numbers when warranted), not terse one-liners.

**Expected effect:** the negotiation-style question should now (a) start showing tokens within ~1–2s instead of ~2 minutes of dead air, (b) use the fast primary model instead of falling back to Qwen, and (c) skip the router round-trip.

### Phase 0–4 application audit (after fixes)
- Phase 1 (ambient context: date/time/workspace at top of every prompt) — ✅ applied (`buildAmbientBlock` rendered at prompt top).
- Phase 2 (instant answers: date/time/team/task, 0 LLM calls) — ✅ applied.
- Phase 3a (deterministic orchestrator / room-steward) — ✅ applied for single/strong-match; full embedding routing is future.
- Phase 3b (router-as-tool instead of a pre-flight LLM) — ⚠️ partial: the standalone router LLM still exists, but advice/strategy/greeting/obvious-search now bypass it, so it fires far less often.
- Phase 3c (tiered prompts core/work/full) — ✅ applied; conversational questions get the leaner "work"/"core" tier, not the 5k "full" tier.
- Phase 4 (streaming + reply/effects split) — ✅ NOW applied to all conversational replies (was greetings-only). This is the main change that should make the speed *felt*.

### Status
Fixes are code-complete and typecheck clean (`npx tsc --noEmit` passes). Re-testing live now, per go-ahead. Using SiliconFlow as the live provider throughout (`mode: "live"`, provider `siliconflow`).

---

## Re-test round (after Bug A/B fixes)

### Test 2 — DM with Elena Rossi, same negotiation thread, follow-up math question

**Prompt:** "Good, but walk me through the actual math — if I open at $7.3M and they counter at $7.9M, what's my ideal next move, and what's the walk-away price where I should be willing to lose the deal instead of blowing past my return targets?"

**Result:** Run completed in **35,968ms** (`durationMs` from server logs) — down from 82,248ms in Test 1, but still far from the target (<3s for a conversational reply). Investigated why, and found a **new bug (Bug C)**, root-caused and fixed live (see below) — so this specific run's poor-quality outcome is explained and corrected, not just timed.

**What actually happened:** despite the ADVICE fast-path change correctly classifying this as `direct` (no search needed — it's a continuation of the same deal, using the CEO's own numbers), the reply still triggered a **web search** and came back with irrelevant generic sources (amerisave.com, listwithclever.com, opendoor.com, huntergalloway.com.au — mortgage/listing sites, not deal-specific), and the reply **cut off mid-sentence** ("...if the seller won").

### Bug C — a second, independent routing path can override the correct "no search" decision
**Root cause (found and fixed):** `shouldSkipLegacyResearchPlanner()` in `research-plan-from-intelligence.ts` only skipped the legacy per-DM search classifier for `obvious_search` / `obvious_browser_research` / `instant_answer` / high-confidence-router outcomes. It did **not** include `direct` or `clarify` — even though `researchPlanFromIntelligence()` itself always deterministically returns `null` (no search) for those two decisions (no router ever runs for them). So when my Bug B fix correctly classified this message as `direct`, the code still fell through to a **second, independent legacy DM-steward classifier** (`classifyDmMessageWithSteward`), which made its own separate (and here, wrong) decision to search — silently overriding the correct decision upstream.
**Why the reply was truncated:** because it wrongly went down the search path, the reply was generated by the **search-synthesis pipeline**, which has its own smaller output-token cap tuned for short cited fact-answers — not the deep negotiation reasoning this question needed. That cap, not my streaming changes, cut the answer off mid-sentence.
**Fix applied:** added `direct` and `clarify` to `shouldSkipLegacyResearchPlanner`'s skip conditions, since those are exactly the decisions the intelligence layer already resolves to "no search" — the legacy classifier must not be allowed to contradict that. Confirmed safe: explicit UI toggles (Research mode, Browse/Agent mode) still short-circuit to `obvious_search` / `obvious_browser_research` *before* reaching the ADVICE check, so explicit user intent to search is unaffected.
**Verified:** `npx tsc --noEmit` clean, `test:intelligence-pipeline` and `test:intelligence-fast-path` pass after the fix.

**Quality of Test 2's answer** (pre-fix, for the record): weak. It never computed an actual recommended walk-away price or counter number tied to the CEO's stated $7.3M target and 1031 deadline — it gave hypothetical branches ("if your walk-away is, say, $7.6M... if it's $8.0M...") instead of picking a number and defending it with reasoning, which is what a sharp real human deal advisor would do. This was a direct consequence of Bug C (irrelevant generic sources forced a generic answer) rather than a model-quality problem — re-testing after the fix should show whether the model gives a concrete recommendation once it's reasoning from the conversation itself instead of scraped mortgage-site snippets.

### Test 3 — same DM, re-asking the exact same question after Bug C fix

**Prompt:** "Let's try that again — same deal, same numbers ($7.3M open, they countered $7.9M). Give me your actual recommendation: what number do I counter with, and what's my hard walk-away price given the 1031 deadline?"

**Result:** 33,510ms. **No search triggered this time** — confirms Bug C fix works. **Quality was excellent**, a real jump: "Counter with **$7.55M** — that's a $250k increase from your open... Your hard walk-away (given the 1031 deadline pressure) should be **$7.7M**. That's $400k above your open, $200k below their counter. If they come back at $7.75M or higher, you're better off walking... If you want, I can help frame the data points (comps, days on market, your timeline) to strengthen the $7.55M offer." Concrete numbers, reasoning tied to the actual deal context, proactive next step offered. This is exactly the "sharp coworker" bar. One caveat: the reply did not appear live in the browser without a manual reload — a separate, lower-priority live-render gap noted for follow-up (not a data-loss issue; the message is persisted correctly).

**But 33.5s is still too slow for what should be a fast streamed reply.** Investigated further and found two more real bugs.

### Bug D — DeepSeek-V4-Flash defaults to hidden "thinking" mode and can exhaust its own output budget
**Evidence:** a background call (see Bug E below) failed with `usage: { outputTokens: 1401, outputTokenDetails: { textTokens: 1, reasoningTokens: 1400 } }, finishReason: 'length'` — DeepSeek-V4-Flash spent 1400 of 1401 output tokens on invisible "reasoning" tokens, leaving 1 token for the actual answer, and got cut off before ever producing real output. `src/lib/ai/siliconflow-client.ts` already disables this ("thinking mode") for Qwen models (`enable_thinking: false`) but never applied the same override to DeepSeek — even though DeepSeek is the **default/primary model** for most employees (`DEFAULT_SILICONFLOW_MODEL` = `deepseek-ai/DeepSeek-V4-Flash`, `SILICONFLOW_STRONG_MODEL` = `deepseek-ai/DeepSeek-V4-Pro`). This is very likely also what caused Test 1's fallback to the much slower Qwen3-8B model (the primary DeepSeek call likely hit the same reasoning-token exhaustion on the larger JSON-structured request and failed over).
**Fix applied:** extended `modelDefaultsToThinkingMode()` in `siliconflow-client.ts` to also disable thinking for `deepseek` and `minimax` model IDs (SiliconFlow normalizes `enable_thinking` across these hosted reasoning models). Since both the blocking (`callSiliconFlowEmployee`) and streaming (`streamSiliconFlowText`) paths already thread `providerOptions: siliconFlowProviderOptions(modelId)` through, this one change applies everywhere the employee composer calls the model.
**Audit for the same gap elsewhere:** found and fixed two more call sites that build a SiliconFlow model but never passed `providerOptions` at all — `topic-summary/generate.ts` (the background summary generator) and `search-synthesis.ts` + `tavily-search.ts` (the SiliconFlow fallback search-answer synthesis paths). All three now pass `siliconFlowProviderOptions(modelId)`.
**Verified:** `npx tsc --noEmit` clean; `test:search-routing`, `test:search-answer-quality`, `test:search-citations` all pass.

### Bug E — the "advisory" DM topic-summary refresh was not actually advisory — it blocked the reply
**This is the single biggest remaining latency bug found in this session.** `process-queued-run.ts` calls `refreshTopicSummary` after every meaningful reply, to keep the topic summary current and to surface "save to memory" suggestion chips. For **rooms**, this already correctly uses `scheduleTopicSummaryRefresh`, which is fire-and-forget (`void ... .catch(...)`, never awaited). For **DMs**, at three separate call sites, the code did `await refreshTopicSummary(...)` — meaning the user's reply was held hostage by this "advisory, non-blocking" background job's full duration, including its own internal timeout (`TOPIC_SUMMARY_TIMEOUT_MS`) if the summarization model call hung or failed. Given Bug D (DeepSeek hidden reasoning mode) was *also* affecting this exact call, DM users were frequently paying the summary call's full timeout on top of the real reply's latency — this is almost certainly why the same class of question measured 35s, 33.5s, and then **167s** across back-to-back tests even as the actual composer path got faster.
**Fix applied:** all three DM call sites now use the same fire-and-forget pattern as rooms. Two of them didn't even use the summary result, so they now call `scheduleTopicSummaryRefresh` directly (identical to the room path — the DM/room special-casing there served no purpose). The third site uses the result to attach a "save to memory" suggestion chip to the just-sent message; that's now handled by kicking off the refresh unawaited and, if it later finds a suggestion, patching the message's `artifacts` column in a separate follow-up write — the same deferred-patch pattern already used elsewhere in this codebase (`queueBackgroundLearningFromSearch`). The memory-suggestion chip may now appear a moment after the reply instead of atomically with it, but the reply itself is never delayed by it again.
**Verified:** `npx tsc --noEmit` clean; `test:intelligence-pipeline`, `test:employee-queued-runtime`, `test:dm-steward` all pass.

**Expected combined effect of Bugs D + E:** the DM composer reply should no longer pay for (a) DeepSeek's hidden reasoning tokens delaying/derailing the actual answer, or (b) an unrelated background summarization job's full timeout being added to the user-visible wait.

### Re-test after Bug D + E fixes — confirmed working

| # | Message | Time | Notes |
|---|---|---|---|
| 4 | "Last one on this deal — if instead they come back at $8.0M flat..." | 167,432ms | Sent *before* Bug D/E fixes landed — this is the worst-case data point that led to finding them. |
| 5 | Austin 12-unit multifamily cap rate question (genuinely needs current market data) | 60,403ms → then 46,794ms on a near-duplicate | Correctly routed to **search** this time (unlike Bug C), and pulled **real, relevant sources** (apartmentloanstore.com, matthews.com, acreus.io) instead of the irrelevant mortgage-blog junk from Test 2. Quality gap: answered the factual cap-rate-benchmark half but did not give a clear opinion/recommendation for the second half of the question ("would you push for a lower price...") — the search-synthesis path optimizes for cited facts, not for blending in a recommendation. Search/synthesis latency (46-60s) is its own, separate latency budget from the composer path and wasn't the target of Bug D/E — worth a future look if search stays this slow.
| 6 | "Should I bring my lawyer to tomorrow's meeting or keep it informal for this first round?" | **8,776ms** | Clean advice question, no search needed. **This is the real before/after signal for Bugs D+E** — down from the 33–167s range for equivalent advice questions earlier in this session. Answer: "Keep it informal for the first round. Bringing a lawyer to an initial meeting can signal distrust or escalate the tone before you've even established rapport. You can always loop legal in afterward if things get serious — much easier to add than to walk back." Direct, well-reasoned, appropriately concise (not padded), sounds like a sharp coworker. |

**Conclusion on speed:** for the class of question Phase 4 streaming + Bug D/E target — internal advice/strategy/judgment calls with no search need — response time dropped from the original **82–167 second range down to ~9 seconds**. That is the single largest improvement of this session. Search-routed questions remain in the 45–60s range, which is a separate latency budget (external API + synthesis) not addressed by today's fixes and worth investigating next if it matters for this workflow.

**Known remaining issue (not fixed today, logged for follow-up):** in this DM, AI replies frequently do not appear live in the chat without a manual page reload, even though the server completes and persists them correctly (confirmed via reload every time). This is a client-side rendering/polling gap, not a data-loss or correctness issue — nothing was ever lost, every reply was exactly where it should be after reload. Flagged as a follow-up, not fixed in this session.

---

## Room test — two AI employees working together (Launch Room: Elena Rossi + Sofia York, both "Product Manager")

### Test 8 — asking two PMs to split real-estate-specific work (out of their actual domain)

**Prompt:** "Team — I'm closing the Riverside Commons deal ($7.55M counter, 1031 deadline in 3 weeks) and need a plan for the first 30 days after closing: tenant retention, any quick value-add renovations, and a timeline. Can you two split this up and each take a piece?"

**Result:** 33,176ms. Sofia (selected as lead) replied: *"Hey Shubham — Elena and I are both Product Managers, so a post-closing real estate plan (tenant retention, renovations, timelines) falls well outside our domain. We don't have the expertise to split this up and deliver a reliable plan. I'd recommend adding a real estate or property management specialist to the workspace for this. Happy to help with any product roadmap or delivery work if that comes up down the line."*

**This is an excellent result and directly confirms the Bug A fix works in a multi-employee setting.** Faced with a task outside both employees' real expertise, the AI: (1) did **not** invent a fake specialist teammate to "delegate" to (the exact failure mode from the original "@Priya Nair" bug), (2) was honest about the capability gap, (3) gave the correct real-world recommendation (hire/add the right role), and (4) offered to help with adjacent work it's actually suited for. No hallucinated names, no fake handoff. This is exactly the roster-honesty behavior the fix was designed to produce, and it held up under a genuinely awkward prompt designed to pressure it into fabricating a split.

*(Side note: this also surfaces that this test workspace's employee roster — two Product Managers — isn't well-matched to a real-estate CEO scenario. That's a test-data mismatch, not a bug.)*

### Test 9 — same two employees, a task actually in their domain (product spec + peer review)

**Prompt:** "Good call. Different ask that IS in your wheelhouse: I want a simple internal deal-tracker tool for our brokerage — pipeline stages, key dates, negotiation notes. Can one of you own the product spec and loop the other in for a review?"

**Result:** 45,151ms. Elena (or Sofia — need to confirm which employee replied) took ownership: *"I'll own the spec. Drafting a lean internal deal tracker doc now — pipeline stages, key date fields, negotiation notes, and a lightweight user flow. Once it lands in Drive, I'll hand it to Elena for review. @Elena Rossi — I'll ping you with the doc in a dedicated topic so you can tear it apart."*

**This is good collaboration behavior** — real ownership, a real @mention handoff to a real teammate (not a fake one), and a sensible plan (draft → Drive → review). This is exactly the "workforce, not chatbot" pattern the user asked to see.

### Bug F — NEW, SIGNIFICANT: raw tool-call schema leaked into the visible chat message, and the tool calls failed to execute
**This is a separate, pre-existing bug, unrelated to today's other fixes** — found while testing Test 9's collaboration flow. After the good opening paragraph above, the **same visible chat message** continued with literal internal-schema text dumped straight into the chat bubble:

> `effects.toolCalls: tool: artifact.createDocx mode: execute args: title: "Deal Tracker Product Spec" template: "business_brief" summary: "..." sections: heading: "Overview" body: "..." heading: "Pipeline Stages" body: "..." [...] tool: team.coordinate mode: execute args: employeeName: "Elena Rossi" message: "..." topicHint: "deal-tracker-spec" tool: tasks.createTask mode: execute args: title: "Review deal tracker product spec" description: "..." priority: "medium" assigneeType: "ai"`

Followed by a red inline error banner: **"Actions not completed — Nothing was saved to CRM, Tasks, or Drive. Ask again to retry."**

**What this means:** this message needed real tool calls (`artifact.createDocx`, `team.coordinate`, `tasks.createTask` — the Integration Tool Core), so it correctly stayed on the blocking structured-JSON path rather than my new streaming path (confirming `capabilityAllowsStreaming`'s tool-work detection is working as intended — it did NOT try to stream this one). But somewhere in the structured-output parsing / schema-repair fallback chain (`structured-llm-call.ts`'s tier 2/3 fallback, or `normalize-model-response.ts`), the model's output was not cleanly split into `reply` vs `effects.toolCalls` — instead, a malformed/YAML-like rendering of the tool-call block got concatenated directly onto the visible reply text, and the tool calls themselves then failed validation/execution entirely ("Actions not completed").

**Why I have not fixed this yet:** this is a different subsystem (structured-output parsing fallback + the Integration Tool Core executor) than everything else fixed in this session (Bugs A–E were all in the intelligence/routing/streaming/model-config layer). Properly diagnosing this needs to trace through `structured-llm-call.ts`'s fallback tiers and the tool-call executor/validator to find exactly where the split breaks down, which deserves its own focused pass rather than a rushed fix appended to an already-large set of changes. **Flagging this as the top-priority next investigation** — it's a visible, embarrassing failure mode (raw schema text in front of the user) combined with a silent capability failure (the tool calls didn't actually run), which is worse than either problem alone.

---

## Session summary

**Fixed and verified this session:**
- **Bug A** — hallucinated teammate names (e.g., "@Priya Nair") from hard-coded prompt examples → fixed with a strict, ground-truth team-roster block in the system prompt. Verified in both a DM (no more fake names) and a room (correctly refused to fabricate a specialist when none existed).
- **Bug B** — slow (82s+) responses on advice/strategy questions due to the JSON-envelope blocking path + router LLM overhead → fixed by broadening Phase 4 streaming to conversational replies and adding an `ADVICE` fast-path.
- **Bug C** — a second, independent legacy DM-search classifier could override the correct "no search needed" decision, sending internal deal-math questions to the web and truncating answers via the search-synthesis token cap → fixed by aligning `shouldSkipLegacyResearchPlanner` with what the intelligence layer already decided.
- **Bug D** — DeepSeek-V4-Flash (the default model) defaults to hidden "thinking" mode on SiliconFlow and can exhaust its entire output budget on invisible reasoning tokens, causing structured-output failures and fallback to a much slower/weaker model → fixed by extending the existing Qwen-only `enable_thinking: false` override to DeepSeek and MiniMax, and by wiring `providerOptions` into three call sites that had never passed it at all (topic-summary generator, search-synthesis SiliconFlow fallback, Tavily synthesis).
- **Bug E** — the "advisory" DM topic-summary refresh was actually awaited synchronously, so its own internal timeout could add up to ~2.5 minutes directly onto the user-visible reply wait, in DMs only (rooms already did this correctly as fire-and-forget) → fixed by making all three DM call sites fire-and-forget, matching rooms, while preserving the "save to memory" suggestion chip via a deferred follow-up write.

**Net effect:** a clean advice/strategy question in a DM went from **82–167 seconds** down to **~9 seconds**, with materially better answer quality (concrete numbers and recommendations instead of hedged hypotheticals) once Bug C stopped sending it to irrelevant web sources.

**New, not-yet-fixed issue found:**
- **Bug F** — raw internal tool-call schema (`effects.toolCalls: tool: ...`) leaking into a visible chat message, with the underlying tool calls then failing to execute ("Actions not completed"). Found in a room multi-employee collaboration test. This is in the structured-output parsing/fallback layer and the Integration Tool Core executor — a different subsystem from everything else fixed today. Recommended as the next priority.

**Also flagged, lower priority:**
- AI replies in this environment frequently need a manual page reload to appear live in the chat (server-side processing and persistence is always correct — confirmed via reload every single time in this session). Client-side rendering/polling gap, not a data problem.
- Search-routed questions (e.g., market cap-rate lookups) still take 45–60s — a separate latency budget (external search API + synthesis) not addressed by today's fixes.
- The admin diagnostic endpoint `src/app/api/ai/test-provider/route.ts` also never passes `providerOptions` to its health-check calls — very low priority since it's not part of any live conversation path, noted for completeness.

All fixes in this session are typecheck-clean (`npx tsc --noEmit`) and covered by passing unit tests (`test:intelligence-pipeline`, `test:intelligence-fast-path`, `test:employee-queued-runtime`, `test:dm-steward`, `test:search-routing`, `test:search-answer-quality`, `test:search-citations`).

---

## Round 2 fixes — Bug F (tool-call leak) and Bug G (no realtime, manual reload required)

Per instruction, both bugs were fixed properly before continuing with more tests.

### Bug F — FIXED: raw tool-call schema leaking into chat + failed tool execution
**Root cause, precisely identified:** the model sometimes writes its intended tool calls as literal schema-like text (`effects.toolCalls: tool: crm.createContact mode: execute args: ...`) **directly inside the "reply" string field**, instead of populating the real structured `effects.toolCalls` array. Because "reply" is just typed as a string, this passes schema validation fine — so the leak sails through untouched, and the *real* `effects.toolCalls` stays empty, which is also why the action then fails to execute ("Actions not completed"). This is a model failure mode, not a JSON-parsing bug in our code, so it can recur with any model at any time — it needs a deterministic code-level guard, not just a prompt nudge.
**Fix:** added `stripSchemaLeak()` to `src/lib/ai/normalize-model-response.ts`, wired into `sanitizeReplyForChat()` — the single choke point every reply-producing path already funnels through (legacy tiers 1–3, Runtime V2, the new streaming path, browser-research, intelligence composer). It detects the leak marker (`effects.toolCalls:`, bare `effects: {`, or a `tool: x.y ... mode: execute` pattern) and cuts the reply off right before it, keeping only the clean prose that came before. If nothing clean survives, it falls back to a safe generic line instead of an empty bubble. Also strengthened the tool-calling prompt instructions in `integrations/prompt.ts` to explicitly forbid writing "effects"/"tool:"/"mode:"/"args:" as literal reply text, as a cheap first line of defense.
**Tested:** new `scripts/test-sanitize-reply.ts` (`npm run test:sanitize-reply`) — reproduces the exact captured leak text and confirms it's stripped while the clean prose prefix is preserved; also asserts **no false positives** on ordinary prose that happens to contain the words "effects" or "tool" in a normal sentence. All existing tests (`test:claimed-actions-guardrail`, etc.) still pass — no interaction with the existing "false completion claim" honesty guardrail, which is a different, complementary check.

### Bug G — FIXED: AI replies required a manual reload; no true realtime delivery for ordinary chat
**Root cause, precisely identified:** the codebase already had a Supabase Realtime channel for live chat replies (`useBrowserResearchRealtime`), but it was **gated behind `browserResearchAvailable`** — enabled only when the room has an employee with browser-research capability granted. For any room or DM without one (the exact setup used throughout this test — two Product Managers, no research tooling), there was **no realtime message delivery at all**. The only paths that ever showed a reply were (a) the sending browser tab's own direct `addMessage` call right after its `/process` request resolved, or (b) a full workspace reload. Neither helps a second viewer, a second tab, or — per my testing — even the sender's own tab in several observed cases.
**Fix:** built a new, general-purpose `useMessagesRealtime` hook (`src/lib/realtime/use-messages-realtime.ts`), subscribed unconditionally (not gated behind any feature flag) whenever connected to Supabase, scoped to the active topic. It listens for `INSERT` (new messages — delivered live to every viewer) and `UPDATE` (e.g. the Bug E deferred memory-suggestion-chip patch, or any future streamed-content growth) on the `messages` table, and feeds them straight into local state via the existing `addMessage`/`updateLocalMessage` actions (both already idempotent by message id, so no risk of duplicating a message the current tab already added itself). Reused the existing row-mapping logic (`messageFromRow`, now exported from `persistence.ts`) instead of writing a second, divergent mapper.
**A second bug found and fixed during verification:** live-testing this surfaced a duplicate-bubble race — the sending tab's own in-progress "streaming placeholder" bubble could still be on screen when the realtime INSERT for the final persisted message arrived (the realtime push can beat the sending tab's own stream-reader loop to finishing), leaving both the ghost placeholder and the real message visible together. Fixed by having the realtime insert handler proactively clear any local placeholder for the same `agentRunId` before adding the final message, plus a defensive second removal at the point the sending tab's own code adds the final message — so the ghost is cleared regardless of which path gets there first.
**Verified live, twice, in both a room and a DM:** sent a message, waited without ever calling reload, and confirmed the reply rendered on its own — "Yeah, I'm here. Go ahead." (room) and "Yep, I can see it — no reload needed. This is real-time." (DM). Re-tested a third time specifically to confirm no duplicate bubble: exactly one clean AI message rendered, zero lingering `stream-` placeholder ids in the DOM.

Both fixes are typecheck-clean and the full existing test suite still passes.

---

## Round 3 — CEO-lens testing: CRM, PDF artifacts, tool-call reliability

### Setup note: role/tool-grant mismatch is a real discoverability trap
All 3 hired employees in this workspace (Elena Rossi, David Kim, Sofia York) are "Product Manager" role — **none had CRM tools granted by default**. When asked to log a CRM contact/deal, Elena correctly and honestly said she didn't have CRM access rather than faking it (good — confirms the honesty guardrails hold up under real pressure). But this is a genuine UX gap worth flagging: a CEO hiring employees generically (not realizing role selection drives tool access) would hit this immediately, with no obvious in-chat signal about *why* — they'd have to know to go to the employee's profile page, find "Tools & capabilities," and manually check boxes. I granted David Kim CRM access via his profile (`/workforce/[id]` → Tools & capabilities → CRM checkbox → Save capabilities) to continue testing the underlying capability.

### Bug H — NEW, SEVERE: CRM/tool-call requests fail outright, even for a single simple action
**Test:** asked David Kim (now CRM-enabled) to add one CRM contact — nothing else, no PDF, no deal, just one action: "Just add the CRM contact: Marcus Webb, buyer's agent at Webb Realty Group, email marcus@webbrealty.com. No PDF needed right now."
**Result:** 103,259ms, then failed outright: *"I couldn't complete a live model response right now. Reason: This operation was aborted. Check Settings → AI Runtime to verify provider keys and model configuration."* A second test asking for CRM contact + deal + a PDF summary together also failed the same way after 105,750ms. **CRM tool calls are effectively non-functional right now** — this is likely the exact experience that prompted the original complaint ("it failed to create tasks or even use the CRM").
**Root cause, precisely evidenced (not fully fixed — flagging as top priority):** this traces back to the same DeepSeek "hidden reasoning tokens" mechanism as Bug D, but Bug D's fix does **not** fully cover this path. Fresh server logs (same session, after the Bug D fix was confirmed live) still show `deepseek-ai/DeepSeek-V4-Flash` burning `reasoningTokens: 1258` out of `1400` total output tokens on a **`generateObject`-based** structured call (the topic-summary generator, same call shape the legacy CRM/tool-calling composer path uses) — i.e., `enable_thinking: false` reliably suppresses reasoning for plain `generateText`/`streamText` calls (confirmed by this session's fast, successful advice-question tests) but does **not** reliably suppress it for `generateObject`-based structured/tool-calling calls. CRM and other tool-backed actions require the model to emit structured `effects.toolCalls`, so they're forced through exactly the call shape that still burns its budget on invisible reasoning, exhausts the token cap, and aborts.
**Why I didn't attempt a further fix live:** the exact mechanism for why `generateObject`'s structured/function-calling mode doesn't honor the same `enable_thinking` override needs verification against SiliconFlow's actual API behavior (docs or a support channel), not more guessing at parameter shapes — a wrong guess here risks masking the real problem instead of fixing it. Recommended as the #1 priority next investigation: either find the correct way to disable thinking mode for tool-calling/structured requests specifically, or move CRM/tool-call generation onto the same plain-text-then-parse pattern that's already proven to work fast (the tier-2/3 fallback in `structured-llm-call.ts`, or extending the streaming architecture to tool-calling requests using the AI SDK's native tool-call support in `streamText` instead of `generateObject`).
**Impact if unfixed:** every "leverage the CRM," "create a task," "generate this artifact" workflow — exactly the kind of AI-employee leverage a CEO wants most — is at serious risk of silently failing after a 1.5–2 minute wait. This is more urgent than any polish/speed work; it's a core-capability outage for a meaningful slice of real work.

*(Positive control: plain conversational advice/strategy questions — the majority of what a CEO would ask day to day — consistently worked fast and well throughout this round, including with realtime delivery. The break is specifically in the tool-calling/structured-effects path.)*

**FIXED 2026-07-11 — see `docs/audits/AUDIT_REPORT.md` "Fixed: Bug H" entry for the full writeup.** The reasoning-token hypothesis above was wrong (or at least incomplete) — re-verified that `enable_thinking: false` correctly suppresses reasoning even for `generateObject`/strict-schema calls, as long as the schema doesn't contain a `z.record()` field. The actual root cause: `ToolCallEffectSchema.args` (and `ArtifactEffectSchema.contentJson`) are open `z.record()` fields, and the AI SDK's strict-JSON-schema conversion forces `additionalProperties: false` onto them, making it structurally impossible for the model to populate `args` with real data without violating the schema it was just given — which is exactly what stalls/aborts on every real tool call. Fixed by routing tool-calling `generateObject` calls through a new loose-JSON-plus-zod-validation path (`generateObjectViaJsonMode`) instead of strict schema mode.

---

## Features and abilities to build — a CEO's-eye view

Separate document: see **`docs/ai-employee-feature-gaps.md`** for the full, organized roadmap of artifacts, integrations, and abilities a real estate business (and SMBs/startups generally) would want from AI employees, based on this round of hands-on testing plus what a CEO managing a Slack-style AI workforce would realistically reach for.
