# AdeHQ End-to-End Product Evaluation

Evaluator: Claude acting as Principal QA + Product Designer + CEO
Started: 2026-07-10
Scope of this pass: Phase 1 (partial), Phase 2/3 (partial via Maya/Elena/David), Phase 5 (collaboration, via pre-seeded room), Hire flow (Phase 8-adjacent). Real estate only, per user direction. Other 11 phases and 6 additional industries not yet covered — continuing in next pass.

---

## Session 2026-07-23 — Drive upload vanishes (Vercel root cause)

**Symptom:** Upload progress hits 100%, Drive stays empty (including single-file uploads).

**Vercel production logs:** `POST /api/drive/upload` returned **200** with real
`fileId`s. PDF path logged `@napi-rs/canvas` / `DOMMatrix` warnings.

**DB proof (`workspace_files`):** rows existed. PDFs were `status=failed` with
`parserError: "DOMMatrix is not defined"`. Drive list filtered
`.neq("status", "failed")`, so PDFs disappeared after a “successful” upload.
DOCX/MD/XLSX were `ready` (also embedding 400s on SiliconFlow — separate from
visibility).

**Fix:** load `pdf-parse/worker` + externalize `@napi-rs/canvas`; never demote
stored files to `status=failed` (use `parse_status=failed`); list failed rows;
stale list-load race guard after upload; repaired existing failed-but-stored rows.

**Follow-up:** duplicate-name upload UX — preflight conflicts API + modal with
Keep both (`name (N).ext`) / Replace / Skip before upload proceeds.

---

## Session 2026-07-23 — PR-22B → 22E (ontology, goal diffs, goldens)

**Shipped on top of 22A/C:**
- **22B ontology** — 16 archetypes, reusable functional modules, industry
  adaptations, ~30 curated packs compiled to `TemplateManifest`; Starting
  points grouped by category. Legacy software_house / saas_startup / general_ops
  retained for stable tech/ops graphs.
- **22D goal-ops** — deterministic Maya shortcuts with WH impact review card;
  `POST .../goal-op`; free-text NL edit unchanged.
- **22E** — 35 offline business-description goldens, pack quality scorer, light
  `studio-fade-up` motion on entry/diagnosis/reveal, assumption dismiss on
  diagnosis.

**Verify:** `npm run test:workforce-studio:architect`, `:composition`,
`:goldens`, `:pack-score`; `npx tsc --noEmit`.

**Residual:** PDF/document import still out; live promptfoo architect goldens
optional; full human usability study not in-repo.

---

## Session 2026-07-23 — PR-22A + thin PR-22C (Maya Business Architect)

**Shipped:** Natural-language Business Architect entry for Workforce Studio
(`/hire/team`): diagnose → ≤5 adaptive clarify questions → map to existing
packs → team reveal → canvas-first Studio. Brain model picker hidden
(customer-facing); WH shown as low–high bands with light/typical/busy copy;
Maya panel shortcuts (leaner / growth / support). Template picker demoted to
"Starting points". Compose still feeds unchanged Simulate / Approve / Provision.

**QA notes / residual risk:**
- Website URL fetch into diagnose is best-effort (timeout + size cap); no PDF
  import yet (explicit non-goal).
- Industry differentiation beyond pack + intake flags is still thin until
  PR-22B (archetype/module registry) — Shopify vs restaurant both land on
  `general_ops` with different intake/mission polish, not fully distinct packs.
- Goal-based structural diffs (beyond Maya prompt shortcuts) remain PR-22D.

**Verify:**
- `npm run test:workforce-studio:architect`
- `npm run test:workforce-studio:composition`
- Manual: description → reveal → Open Studio (no model select) → Simulate shows WH band → Start over releases lock

---

## Session 2026-07-16 — White-hat security hardening (app.adehq.com)

**Probes (cheap, no flood):**
- `GET /api/inbox/jobs/process` with only `x-vercel-cron: 1` → **200** before fix (spoofable drain).
- 5× `POST /api/auth/forgot-password` → all **200** (no rate limit).
- `/login` headers → HSTS only; no CSP / frame / nosniff.

**Fixes shipped:**
- Cron drain requires `Authorization: Bearer CRON_SECRET|INTERNAL_CRON_SECRET` (fail closed outside dev).
- `ensure-maya` requires workspace membership for requested `workspaceId` (IDOR).
- Revolut webhook fails closed when secret missing in production.
- Durable `security_rate_limit_events` + `consumeRateLimit` on forgot/resend, room messages, inbox send (20/h + 100/day), mailbox availability, invites, hiring interview, browser research.
- AI capacity check fails closed on tracking errors.
- Invite `expires_at` = 7 days; tool catalog seed → platform admin write only.
- Security headers in `next.config.mjs` (CSP, HSTS, frame-ancestors, nosniff, referrer, permissions).
- Revoked EXECUTE on maintenance SECURITY DEFINER RPCs from anon/authenticated; pinned `increment_workspace_usage_period` search_path.
- Signup confirmation copy no longer enumerates “account already exists”.
- Production `CRON_SECRET` set on Vercel; cron schedule stays `0 4 * * *` (Hobby cannot run more than daily — webhook processes new inbound immediately).

**Verify after deploy (2026-07-16, `b7e12192` on `app.adehq.com`):**
- cron spoof (`x-vercel-cron` only) → **401**
- forgot-password burst → **200×3 then 429**
- `/login` → CSP, HSTS, `X-Frame-Options: DENY`, nosniff, referrer, permissions-policy

**Follow-up IDOR fixes (service-role audit):**
- `GET /api/inbox/mailbox` — membership required; mailbox payload only if read/admin.
- Browser research create — `assertCanAccessRoom` / `assertTopicInRoom` before service-role write.
- Browser research cancel — creator, admin, or room access; use run’s canonical workspace id.
- Tools catalog write was already platform-admin-only from the main hardening pass.

**AI conduct + DB bar-raise (no Pro plan):**
- Global `professionalConductRules()` in every employee system prompt (illegal/harmful/PII/secrets).
- Workforce flags `approvalBeforeExternal` / `approvalBeforeEmails` enforced in tool executor; `email.sendDraft` always requires approval; `calendar.scheduleDraft` → required.
- Daily caps on `email.createDraft`, CRM creates, `team.coordinate`.
- RLS: `is_workspace_member` / `shares_workspace_with` require active status; admin-only workspace/member mutations; agent_runs + usage client writes removed; inbox outbox/events not client-writable; revoke service-only table grants.

---

## Session 2026-07-16 — Stall / no self-wake after “give me a sec”

**Observed:** Casey replied “give me a sec” (or similar) on a real work ask, completed the agent run, went idle, and never continued — human had to nudge again.

**Root cause:** Follow-up queuing only wakes *other* employees on @mention/handoff. A same-employee stall with empty tools had no continuation path. Steward did not re-queue the assignee.

**Fix (code):**
- `isDeferredWorkPromise()` in `room-governance.ts`
- `queueSelfContinuationIfNeeded()` in `queue-follow-up-runs.ts` (max 1 `task_follow_up` / `workType: self_continuation` per root)
- Wired in `process-queued-run.ts` + background drain so the chain continues without the tab babysitting
- Prompt ban on empty deferrals; continuation turn forbids stalling again

**Verify:** After deploy, ask Casey a tool-heavy inbox/calendar ask; if she stalls once, a second run should auto-fire and deliver.

---

## Session 2026-07-16 — Inbox showed Sent + “paraphrased” inbound

**Observed:**
1. Main Inbox listed rows as `To: skumar@…` (outbound outreach), not only incoming.
2. AutoDesk thread showed a polite paraphrased reply (“mid-market ops teams…”) that did **not** match the real Gmail send (“Hey Casey, Yes, lets set up something…”).

**Root causes:**
1. Inbox folder query was `status in (open,waiting) AND not spam` with **no** `latest_direction = inbound` filter — so ~29/30 open outbound threads appeared in Inbox.
2. The paraphrased body was **not** a rewrite of the real email. It was a synthetic Slice F test row (`provider_email_id = slice-f-test-…`) inserted during e2e. The real Gmail reply **had** arrived as Resend webhook `email.received` (`provider_email_id = a44f3bbc-…`) but sat in `email_inbound_events.processing_state = queued` with 65+ other events. Inbox cron was `0 4 * * *` (once/day), so the real body never landed until a manual drain.

**Fix:**
- Inbox query requires `latest_direction = inbound`; list preview uses last inbound; unread badge same.
- New **All mail** folder (`is_spam = false`).
- Webhook drain processes the just-stored event first, then a larger batch; daily cron remains recovery-only on Hobby.
- Deleted the synthetic test inbound; drained the queue — real body now stored verbatim.

**Verify:** Inbox shows only inbound-latest threads; AutoDesk thread body matches Gmail; Sent / All mail / Awaiting still work.

---

## Session 2026-07-16 (later) — Stall recurred: “Checking the inbox now — pulling the latest thread…” with no follow-through

**Observed:** Casey (role `sales`, so `roleWorkflowRules` already told her to use `email.listRecent`/`email.getThread`) stalled again on a multi-part ask (check inbox + invent product + propose reply + create a calendar reminder). Her reply narrated the check ("Checking the inbox now — pulling the latest thread to report back on…") but emitted zero `effects.toolCalls`, and the run ended there.

**Root causes (layered, all contributed):**
1. `isDeferredWorkPromise()`'s regexes were too narrow — they matched `"checking (that|it|this|now)"` and `"pulling (that|it|this) up"` but not the natural phrasing `"Checking the inbox now"` / `"pulling the latest thread"`, so the self-continuation safety net never fired for this exact wording.
2. The retry-with-stronger-model system reminder (`process-queued-run.ts`, fires when `needsTools && !gotTools`) only named artifact/CRM/task/email-draft tools — it never told the model to call `email.listRecent`/`email.getThread` for read/check-inbox asks, or `tasks.createTask` for reminders (there is no separate calendar-event tool).
3. The last-resort tool-call synthesis (same file) only had inferrers for artifacts and email draft/send — a narrated-but-toolless "let me check the inbox" reply had no synthesis path, so nothing was ever attached even as a fallback.
4. Non-`sales`/`pm`/`fundraising` roles (`default` case in `roleWorkflowRules`, e.g. `support`, `operations`) were never told about `email.listRecent`/`email.getThread` at all — any employee handling inbox work in that bucket would have the same failure mode with even less prompt help.

**Fix (code):**
- Broadened `DEFERRED_WORK_PROMISE_PATTERNS` in `room-governance.ts` to catch `"checking … now"`, `"pulling … thread/inbox/context"`, `"report back"`, `"I'll get/circle back"`.
- Added `inferRequiredEmailReadToolCalls()` / `replyForInferredEmailReadTool()` in `infer-email-tool-call.ts` — last-resort synthesis now attaches a real `email.listRecent` execute call (and swaps the narrated reply for one referencing the real result) when the model stalls on a check-inbox ask.
- Wired the new inferrer into `process-queued-run.ts`'s last-resort block, and widened `narratedOnly` there to also cover `isDeferredWorkPromise()` matches.
- Expanded the retry system reminder in `process-queued-run.ts` to explicitly name `email.listRecent`, `email.getThread`, and `tasks.createTask` (for reminders/call scheduling) and to forbid "checking now"/"I'll report back" narration.
- Added an explicit `support` case to `roleWorkflowRules()` and enhanced the `default` case in `prompts.ts` so every role is told to call `email.listRecent`/`email.getThread` for inbox reads and `tasks.createTask` for reminders (no calendar-event tool exists — a due-dated task is the reminder).
- Strengthened the self-continuation nudge in `queue-follow-up-runs.ts` to name `email.listRecent`/`email.getThread` explicitly instead of a generic "tools required" line.

**Verify:** Against a multi-part inbox+product+calendar ask, Casey should either deliver real inbox data via `email.listRecent` in-turn, or the last-resort synthesis should attach it even if she narrates instead of calling the tool.

---

## Session 2026-07-15 evening — SaaS Company 1 CEO marathon (Playwright)

**Persona:** Founder/CEO, SaaS Company 1 (FlowDesk / mid-market ops). Production `https://app.adehq.com`. Artifacts: `/tmp/adehq-saas-marathon`, `/tmp/adehq-saas-casey-email`.

### What worked
- Landed on completed SaaS Company 1 (Lane / Casey / Jules hired; Engineering room live).
- CEO Inbox compose → send to `skumar@nexcache.com` with undo toast (`Sending "SaaS Company 1 weekly note…"`); mailbox `saas1edwez@inbox.adehq.com`.
- Lane DM: PRD outline + **Task created: Review Approvals Inbox PRD outline**.

### Bugs found / fixed this session
| Sev | Bug | Status |
|---|---|---|
| P1 | Inbox stuck on "Loading inbox…" (Compose missing until slow fetch) | **Fixed** — 25s mailbox timeout + Retry button (`inbox/page.tsx`) |
| P1 | Subject field hard to target in E2E | **Fixed** — `aria-label`/`placeholder` on Composer Subject |
| P1 | Agent process `Failed to fetch` left employees silent | **Fixed** — one retry on transient network errors (`RoomChat.tsx`) |
| P0 | Lane previously refused email ("don't have the ability") — still in stale topic summary | Tool-path + infer-email on `main`; Casey DM path verified drafting + Approvals |
| P1 | Approval chips in chat were non-clickable (no Approve UI) | **Fixed** — inline `ApprovalCard` + Review link (`RoomMessageItem.tsx`) |
| — | Casey → draft → Approvals → Approve for `skumar@nexcache.com` | **Verified** Casey E2E `bugs: []`; bulk-approve script clearing stacked cards |
| P2 | Duplicate SaaS Company 1 switcher rows / incomplete onboarding clone | Known; marathon skips onboarding rows |
| P1 | AI Work Hours rail stuck at `0.00 / 10.00` despite active AI work | **Fixed** — (1) floor raw period total (2) `finalizeAiRun` mirrors into `ai_cost_ledger_entries` (3) min 0.01h per finalized reply (4) Usage summary falls back to `workspace_usage_periods.ai_work_hours_used` when ledger select is empty/errors so the meter cannot go dark |
| P1 | Email/DOCX artifact insert used `art_*` ids but `artifacts.id` is uuid → storage sync `22P02` | **Fixed** — `randomUUID()` for artifact PKs; storage events ignore non-uuid `user_id` (emp_*) |
| P1 | DM open spams 400/`22P02` for `topic-general-dm_*` on summary/files/artifacts/read/agent-runs | **Fixed** — guard non-uuid topic ids before querying |
| P1 | SaaS Usage API returned `0.00` while DB period had ~0.15h | **Fixed / verified** — resilient period lookup + probe fallback; post-deploy SaaS Usage shows **0.16 / 10.00** |
| P1 | Usage hire breakdown empty ("No hired-employee AI activity") while total showed 0.16h | **Fixed / verified** — stop selecting ledger `metadata` (wide select returned `data:[]` with count=26); lean select + leaf floor; SaaS shows Casey/Lane/Jules hours (0.19 total) |
| P1 | "At capacity" on Casey DMs (abandoned interactive slot) | **Fixed** — skip admission for `dm_*` rooms + 60s stale interactive reap |
| P1 | Marathon/E2E `waitAi` treated leftover draft cards as success → room collab looked “done” while AI silent | **Fixed** — require new `[data-message-id]` growth; ignore stale draft cards |
| P1 | Lane CRM ask became a Tasks card; `/crm` stayed empty (false-pass in CRM wave) | **Verified** Casey DM creates Contact + Deal + Task; CRM shows $18k Qualified (duplicate deal cards noted as P2) |
| P1 | Room collab silent after AI tool cards (ambient governance) | **Fixed** — work intents (`task_request`, `direct_question`, collab, etc.) bypass after-AI skip (`ambient-governance.ts`); marathon now `@mentions` team |
| P1 | Drive stuck on "Loading Drive…" (no Retry) | **Fixed** — 25s list timeout + Retry (`drive/page.tsx`)
| — | Jules DOCX + email draft to skumar@nexcache.com | **Verified** in browser (DOCX + draft path) |
| P1 | "At capacity — logged in task book" after abandoned agent runs | **Fixed** — 60s stale reap + @mention skip + DM rooms skip admission (`admission.ts`, `queue-agent-runs.ts`)
| — | Engineering @mention collab (Casey+Lane one-liner) | **Verified** after wait baseline fix |
| P2 | Duplicate identical CRM deals from repeated Casey asks | Observed; defer de-dupe |

### Scripts
- Manual SaaS Company 1 waves in the browser (inbox email, CRM/tasks, approvals)

## Session 2026-07-15 — Hybrid workforce + topic/memory suggestion retest

**Persona:** Owner, RealEstatePros Ltd (Canterbury lettings/sales). Production `https://app.adehq.com`. Screenshots under `/tmp/adehq-hybrid-e2e`, `/tmp/adehq-topic-session`.

### What worked

- Multi-employee collaboration on a real product/sales problem (**Landlord Care Plus**, then **Harborline Guarantor Shield**): Wren (SDR), Adrian (Ops), Emily (negotiation) all responded with distinct angles, price bands, and ownership splits.
- Topic steward **did** fire an LLM suggestion with “Will move N messages” + **Create topic & continue there**.
- Accepting navigated into a new topic; DB confirms system message + message `topic_id` updates (`Moved 7 related messages…`).
- Tasks board reflected an in-progress “lock a working draft…” card from the chat.
- Workforce page capacity/hiring pipeline looks credible for a hybrid-ops product.

### Major bugs found this session

| Sev | Bug | Evidence | Likely cause | Fix direction | Status |
|---|---|---|---|---|---|
| **P1** | **Pending topic suggestions vanish after navigation/refresh** | Landlord Care Plus suggestions stayed `pending` in DB but UI showed no banner on reopen | No client fetch on room mount | `GET /api/rooms/[roomId]/topic-suggestions` + RoomChat hydrate | **Fixed 2026-07-15** |
| **P1** | **Suggested topic titles truncated mid-phrase** | Title stored as `…Whitstable landlord (6` | Hard cut without rewrite | `cleanTopicTitle` / `cleanTopicDescription` in steward + topics POST | **Fixed 2026-07-15** |
| **P1** | **Migration pulls the wrong adjacent workstream** | Harborline topic mixed Landlord Care Plus messages | Broad message-id window | Title-token filter in steward + `filterMessageIdsForTopicMigration` | **Fixed 2026-07-15** |
| **P1** | **New topic has no AI members** | Only human owner after accept | Suggestion create omitted `aiEmployeeIds` | Default room AI members on topics POST + client pass-through | **Fixed 2026-07-15** |
| **P1** | **AI claims memory saved; none exists** | “saved … durable context” with 0 memories | Narrated save without insert | `scrubFalseMemoryClaims` + prompt honesty | **Fixed 2026-07-15** |
| **P1** | **Right-rail Brief Summary is stale** | Zone 2 summary while chat moved on | Cooldown ignored new messages | Bypass cooldown when latest msg not in `sourceMessageIds`; stale UI cue | **Fixed 2026-07-15** |
| **P2** | **Description duplicates truncated title** | Template echo | Fallback description | Cleaner description helper | **Fixed 2026-07-15** |
| **P2** | **Junk historical pending suggestions** | `Emily`, `Team`, etc. | Old heuristics | Migration + GET auto-dismiss junk titles | **Fixed 2026-07-15** |

### UX / hybrid-workforce notes

- Layout (sidebar / topics / chat / summary) is dense but readable; Collaboration mode chip is clear.
- Topic banner CTA **Create topic & continue there** is the right owner language; truncation undermines trust.
- Manual chips under composer (`Summarize topic` / `Create task` / `Save memory`) insert slash-style actions — easy to confuse with AI “suggested memory” banners.
- Inbox badge `2` and DM unread `5` create ambient urgency; fine if accurate.
- Console: intermittent `Failed to fetch RSC payload for /rooms/... Falling back to browser navigation` on first navigation after login.

### Not fully validated

- Chat **memory suggestion chip** workflow (accept/save) — never surfaced; only manual Save memory path exercised.
- Accepting a **pending** Landlord Care suggestion after reload (blocked by hydration bug above).

---

## Remaining work / open items (as of 2026-07-11)

Everything below is **not yet fixed**. Ordered roughly by severity/impact. Each item names the exact symptom, root-cause hypothesis (or confirmed cause where I dug in), and suggested fix direction, so this is directly actionable by whoever picks it up next.

### Bugs

1. ~~**Duplicate/redundant AI responses to the same question.**~~ **FIXED 2026-07-12 — see "Fixed: duplicate AI responses..." section below.**

2. ~~**Topic-summary background job stuck in a repetition loop, burning tokens on garbage.**~~ **FIXED 2026-07-12 — see "Fixed: topic-summary repetition loop..." section below.**

3. **Storage quota widget on the Drive page didn't reflect newly-saved exports during testing** — showed "1.0 KB of 1.00 GB used" even after several multi-hundred-KB PDF/DOCX exports were saved. Not root-caused; likely a separate metric/counter that isn't wired to the same write path as `persistBinaryExport`, or a caching issue similar to the CRM one already fixed (worth checking if it needs the same `cache: "no-store"` treatment). Low severity (doesn't block work) but makes the quota number meaningless.

4. **No in-app inline preview for generated PDFs** — Drive's file preview modal shows "No inline preview for this download. Use download to open it locally" for PDF exports. For a platform whose core pitch is AI-generated documents, forcing a full download-and-reopen cycle to see the very artifact you just asked for is real friction (compare: ChatGPT/Claude render documents inline). Not a bug, but worth prioritizing — probably an iframe/embed of the PDF (or a rendered-HTML preview using the same `buildReportHtml` used to generate the PDF, which would be cheap since that HTML already exists).

5. **Login page keyboard-typing quirk** — the browser automation's `type` action after a `left_click` on the email/password fields didn't land text (focus appeared to land elsewhere); had to use direct ref-based field-fill to work around it. Never confirmed whether this reflects a real focus-management bug a human keyboard user could hit, or is specific to the automated browser tool used for this audit. **Needs a human click-through to confirm** — low priority given the workaround always worked, but if it's real it would affect first-time signups, which is a bad place for friction.

6. **Zero third-party integrations are live** (HubSpot, Salesforce, Slack, Gmail, Stripe, Zapier, Google Sheets, Calendly, Outlook, Linear, Jira, Notion, GitHub — all show "Coming soon" badges throughout the app). Not a bug — a known scope gap — but worth being explicit about in positioning/marketing since competing tools (Monday, ClickUp) already have these live. Not blocking for an "AI does the work natively inside AdeHQ" pitch, but real-estate/brokerage customers will likely ask for at least Google Sheets/Calendar and email (Gmail/Outlook) sync fairly early.

7. **PDF/DOCX/spreadsheet report templates are still generically SaaS/startup-shaped** for everything except the newly-flexible `investor_brief`-or-custom path fixed this session. `campaign_brief`, `market_research_report`, and `sales_outreach_brief` templates (in `src/lib/artifacts/templates/pdf/index.ts`) still hardcode headings shaped for a SaaS/startup audience (e.g. "Ideal Customer Profile", "Outreach Sequence") with no real-estate equivalents (e.g. a property listing brief, a comps/appraisal report, a lease abstract). The fix applied this session (spelling out required headings in the prompt + allowing the model to omit `template` and choose its own headings) mitigates this — verified working for a real-estate investment brief — but a dedicated real-estate template library would produce more consistently well-structured documents than relying on the model to freelance headings every time.

### Not yet tested (remaining scope from the original evaluation brief)

- **Phases 6-7 (artifacts, business simulation) — only PDF reports and DOCX specs were tested.** Spreadsheets (`artifact.createSpreadsheet`), presentations (`artifact.createPresentation`), and file conversion (`artifact.convertFile`) were fixed (employee-name/date bug) but never actually exercised end-to-end through a real chat request — worth doing before calling artifact generation fully verified.
- **Approvals workflow** — never tested asking an AI employee to do something that requires human approval (external send, billing action, etc.) and actually approving/rejecting it through the Approvals page.
- **Autopilot / multi-step autonomous runs** — several employee replies *offered* Autopilot ("Want me to run this autonomously?") but I never clicked through and ran one to completion to verify the autonomous engine works end-to-end.
- **Human-to-human and human-assigned-task workflows** — only AI-to-AI and human-to-AI interactions were tested. Assigning a task to a human teammate, human approval gates, and multi-human workspace scenarios are untested.
- **Other industries** (SaaS startup, marketing agency, law firm, recruitment agency, construction, e-commerce) — the original brief asked for these as a stretch goal via separate Launch Room topics once real estate was thoroughly covered. Not started.
- **Phase 10 (performance)**: no systematic latency measurement was done — scattered observations only (e.g., David Kim's memory-recall took ~12s, which felt slow for a lookup with no new research). A proper pass would time-to-first-token and time-to-complete across Fast/Balanced/Deep Thinking/Research modes for comparable questions.
- **Phase 11 (UX polish) sweep** — only friction points stumbled into during functional testing were logged (Suggested-topic panel overlap, no PDF inline preview, stale quota widget). A dedicated pass clicking through every page for empty states, loading states, and spacing/consistency issues hasn't been done.
- **Final scored deliverable** (Launch Readiness Score /100, ChatGPT/Slack/Monday comparison tables, "features users will love/complain about") from the original brief's "Final Deliverables" section has not been compiled — the audit log below is thorough but the executive-summary rollup is still outstanding.

## Interim summary (real, verified findings only)

**Strong first impressions:** login page, dashboard, DM composer, Tasks/CRM boards, and the 5-step Hire wizard are all visually polished — comparable to Linear/Notion-tier design, ahead of Slack/Teams on this axis.

**3 real, reproducible defects found (not hypothetical):**
1. **Critical — Realtime sync gap.** Tasks and CRM boards do not live-update when an AI employee creates a record via chat; a hard navigation is required to see it. Directly violates the "never require a refresh" bar.
2. **Critical (intermittent) — `team.coordinate` tool failures.** Pre-existing room history shows a raw `Invalid arguments for team.coordinate` error and a Sofia York message admitting "nothing was saved to your CRM, tasks, or Drive." I reproduced a *successful* run of the same kind of action right after, so the failure is intermittent, not 100% reproducible — still a trust risk since failures are silent/unretried by default (Retry button left unclicked in history).
3. **Critical for real-estate fit — Hiring wizard has no real-estate role vocabulary.** Asking for a "leasing agent" produced generic SaaS role suggestions (Software Engineer/EA/SDR) and a job brief that discarded my input entirely, defaulting to a templated "AI Employee / General business" brief with a grammar bug ("as a ai employee").

**1 positive AI-behavior finding:** Maya correctly declines out-of-scope questions instead of hallucinating an answer (good), but doesn't proactively route the user to the right teammate (a real EA would say "ask Sofia" — this is a missed "feels like a colleague" moment).

Continuing next: finish Phase 1 (logout/session persistence/hot-reload), Phase 2-3 proper DM benchmarks (pricing negotiation, market research, contract draft), Phase 4 launch-room CEO scenario from scratch, Phase 6 artifact generation, Phase 7 full business simulation, Phase 10-12 performance/UX/product-thinking pass, then compile final scored deliverable.

## New critical bug found + fixed: full-page crash on research replies (2026-07-10)

| 2026-07-10 | DM Sofia York (Product Manager, Research mode): "What's the current state of the US multifamily real estate market in mid-2026 — cap rates, transaction volume trends? I need this for an investor update." | Sofia researches and replies with cited data | **App crashed with a full-page Next.js error overlay**: `TypeError: Cannot read properties of undefined (reading 'replace')` at [MessageMarkdown.tsx:391](src/components/MessageMarkdown.tsx#L391) — `content.replace(...)` where `content` was `undefined`. Root cause: [RoomMessageItem.tsx:833-841](src/components/RoomMessageItem.tsx#L833) renders `MessageMarkdown` for a non-pending AI message before `message.content` has actually populated — a streaming/research race where `message.pending` flips to `false` a beat before the first token arrives. | **Critical** | Component's `content` prop was typed as required `string` with no runtime guard, so any transient nullish content during the pending→streaming handoff crashed the whole page (not just that message) | Widened the prop type to `string \| null \| undefined` and guarded the `.replace()` call with `(content ?? "")` in [MessageMarkdown.tsx](src/components/MessageMarkdown.tsx) | **Fixed, verified** | Reproduced reliably by asking any research-mode question. After the fix: reloaded and re-sent, Sofia's full researched, cited reply rendered correctly (cap rates, metro divergence, 9 numbered sources incl. arbor.com, cbre.com) with zero console errors. This is the kind of bug that would make a paying user think the product is fundamentally broken — a factual research question is exactly the first thing a real estate CEO would try. |

## Round 3 fixes: default tool access, artifact quality, PDF rendering (2026-07-10/11)

Per explicit product direction: every new hire should get all tools by default, artifacts should show the employee's name (not a raw ID) with a readable date, and AI-generated documents should be as thoughtful and complete as ChatGPT/Claude output — never leave visible blanks.

1. **All internal capabilities granted by default on hire** — [map-candidate.ts](src/lib/hiring/map-candidate.ts) and the legacy-employee self-heal path in [permissions.ts](src/lib/integrations/permissions.ts) now grant every internal capability (CRM, email, tasks, drive, artifacts, calendar, investors, teamwork) with write permission at hire time, instead of only the role's "suggested" subset (which is how Elena ended up without CRM access in the first place). The "Suggested" badges in the Tools & capabilities panel are untouched — they still guide the user, but no longer gate default access. Verified via a standalone script instantiating `candidateToEmployee()`: all 7 capabilities present with write permission.

2. **"Generated by {raw employee id}" → real name + readable date** — root cause: `ToolExecutionContext.employeeName` was computed but dropped when a tool call got queued as an async job ([tool-executor.ts](src/lib/integrations/executor/tool-executor.ts)); every artifact handler (PDF, DOCX, presentation, spreadsheet, convert-file, save-to-drive — 7 handlers in [artifact-handlers.ts](src/lib/integrations/jobs/artifact-handlers.ts)) then fell back to the raw `employeeId` and a raw ISO timestamp. Fixed by threading `employeeName` through the job payload (with a DB-lookup fallback for jobs enqueued before this change) and formatting the date for humans. Verified live: a freshly generated report now reads "_Generated by Elena Rossi · July 11, 2026_" instead of "_Generated by emp_mrebkkg39670o1j · 2026-07-10T21:19:11.138Z_".

3. **PDF reports with blank sections ("—")** — root cause: `padSections()` in [pdf/index.ts](src/lib/artifacts/templates/pdf/index.ts) forced every chosen template's required headings into the output, replacing any heading the model didn't write with a literal `"—"`, and silently discarded any content the model wrote under a non-matching heading. The model also had no idea which exact headings a template required. Fixed three ways: the tool's `promptUsage` ([tool-definitions.ts](src/lib/integrations/registry/tool-definitions.ts)) now lists the exact required headings per template and instructs the model to write real content for every one of them (or omit `template` entirely and pick its own headings when nothing fits, e.g. a real-estate deal brief instead of a VC-style "investor_brief"); `padSections()` no longer manufactures "—" placeholders (a heading the model skipped is just left out rather than shown half-blank) and now preserves any extra sections the model wrote instead of discarding them.

4. **Root infra bug behind the sparse PDF**: Playwright's Chromium wasn't installed in the dev environment, so `buildHtmlPdfBuffer` was silently falling back to a bare-bones single-page text PDF (1.0 KB, no styling) — this is what actually made the earlier report look "weak," compounding the missing-section bug above. Chromium is now installed; verified with a standalone script (renders in ~1s) and live in-app (new PDF is 111.2 KB vs the old fallback's 1.0 KB).

**Combined live verification**: asked Elena Rossi (Launch Room) to generate an investor brief for a real deal (Riverside Commons, $7.55M, 1031 exchange). Result: a genuinely well-written, complete 4-section brief (Thesis / Target List Summary / Outreach Plan / Next Steps, each several sentences of real analysis, not placeholders), correctly attributed to "Elena Rossi" with a human-readable date, rendered as a real 111.2 KB styled PDF and saved to Drive. This is the standard the product should hit going forward — confirmed working end-to-end, not just in isolation.

**Scope note on the broader UI/UX request**: the direction to "make the UI beautiful with animations" is intentionally not addressed with sweeping changes in this pass — the existing dashboard/DM/artifact UI is already well-designed (dark hero panels, clean cards, consistent spacing), and blind CSS/animation changes without a design-system reference risk visual regressions more than they help. Concrete friction points found and worth a follow-up pass: (a) the "Suggested topic" panel can visually block the composer/recent messages mid-conversation, (b) generated PDFs have no in-app inline preview (forces a download to view), (c) Drive's storage-quota widget didn't reflect newly-saved exports in testing. Flagging these rather than guessing at fixes blind.

## Fixed: raw internal tool-call JSON leaking into chat + raw abort errors (2026-07-11)

**Root cause 1 (the JSON leak), found via investigation, not guessed**: messages needing tool calls get routed to one of two response paths — a blocking "structured" path (real `effects.toolCalls`, actually executes tools) or a streaming "plain prose" path (raw token-by-token streaming, hardcodes empty effects, cannot call tools at all). The routing heuristic in [message-intent.ts](src/lib/ai/message-intent.ts) that decides which path a message needs matched on verbs like "draft" but its noun list was missing "spec"/"specs" (and a few other common nouns) — so "draft a product **spec**" fell through to the streaming path. Worse, the streaming path's system prompt still included the standard role-workflow instructions telling the model to "use effects.toolCalls" (a direct contradiction with the streaming path's own "never output JSON/effects" instruction) — so the model narrated the tool call as prose instead, and since streaming pushes raw deltas to the screen before any sanitization runs, the raw `effects.toolCalls: tool: artifact.createDocx ...` text became visible to the user in real time.

**Fix**: (1) added "spec(s)"/"specification(s)"/"workbook(s)"/"presentation(s)" to the routing noun regex in [message-intent.ts](src/lib/ai/message-intent.ts) so these messages correctly route to the tool-capable structured path; (2) removed the contradictory tool-routing instructions from the streaming path's prompt entirely and replaced them with an explicit "you cannot call tools in this mode, don't narrate one, don't claim the action will happen" instruction in [prompts.ts](src/lib/ai/prompts.ts) — so even if a future message still slips through the routing heuristic, the model won't be told to do something structurally impossible.

**Root cause 2 (raw error messages)**: request timeouts throw a raw `AbortError` whose message is the literal string "This operation was aborted" — [provider-errors.ts](src/lib/ai/provider-errors.ts) had no branch for this, so it passed through unchanged, and [model-router.ts](src/lib/ai/model-router.ts) wrapped it in a generic "check your provider API keys" message that's actively misleading for a timeout (nothing wrong with the keys). Fixed: `formatProviderError` now recognizes abort/timeout errors and returns a clean "took too long to respond and timed out" message; `model-router.ts` shows a friendly "That took longer than expected — want me to try again?" instead of the raw reason + misleading keys hint when it detects a timeout.

**Verified live**: re-sent the exact scenario that originally leaked ("draft a one-page product spec doc...") — no more raw JSON in the chat. The employee now either completes the work normally or, if the underlying tool call genuinely fails, gives the honest "I wasn't able to complete those actions" fallback (from the earlier fabrication-guard fix) instead of a garbled leak. `tsc --noEmit` clean.

**New finding surfaced while verifying (not yet fixed)**: server logs show a *separate*, real bug in a background "topic summary" generator (`generateTopicSummaryPayloadOld` in [topic-summary/generate.ts](src/lib/topic-summary/generate.ts)) — it's producing malformed/truncated JSON because the model gets stuck in a repetition loop (the same `[msg_xxxx]` citation tag repeated ~80+ times in a single field until it hits the output token limit and the JSON is left unterminated), causing `AI_NoObjectGeneratedError` and burning ~1400 output tokens on garbage every time it fires. This is a silent background feature (topic auto-summary), not directly blocking chat replies, but it's wasting real token spend and firing repeatedly (`[AdeHQ topic summary old path] [DOMException [TimeoutError]...` appears many times in the logs). Flagging for a follow-up fix — likely needs either a stricter max-tokens/stop-sequence guard or de-duplication of citation tags before they're fed back into the next summary regeneration prompt (the repeated `[msg_id]` pattern looks like citation tags accumulating across repeated summary regenerations without being deduplicated).

## CRITICAL: raw internal tool-call JSON leaking into chat (2026-07-10/11)

| 2026-07-11 | Business simulation: asked Sofia York (Product Manager) + Elena Rossi to build an internal deal-tracker product spec and hand off for review, in the Launch Room | Sofia's reply stays conversational; tool calls execute silently and surface as nice cards (like Elena's CRM/task cards did in earlier tests) | **The raw internal `effects.toolCalls` payload leaked verbatim into the visible chat message** — the user-facing reply literally contained `effects.toolCalls: tool: artifact.createDocx mode: execute args: title: "Deal Tracker Product Spec" template: "business_brief" ... tool: team.coordinate ... tool: tasks.createTask ...` as raw text, followed by a red "Actions not completed — Nothing was saved to CRM, Tasks, or Drive" banner (the described actions never actually ran). Immediately after, a different employee (Elena Rossi) replied with a raw internal error instead of an answer: "I couldn't complete a live model response right now. Reason: This operation was aborted. Check Settings → AI Runtime to verify provider keys and model configuration." | **Critical** | Under investigation (background agent dispatched) — hypothesis: the model's structured-output parsing has a fallback that displays raw unparsed text (including the tool-call block) when parsing fails, and/or the model is being prompted to describe `effects.toolCalls` in a way that leaks into free text instead of using true structured tool-calling | TBD | Open — investigating | This is the single worst thing I've seen in this entire audit for the stated goal ("AI does workflows invisibly, conversationally, like ChatGPT/Claude") — a real user seeing raw internal JSON/error internals in the middle of a business conversation is an immediate trust-breaker, far worse than a missing feature. Prioritizing this fix above further business-simulation testing. |

| 2026-07-11 | Same collaboration scenario, continued: Sofia correctly declined the market-research ask (not her lane), named David Kim as the right owner once data exists, and asked a good clarifying question — genuinely excellent, professional handoff behavior. BUT Elena Rossi (who wasn't the one handed the research task) AND David Kim both independently answered the SAME market-research question with nearly word-for-word identical content (same cap rate figures 4.5-6.0%, same rent growth stats, same 5 sources) | One employee (the one actually asked, or the one handed off to) answers; others stay silent or build on it | Two employees produced near-duplicate, independently-researched answers to the same question in the same turn — real redundant work (2x research cost) and a confusing UX (which answer is authoritative?) | Medium-High | No coordination/locking mechanism preventing multiple employees from independently deciding to answer the same @mention-free ambient question; each employee's own "should I respond" logic fired independently without checking if a teammate already claimed it | Add a "claim" signal — first employee to start responding to an ambient (non-@mentioned) question should suppress others from also answering the identical question in the same turn, or have employees check recent messages before responding to avoid duplicating a teammate's in-flight answer | Open | This is exactly the "duplicate work / redundant responses" risk flagged in the original brief's Phase 5 criteria. Sofia's handoff behavior itself was excellent (a real positive) — the bug is that her handoff didn't actually prevent Elena from also jumping in with a full duplicate answer. |

## AI employee behavior notes (2026-07-10, post-fix testing)

| 2026-07-10 | DM Elena Rossi: "Can you generate a one-page investor brief PDF summarizing the downtown luxury development opportunity?" (no numbers given yet) | Either asks for missing specifics or generates a generic placeholder | Correctly asked a clarifying question — offered to start from a memory template or wait for real numbers, plus an Autopilot offer to gather details autonomously. No fabrication. | N/A (positive) | - | - | Pass | Good judgment — didn't invent numbers to fill the brief. |
| 2026-07-10 | Supplied real numbers (40-unit, $18M cost, $2.2M NOI, 14-month timeline), asked to generate the PDF | Real artifact created in Drive with the given numbers | Genuinely created "40-Unit Luxury Apartment — Investment Brief" in Drive with a correct Summary section reflecting the exact figures given. BUT "Thesis" and "Target List Summary" sections rendered as empty "—" placeholders. | Medium | The `artifact.createPdfReport` template used ("investor_target"-style) has fields shaped for VC/investor-prospecting briefs (Thesis, Target List Summary, Outreach Plan), not a real-estate property investment brief (would want: property specifics, cap rate/ROI, comps, risk factors) | Add a real-estate-specific PDF report template (or a generic "property brief" template) alongside the investor-target one, and have template selection consider business vertical/domain, not just document type | Open | Positive: the artifact pipeline itself is genuinely real (verified in Drive, correct numbers, not fabricated) — this is a content-template vertical-fit gap, the same class of issue as the Hire wizard's generic-role fallback. Reinforces a pattern: AdeHQ's workflows are correct but its content templates default to generic SaaS/startup shapes rather than adapting to the customer's actual industry. |

| 2026-07-10 | DM David Kim: "Remind me — what was our walk-away number on that deal again, and what did we agree the seller's floor probably was?" (no restated context) | Recalls specific figures from earlier negotiation memory | Correctly answered with specific numbers: "$1.35M as our walk-away... seller's floor was likely around $1.15M–$1.2M... about $150K–$200K of room." ~12s round trip (Balanced mode) | N/A (positive finding) | Memory/context retrieval working as intended | - | Pass | Genuine context recall, not a generic non-answer — reads like a real colleague who remembers the deal. Latency (~12s) is on the slow side for a memory-lookup question with no new research required; worth comparing against ChatGPT's near-instant recall in Phase 10 performance pass. |

## Fixes applied (2026-07-10, same session)

All 3 bugs found above were root-caused and fixed, then verified live in the browser with two-tab tests (create in tab A, watch tab B update with zero manual refresh). Full typecheck (`tsc --noEmit`) passes clean across the whole project after all changes.

1. **Hiring wizard generic fallback + grammar bug** — [brief-synthesis.ts](src/lib/hiring/brief-synthesis.ts) and [role-title-synthesizer.ts](src/lib/hiring/role-title-synthesizer.ts). Added an a/an article helper (fixes "as a ai employee" → "as an AI employee"), and extended the role-title extraction to recognize "agent/coordinator/officer/assistant/associate" suffixes and pull a short noun-phrase out of a full sentence instead of only matching ≤4-word inputs. Re-tested the exact original prompt ("I need a leasing agent who can screen tenant applicants...") — Maya now says "I'll treat this as a Leasing Agent role" with role-relevant chips (Leasing tours, Lease paperwork, Tenant inquiries), and the draft brief title is "Leasing Agent" with a grammatically correct mission line. **Fixed, verified.**

2. **`team.coordinate` tool argument hydration gap** — [hydrate-tool-args.ts](src/lib/integrations/hydrate-tool-args.ts) and [coerce-tool-args.ts](src/lib/integrations/coerce-tool-args.ts). Added a hydration case that backfills `message` from the triggering chat message when the model omits it, plus alias mappings (`note`/`text`/`instruction`/`ask`/`content` → `message`) so near-miss key names from the model don't hard-fail schema validation. **Fixed** (root cause addressed); note the *specific* failure I reproduced live turned out to be a separate, legitimate permission gate ("Elena Rossi does not have the crm capability enabled") with a clear, actionable error message — which is correct behavior, not a bug.

3. **Tasks/CRM boards required a hard refresh to show new AI-created records** — root cause was actually two stacked issues, both fixed:
   - **Missing realtime publication**: only `browser_research_runs` and `messages` were ever added to the `supabase_realtime` Postgres publication; `tasks`, `crm_contacts`, `crm_companies`, `crm_deals`, etc. never were, so `postgres_changes` subscriptions silently received nothing. Fixed via new migration [20260710130000_realtime_publication_workspace_tables.sql](supabase/migrations/20260710130000_realtime_publication_workspace_tables.sql), applied to the live "AdeHQ" Supabase project with explicit user confirmation. Also added the CRM tables to `SUPABASE_WORKSPACE_TABLES` ([supabase/config.ts](src/lib/supabase/config.ts)) and gave the CRM page its own realtime subscription ([crm/page.tsx](src/app/(app)/crm/page.tsx)) mirroring the existing Tasks-covering global subscription.
   - **Bigger, previously-undiagnosed root cause**: the browser was caching `fetch()` GET responses to `/api/crm` (and, via the shared Supabase client, likely other reads too) indefinitely, because neither the CRM client ([crm/client.ts](src/lib/crm/client.ts)) nor the global Supabase client ([supabase/client.ts](src/lib/supabase/client.ts)) set `cache: "no-store"`. This was proven decisively: a service-role DB query showed rows that the authenticated app UI never displayed, even minutes later and after hard navigations; forcing `cache: "no-store"` on the same fetch immediately returned fresh data. This is a more severe bug than my original "no realtime subscription" diagnosis — it meant even a manual page reload could serve stale data indefinitely on a given browser tab. Fixed by adding `cache: "no-store"` to the CRM fetch and wrapping the shared Supabase client's fetch globally.
   - **Verified live**: two-tab test — created a CRM contact in tab A, tab B (never touched) updated from 3→5 contacts within ~2 seconds with no reload. Same test for Tasks: created a task via the UI in tab A, tab B updated 2→3 tasks live. Test data cleaned up afterward.

## Fixed: AI-driven CRM writes silently fabricating "Success" (2026-07-10, follow-up session)

**Root cause** (found via deep investigation, not guessed): the `pm` role's system prompt in [prompts.ts](src/lib/ai/prompts.ts) never instructed the model to route CRM/task/artifact actions through real `effects.toolCalls` — unlike `sales`/`marketing`/`fundraising`, which had explicit tool-routing rules. A PM-persona employee (Elena Rossi) asked to "add a CRM contact" had no instruction pointing it at `crm.createContact`, so the model did the next best thing: it fabricated a plausible `effects.workLog` entry (`crm_contact_created`, `status: success`) which gets inserted **verbatim, with no verification against any real tool result**, straight into the visible activity timeline. The honesty guardrail (`reconcileClaimedActions`) didn't catch it because it only checks whether *any* real effect happened in the turn (a blanket OR across tool calls/tasks/memory/etc.) — it never correlates a *specific* claimed action against a *specific* real result, so an unrelated real memory/task write in the same turn was enough to make the false CRM claim slip through as "produced real effect."

**Fix — two layers:**
1. **Prompt fix** ([prompts.ts](src/lib/ai/prompts.ts)): added explicit `effects.toolCalls` routing instructions to the `pm` role (mirroring `sales`) and to the generic `default` role fallback (covers `engineering`/`design`/`gamedev`/`operations`/`support`, which had the identical gap). Added a new universal `toolClaimHonestyRule()` block, included for every role, stating plainly: never describe a tool-backed action as done unless the matching tool call actually succeeded; say so honestly if you don't have the tool.
2. **Structural safety net** ([reconcile-claimed-actions.ts](src/lib/integrations/reconcile-claimed-actions.ts), [room-messages.ts](src/lib/server/room-messages.ts)): don't just rely on the prompt. Added `TOOL_BACKED_WORK_LOG_ACTIONS` — the canonical list of `workLogAction` values real tool adapters emit on success (`crm_contact_created`, `task_created`, `investor_firm_created`, etc., sourced directly from the adapters, not guessed). Before any `effects.workLog` entry is inserted into `work_log_events`, it's now checked: if its `action` is in that list but wasn't backed by a matching successful tool result *this turn*, it's dropped (never shown as a fake "Success" row) and counted as a `fabricatedToolClaimCount`. That count now overrides the honesty guardrail's "any real effect happened" logic — a fabricated CRM claim is corrected even if the same turn also wrote a legitimate memory note or unrelated task.

**Verified live**: re-sent the original failing request to Elena Rossi ("Add a CRM contact for investor lead David Chen..."). New behavior: she replied honestly that she doesn't have direct CRM access, created a real task ("Add David Chen to CRM as investor lead", High priority, correctly assigned to her and visible on her profile's "Assigned tasks"), and saved a memory note — and the activity timeline shows this new entry as **"Pending"**, not a fabricated "Success." Old pre-fix fabricated entries ("Elena Rossi created contact — Added Marcus Chen... Success" / "Added Priya Sharma... Success") remain visible in the timeline as a clear before/after comparison — those contacts were confirmed via a direct DB check to have never existed.

**Test coverage**: added a regression test to [scripts/test-claimed-actions-guardrail.ts](scripts/test-claimed-actions-guardrail.ts) ("fabricated tool-backed workLog claim is corrected even alongside other real effects"). Full suite (14 tests) + the pre-existing Tool Execution Core suite (12 tests) both pass. `tsc --noEmit` clean across the whole project.

**Remaining/out of scope**: `recruiting_manager` (Maya) and `research` roles weren't audited line-by-line for the same gap beyond what's covered by the new universal honesty rule — worth a follow-up pass if any similar fabrication shows up in Maya's hiring flow specifically. Three now-legitimate test tasks ("Add David Chen to CRM as investor lead", "Follow up with Marcus Chen...", "Loop Priya Sharma...") remain in the live Tasks board from this round of testing — clean up via the UI whenever convenient.

## Fixed: Bug H — CRM/tool-call requests hanging/failing outright (2026-07-11)

**Symptom** (originally logged in `docs/ai-workforce-realestate-test-report.md` as "Bug H"): any request that needed the model to emit real `effects.toolCalls` (CRM writes, task creation, artifact saves) would stall for 100+ seconds and then fail, even for a single simple action. Previously hypothesized as the same DeepSeek "hidden reasoning tokens" mechanism as Bug D (`enable_thinking` not being honored), left as the top-priority open investigation.

**Actual root cause, precisely identified and reproduced** — it is a different bug, not Bug D recurring. `ToolCallEffectSchema.args` and `ArtifactEffectSchema.contentJson` (in [schemas.ts](src/lib/ai/schemas.ts)) are `z.record(z.string(), z.unknown())` — an intentionally open-ended object. When the AI SDK (`@ai-sdk/provider-utils`) converts this zod schema to JSON Schema for a strict `generateObject` call, its `addAdditionalPropertiesToJsonSchema` post-processor blindly forces `additionalProperties: false` onto *every* object node in the schema — including that record — producing a JSON Schema that literally forbids the model from ever including a key/value pair in `args`. Under SiliconFlow's strict `json_schema` structured-output mode (constrained decoding), asking the model to populate `args` with real data (exactly what every CRM/task/artifact tool call requires) creates an unsatisfiable grammar constraint: the response either hangs indefinitely or burns its entire token budget failing to reconcile it. This is a structural JSON-schema-conversion bug, not a model- or thinking-mode-specific one — it would break under *any* provider that enforces strict JSON-schema structured output.

**Reproduced directly**: a raw API call using the exact JSON schema our code generates from `ModelResponseSchema`, with a normal "add a CRM contact" prompt, hung with zero response for 90+ seconds. Patching just the `args` field's schema to allow `additionalProperties: true` made the identical request return correctly in 3.3s. Confirmed the same hang through the actual production code path (`generateObject` via `siliconFlowChatModel` + `ModelResponseSchema`) before the fix.

**Fix — four changes:**
1. New shared helper [json-mode-object.ts](src/lib/ai/runtime/adapters/json-mode-object.ts) (`generateObjectViaJsonMode`): asks for loose JSON (`response_format: json_object` where supported) instead of strict schema mode, then validates client-side with the real zod schema — which has no restriction on `z.record()` fields. Includes one bounded repair pass: if validation fails because the model echoed a placeholder value into an optional field (observed with DeepSeek copying the prompt's `"objective": "..."` example verbatim as `""`), it drops the smallest containing object and re-validates once rather than rejecting an otherwise-correct response.
2. [runtime/adapters/siliconflow.ts](src/lib/ai/runtime/adapters/siliconflow.ts) and [runtime/adapters/vercel-gateway.ts](src/lib/ai/runtime/adapters/vercel-gateway.ts): `generateObject()` accepted a `preferJsonMode` flag in its params type but silently ignored it — every caller that already opted in (`employee-queued-runtime.ts`, `employee-direct-runtime.ts`, the topic-summary runtime path) was still routed through the broken strict mode. Now wired to actually use `generateObjectViaJsonMode` when set.
3. [structured-llm-call.ts](src/lib/ai/structured-llm-call.ts): tier 1 (strict `generateObject`) is now skipped entirely when `preferJsonMode` is set, going straight to the working tier 2 (`json_object` + parse). Also fixed a second, compounding bug found in the same function: all three fallback tiers shared one `AbortController`/timer, so once tier 1 burned the full timeout, tiers 2 and 3 received an already-aborted signal and failed instantly — defeating the fallback chain's entire purpose. Each tier now gets its own fresh `AbortSignal.timeout(...)`.
4. [autonomy/brain.ts](src/lib/autonomy/brain.ts): `AutonomyDecisionSchema.toolCalls[].args` has the identical `z.record()` shape and was calling `generateObject` without `preferJsonMode` at all — the autonomous-employee engine had the exact same latent hang waiting for its first real tool call. Added `preferJsonMode: true`.

**Verified live** (via the real runtime code path, not a mock): "add a CRM contact for John Smith... also create a follow-up task" now returns in ~4-12s (previously hung 90s+/timed out) with a correctly populated `effects.toolCalls` (`crm.createContact` with real `firstName`/`email`/`phone`/etc.) and `effects.tasks` entry, on the primary model (`deepseek-ai/DeepSeek-V4-Flash`) rather than falling back to a slower model. Repeated 5 times for consistency; all passed. `tsc --noEmit` clean across the whole project.

**Note on Bug D**: separately re-verified that the existing `enable_thinking: false` override for DeepSeek/Qwen/MiniMax (in [siliconflow-client.ts](src/lib/ai/siliconflow-client.ts)) does work correctly, including for `generateObject`/strict-schema calls with schemas that don't contain `z.record()` fields (e.g. the topic-summary generator) — 0 reasoning tokens, fast. Bug D's fix was already correct; Bug H was a distinct bug that happened to be observed alongside it.

## Fixed: topic-summary repetition loop burning tokens on every message (2026-07-12)

**Symptom**: `generateTopicSummaryPayloadOld` would repeatedly fail with a truncated/unparseable JSON response (a citation tag repeated ~80+ times inside one field until `finishReason: "length"`), burning ~7000 tokens per attempt, and fire again on essentially every subsequent AI reply in the topic.

**Root cause, two separate issues:**
1. **No backoff after a failed auto-refresh.** `refreshTopicSummary` ([refresh.ts](src/lib/topic-summary/refresh.ts)) only skips a refresh when `existing.lastRefreshedAt` is recent (`TOPIC_SUMMARY_AUTO_COOLDOWN_MS`) — but that timestamp is only set on a *successful* save. A generation failure returns early without ever touching it, so every later `meaningful_ai_reply` trigger (fired after nearly every AI message, see `process-queued-run.ts`) re-attempted the exact same failing generation immediately, with zero backoff. This — not the degenerate output itself — is what made it "fire repeatedly."
2. **No mitigation for the underlying token-repetition degeneracy.** The schema had no length caps and the generation call set no `frequency_penalty`/`presence_penalty`, so a model that started repeating a short tag had nothing stopping it until the token budget ran out.

**Fix:**
1. [refresh.ts](src/lib/topic-summary/refresh.ts): added a `generationFailed` signal (threaded through [generate.ts](src/lib/topic-summary/generate.ts)'s `GeneratedTopicSummaryPayload`, distinct from a genuinely casual conversation) and a per-process, in-memory failure-cooldown map (`TOPIC_SUMMARY_FAILURE_COOLDOWN_MS`, 3 min) keyed by workspace+topic. A failed auto-refresh now backs off for that topic instead of retrying on every message. (Best-effort — not persisted, since a schema migration needs separate user sign-off — but still closes the "fires on every single message indefinitely" failure mode within a running server instance.)
2. [generate.ts](src/lib/topic-summary/generate.ts): added `.max()` length caps to all the free-form string fields in `summarySchema` (title/text ~240 chars, summary/whatHappened ~1200 chars) so a runaway field fails validation fast instead of silently consuming the whole output budget. Also added modest `frequencyPenalty`/`presencePenalty` (0.4/0.2) to both the legacy and Runtime V2 generation calls — the standard mitigation for token-repetition degeneracy — threaded through `RuntimeGenerateObjectParams` and both runtime adapters (`siliconflow.ts`, `vercel-gateway.ts`) and the new `generateObjectViaJsonMode` helper from the Bug H fix.

**Verified**: `tsc --noEmit` clean. Confirmed live in the browser that topic summaries continue to regenerate normally after real messages (no regression), rendering the same "Brief summary / Key facts / Next actions" panel as before.

## Fixed: duplicate AI responses to the same ambient question (2026-07-12)

**Symptom**: two employees (e.g. Elena Rossi and David Kim) independently produced full, near-duplicate answers to the same ambient (non-@mentioned) question in one turn — real token waste and confusing "which answer is authoritative" UX.

**Root cause, precisely identified** (not the originally-guessed "each employee decides independently" — the room steward *is* a single, centralized classification call): [legacy-adapter.ts](src/lib/orchestration/legacy-adapter.ts)'s `orchestrationPlanToLegacyResult` only serializes a multi-employee response (queue the lead, defer the rest with `dependsOnRunId` + the lead's actual reply injected as context) for a hardcoded allowlist of intents (`leadOnlyModes`). `offer_help` — a real intent that can select a lead + collaborators — was missing from that list, so whenever the steward classified an ambient question as `offer_help` with more than one candidate employee, every one of them was queued **simultaneously with no dependency and no visibility into each other's answers**, relying entirely on a soft prompt instruction to avoid duplicating — which the model doesn't always follow. Separately, [room-steward.ts](src/lib/orchestration/room-steward.ts)'s `task_request`/`direct_question` branch could select 2-3 employees in `active_team` mode but never remapped the intent to `multi_employee_collaboration` the way its sibling `ask_for_opinion` branch already did — an intent/selection mismatch.

**Fix:**
1. [legacy-adapter.ts](src/lib/orchestration/legacy-adapter.ts): replaced the hardcoded `leadOnlyModes` allowlist with the inverse — an explicit, short list of intents where simultaneous multi-employee firing is the *intended* behavior (`social_broadcast`, `social_ack` — group greetings/acks). Every other intent with more than one responder is now serialized by default, so a newly-added or previously-missed intent (like `offer_help`) can't silently reopen this gap again.
2. [room-steward.ts](src/lib/orchestration/room-steward.ts): the `task_request`/`direct_question` branch now remaps to `multi_employee_collaboration` when more than one employee is selected, mirroring the existing `ask_for_opinion` branch.

Traced the full downstream path to confirm no further changes were needed: `queueCollaboratorRuns` ([queue-follow-up-runs.ts](src/lib/server/queue-follow-up-runs.ts)) and the collaborator prompt instructions ([prompts.ts](src/lib/ai/prompts.ts), "do not repeat X's points" / "do not redo their analysis") are already intent-agnostic and apply correctly to the newly-covered case.

**Verified**: `tsc --noEmit` clean.

## Added: tool-call retry/recovery UX (2026-07-12)

**Symptom**: when a tool call failed or an employee's whole reply failed/produced nothing real, there was no in-place retry button — only a text suggestion ("ask again to retry") requiring the user to manually retype the request — and no clear signal when some actions in a turn succeeded while others failed.

**What already existed** (found while investigating, not previously documented): [ToolResultInlineCard.tsx](src/components/integrations/ToolResultInlineCard.tsx) already has a working retry button for a single *specific* failed tool call that has `retryArgs` populated (e.g. the exact `team.coordinate` failure logged earlier in this file). The gap was everywhere else: the generic "Actions not completed" chip built by the honesty guardrail when the model narrated an action without ever calling the tool, a whole-batch tool-execution exception, and a total model-call failure (the "I couldn't complete a live model response right now" case) all had no `toolName`/`retryArgs` and so never rendered a retry affordance at all.

**Fix:**
1. New `retryKind: "tool_call" | "employee_reply"` field on `MessageArtifact.meta` ([types.ts](src/lib/types.ts)) — the existing per-tool retry stays `"tool_call"`; a new `"employee_reply"` kind means "regenerate the whole turn," used when nothing narrower can be retried.
2. New endpoint [`POST /api/messages/[messageId]/retry-response`](src/app/api/messages/[messageId]/retry-response/route.ts): queues a fresh `agent_runs` row for one employee against the original trigger message, reusing the exact same `queueAgentRuns` machinery a normal incoming message uses — no new response-generation pipeline needed.
3. Marked the three generic failure surfaces with `retryKind: "employee_reply"` + the trigger message id: [reconcile-claimed-actions.ts](src/lib/integrations/reconcile-claimed-actions.ts)'s fabricated-claim and no-op notices, [room-messages.ts](src/lib/server/room-messages.ts)'s whole-batch tool-execution catch, and a new check in `persistEmployeeEffects` for the "Model error" workLog entry model-router.ts's whole-turn failure path already logs. Also fixed the fabricated-claim reply text to stop claiming "nothing was saved" when other real effects *did* succeed in the same turn (it now says so honestly instead of contradicting a success card shown right below it).
4. [ToolResultInlineCard.tsx](src/components/integrations/ToolResultInlineCard.tsx): the Retry button now branches on `retryKind` — the existing single-tool-call path is untouched; the new path calls the retry-response endpoint, processes the queued run via the existing `/api/agent-runs/[runId]/process`, and inserts the resulting reply as a new message (idempotent — the store already dedups by message id, which matters because the room's own background poller can win the race and process the run first; handled explicitly rather than surfacing that as a false "Retry failed").

**Verified live** (real app, not mocked): reproduced the exact CRM-permission-blocked scenario ("add CRM contact" for an employee without CRM access) and confirmed the reply now correctly says "Some actions failed — see the cards below" alongside a real "Task created" success card, instead of a blanket false-negative message. Drove the new retry endpoint directly (authenticated session) end-to-end: queued a fresh run, confirmed the app's own polling picked it up and processed it automatically, and the resulting new Elena Rossi message rendered correctly in the room with its own success/blocked cards. `tsc --noEmit` clean across the whole project.

**Note**: test data from this and prior verification passes (a few CRM-blocked attempts and "Call Jordan Lee" tasks in the Launch Room) remains in the workspace — clean up via the UI whenever convenient, per existing convention in this file.

## Added: human-to-human and hybrid calling (2026-07-21)

Implemented the canonical human/hybrid call state machine, atomic multi-device
acceptance, participant leases, in-app and Web Push ringing, Cloudflare Realtime
SFU media proxy, 1:1 audio/video/screen share, group-huddle API, consented AI
sidecar/spoken turns, live transcript chunks, Work Graph call artifacts, quality
telemetry, optional P2P optimization, and TURN/force-relay configuration.

Completion slices also add notification health/test push, 30-day reliability
aggregates, adaptive video bitrate, hot device switching, all-participant consent,
silent observer notes, transcript-to-summary/decision/task outcomes, AI-only WH
receipts, private sidecars that do not publish room messages, push-to-talk, barge-in,
background delegation, a single-spokesperson expert council, and private recording
storage with signed downloads, retention cleanup, and owner/admin deletion.

**Verified**:
- Linked Supabase migration `20260721160000_human_hybrid_calls.sql` applied.
- Production build and TypeScript compile passed.
- Static call invariants passed.
- TypeScript and IDE diagnostics are clean after PR-18.2A-G.
- Chromium compatibility probe passed. Firefox and WebKit probes are implemented
  but their Playwright browser binaries were unavailable locally; release gating
  fails closed with `CALL_BROWSER_REQUIRE_ALL=1`.
- Live Cloudflare Realtime test created a session, published audio, subscribed to
  the track, renegotiated, and received an audio echo.
- Repeatable two-user API E2E passed create, idempotent replay, invitation,
  one-device-wins acceptance, leases, consent, artifact creation, end, and cleanup.

Web Push remains best-effort and requires an installed Home Screen app on iOS.
Strict encoded-frame E2EE remains incompatible with server-side AI participation;
SFU calls are not represented as participant-to-participant E2EE.

## Added: Maya Workforce Studio — team composer, simulation, provisioning (2026-07-22)

Implemented the "Team" hire mode end to end (PR-21A–E): a Company Operating
Profile, a modular/governed template engine (Software House, SaaS Startup,
General Ops) with JsonLogic scaling rules, a three-pane Workforce Canvas
(React Flow) plus a structured Roster editor with mobile/tablet fallback and
full keyboard/a11y support, an `AuthorityMatrixEditor` covering all 11
capability domains, "Simulate a Week" (coverage/permission gaps + Work Hours
forecast with a per-capability breakdown), draft locking + optimistic
concurrency + autosave conflict recovery + undo/redo, natural-language
"Ask Maya" blueprint edits with reviewable diffs, canonical-hash approval
freezing, and an idempotent/checkpointed/compensable bulk-hire provisioning
saga that ends in a First Mission (welcome messages, outcome tasks, Team
Charter + Role Scorecard artifacts). Full design: [`docs/architecture/workforce-studio.md`](../architecture/workforce-studio.md).

**Bug found + fixed during PR-21E hardening — NL-edit "outcome" requests
silently dropped.** The combined NL-edit schema (`summary` +
`addOutcomes`/`addSeats`/`removeSeatIds`/`updateSeats` in one `generateObject`
call) reliably failed a clear, in-scope instruction like *"Add an outcome:
ship weekly releases with less than 3 days lead time"* — SiliconFlow's
structured-output path would narrate "added the outcome" in `summary` while
leaving `addOutcomes: []` and instead writing a no-op `updateSeats` entry
(setting a random seat's seniority to its own current value). Reproduced 100%
across ~15 consecutive runs; ruled out timeout/token-budget causes
(`finishReason: "stop"`, near-zero reasoning tokens every time) and iterated
through schema field reordering, removing a `.default()` on a nested enum,
`.describe()` annotations, and a stronger model tier — none of which fully
resolved it. Root-caused to field competition in one large schema, not prompt
wording: added a cheap keyword-only dispatch (`looksOutcomeOnly`, no LLM call)
that routes unambiguous outcome-only instructions to a dedicated minimal
schema (`nlOutcomeOnlySchema` — just `summary` + `addOutcomes`) instead of the
combined one. Verified 3/3 clean full-suite runs after the fix (0 flaky
failures) via `npm run test:workforce-studio:promptfoo`. Also fixed along the
way: the internal LLM race timeout was a hardcoded 12s against real observed
SiliconFlow structured-output latency of 15–45s+ (silently declining nearly
every request); raised to the catalog's `"strong"`-tier budget (60s), the API
route's `maxDuration` raised above that, and switched the NL-edit model tier
from `"balanced"`/`"cheap"` to `"strong"` after confirming the cheaper tier
was *both* slower and less reliable on this schema in this environment.

**Verified**:
- `npm run test:workforce-studio:composition` — template structure, JsonLogic
  rule safety, deterministic composition, canonical hash: all pass.
- `npm run test:workforce-studio:provisioning` — full lifecycle, forced-failure
  compensation rollback, retry-after-failure with no duplicate resources, and
  an explicit 2/5/20-seat matrix against a live Supabase service-role client:
  all pass.
- `npm run test:workforce-studio:promptfoo` — 7 golden + adversarial NL-edit
  scenarios against the real `proposeNlEdit` path via a live SiliconFlow call:
  7/7 pass, confirmed stable across 3 repeated runs.
- `tsc --noEmit` clean across the whole project.

## Session 2026-07-22 — AI reply latency + error-leak + voice recording fixes

User report: "Hey everyone!" took ~15s for a broadcast greeting reply and a
DM ("what's your name and what can you do?") took **125924ms** (~2 min),
with the Debug trace showing an `[intelligence] router` step failing at
exactly **30004ms**. Separately, clicking **Listen** on an AI reply surfaced
a raw `"No plan configs found. Apply migration
20260706200000_commercial_plan_entitlements.sql."` error directly in the
chat UI, and stopping a voice-note recording surfaced `"mime type
audio/webm;codecs=opus is not supported"` instead of a transcript.

**Migrations**: verified via `supabase migration list --linked` — every
local migration (including `20260706200000_commercial_plan_entitlements`)
is present on the linked `psufoswopnknzhxfyvwa` (AdeHQ) project, and a
direct service-role query confirmed `platform_plan_configs` has all 5 rows
(free/pro/team/business/enterprise). No missing migration; the error text
was almost certainly from an earlier deploy or a transient read, not an
ongoing gap — but see the defensive fix below regardless.

**Root causes found & fixed:**
- `src/lib/ai/intelligence/intelligence-router.ts` — the lightweight
  route-classification step (`direct`/`search`/`browse`/`clarify`, one enum
  field) was reusing the "cheap" tier's full **30s** reply budget
  (`getTimeoutMs("cheap")`) as its own timeout. When SiliconFlow's cheap
  tier was slow, this step burned the full 30s before the pipeline could
  fall back to a direct reply — exactly matching the observed `30004ms`
  failures. Gave it its own dedicated `ROUTER_TIMEOUT_MS = 8_000`, since a
  single-field classification never needs anywhere near a full reply
  budget; a slow provider now fails fast here instead of stalling the
  whole turn.
- `src/lib/orchestration/llm-classifier.ts` (`classifyWithLlmOld`) — the
  legacy room-orchestration classifier's `generateObject` call had **no
  timeout at all** (no `abortSignal`), so a hanging/slow SiliconFlow
  response could stall a room message's classification indefinitely with
  no bound. Added an 8s `abortSignal.timeout` — on timeout the caller
  already falls back to the deterministic/heuristic classifier
  (`classifyRoomMessageDeterministic`), so this is a pure latency-ceiling
  fix with no behavior change on the happy path.
- `src/lib/billing/plans/resolve-workspace-plan.ts` — `resolveWorkspacePlan`
  previously threw a raw `Error` naming the migration filename whenever
  `platform_plan_configs` had no row for the resolved plan *and* no "free"
  row. This function sits on the hot path for every message send, Listen
  click, and quota check, and several callers (e.g.
  `/api/voice/synthesize`) forwarded `error.message` straight into the
  response body, which the `ListenButton` UI then rendered verbatim. Now
  fails open with an in-memory `FALLBACK_FREE_PLAN_CONFIG` (matching the
  seeded "free" row) plus a loud `console.error` for the Debug trace/server
  logs, instead of throwing into user-facing UI.
- New `src/lib/server/api-error.ts` (`safeApiErrorMessage`) — pattern-based
  filter that swaps an unexpected/500-class error's message for a generic,
  friendly fallback when it looks like internal/infra leakage (mentions
  "migration", a missing table/relation, RLS, a raw `STT/TTS failed (nnn):
  ...` provider body, etc.), while leaving already-friendly, deliberately
  thrown messages (validation, policy reasons) untouched. Wired into
  `/api/voice/synthesize` and `/api/voice/transcribe`'s catch-all error
  responses — the two routes directly implicated by this report. The
  original error is still `console.error`'d for the Debug trace.
- `src/lib/brain/voice/adapter.ts` (`callSiliconFlowStt`) — root cause of
  the `"mime type audio/webm;codecs=opus is not supported"` error: the
  browser's `MediaRecorder` blob `type` (`audio/webm;codecs=opus`) was
  passed straight through as the multipart file part's Content-Type to
  SiliconFlow's transcription endpoint, which rejects the `;codecs=...`
  parameter and echoes it back verbatim in its error body (which then
  became the user-facing error via the bug above). Added `bareMimeType()` /
  `extensionForMimeType()` to strip codec parameters before building the
  upload `Blob`, so only the bare container type (`audio/webm`, `audio/wav`,
  etc.) is ever sent.
- `src/components/VoiceNoteButton.tsx` — UX pass requested by the report
  ("doesn't show progress or transcribed text"): explicit `Recording ·
  Ns · tap to stop` / `Transcribing…` / `Added to message` status labels
  (previously just a bare spinner icon with no text), a best-effort live
  caption during recording via the browser's `SpeechRecognition` API where
  available (feature-detected; Firefox has none, so this degrades to
  "Listening…" there — the authoritative transcript always comes from the
  server STT call on stop, never from this live caption), and a clearer
  empty-transcript message ("Didn't catch that…") instead of silently
  no-op'ing. Recorder mimeType selection now tries `webm/opus → webm →
  mp4 → ogg/opus` and reads back `recorder.mimeType` actually granted by
  the browser, rather than assuming the first candidate succeeded.

**Not fixed in this pass (flagged for follow-up, out of "fix it quickly"
scope):** the DM case's outer wall-clock time (125924ms) has ~90s not
accounted for by any single measured step in the `[intelligence]` timeline
(router 30004ms + composer 4221ms ≈ 34.2s of the 125.9s total) — likely
spread across the many sequential Supabase round trips in
`processEmployeeResponse`/`processQueuedAgentRun` (cost-guard begin/finalize,
shadow-run planning/recording, `appendRunStep` calls, effects persistence)
rather than one obvious offender. Reducing the two timeouts above bounds
the worst case but doesn't explain 100% of that one trace; a proper fix
needs real APM/timing spans around each DB round trip, not static reading.

**Verified**:
- `npx tsc --noEmit` — clean.
- `npm run build` — clean production build.
- `npm run test:brain:voice` — 20/20 pass.
- `npm run test:room-steward` — 17/17 pass.
- `npm run test:dm-steward` — pre-existing `deep research request →
  browser_research` failure confirmed present before these changes too
  (via `git stash`); unrelated to this session's edits, not introduced by
  it.
- `npm run test:ai-callers` — 32/32 pass.
- `npm run test:runtime:mock` — 7/7 pass.
- Removed three stray `scripts/tmp-*.mjs` scratch files (hybrid-access E2E,
  profile-avatar seed, workforce-studio UI smoke) left untracked from prior
  sessions — explicitly labeled "throwaway"/"one-off" in their own headers,
  not referenced by any npm script or doc, safe to delete rather than commit.

## Session 2026-07-23 — mixed research + CRM action silently skipped

**Symptom:** Priya was asked to research Dubai Shawarma in Canterbury and add
a $30,000 CRM deal. Search returned a weak "no information" answer with numbered
citations, while no CRM row or memory was created.

**Root cause:** the DM steward classified the whole mixed instruction as a
`current_fact_question`. `processQueuedAgentRun` executed gateway/Tavily search,
persisted that answer, and returned before the structured employee/tool path.
Priya's production grants were correct (CRM, investors, email, tasks, Drive,
calendar, browser, and web search all enabled).

**Fix:** mixed research + operational-action requests now use a focused business
discovery query, inject the verified answer/source URLs into the employee
context, then continue through the structured tool executor. Search failure no
longer cancels an explicit mutation. The final message retains the web-source
artifact, durable research is requested in `effects.memory`, and an explicit CRM
deal has a conservative deterministic fallback if both model tool-call attempts
no-op.

**Live search proof:** the focused query found the Canterbury business at
45 St Peter's Street, CT1 2BG, phone +44 1227 379330, email
`dubaicanterbury@gmail.com`, and active Companies House record 16884329.

**Verified:** `npx tsc --noEmit`, message-intent and DM-steward tests, search
citation/quality tests, and AI caller audit pass. Integration core/permission
test files still contain pre-existing assertions for removed legacy workspace
roles and the old hidden-locked-tool prompt behavior.

## Log

| 2026-07-10 | Hire AI Employee wizard: typed "I need a leasing agent who can screen tenant applicants, answer prospective tenant questions, and schedule property tours" on Step 1 (Role) | Maya proposes real-estate-relevant role(s), e.g. "Leasing Agent" / "Property Manager", and Job Brief step 4 reflects tenant screening, tour scheduling | Step 2 (Context): Maya suggested generic SaaS-startup roles — "Software Engineer, Executive Assistant, Sales Development Rep" — none matching a leasing/property role. Follow-up quick-reply chips were "Daily operations / Customer support / Data analysis / Process automation," again generic. The live-updating "Draft Job Brief" panel showed title **"AI Employee"**, department **"General business"**, and mission **"Help the team succeed as a ai employee in general business."** — completely generic, dropped all my specifics (leasing, tenants, tours), and contains a grammar bug ("as a ai employee" instead of "an AI employee"). | **Critical / Important** (bug: grammar+data-loss is Important; the vertical-blindness is a Critical product-market gap for a real estate customer) | Role-parsing/classification step likely maps free text against a fixed catalog of SaaS/startup role templates (Software Engineer, SDR, EA, etc.) with no real-estate-specific roles (Leasing Agent, Property Manager, Listing Agent, Transaction Coordinator) and a weak fallback that discards the original input instead of using it verbatim in the mission field | Add a "custom/other" path that keeps the user's literal input verbatim in the mission when no catalog role matches well enough, add real-estate role templates, fix the "a ai employee" grammar bug, and use an article-aware template ("an {role}" not "a {role}") | Open | This is the single most damaging finding so far for the real-estate persona specifically: the CEO in this scenario is being funneled toward hiring a generic "AI Employee" instead of a Leasing Agent, on the platform's flagship "hire a teammate in minutes" flow. First impressions of the hiring wizard (UI, step design, live-updating brief) are excellent — the content generation is the weak link. |

| Timestamp | Scenario | Expected | Actual | Severity | Root Cause | Fix | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-07-10 | Login page load | Page renders instantly | Loaded clean, polished, on-brand split-screen design | N/A | - | - | Pass | Good first impression, matches ChatGPT/Linear-tier polish |
| 2026-07-10 | Login form keyboard typing | `type` action into email/password fields lands text | Browser-tool `type` action after `left_click` did not land text in inputs (focus went to logo link instead); had to use direct `form_input` ref-based fill to succeed | Minor (possible tool/env quirk, not necessarily app bug) | Unclear — may be a focus-trap or autofocus script stealing focus on this page | Investigate if real users hit this; verify tab order / autofocus JS on login page | Needs investigation | Flagging for awareness; could indicate a focus-management bug affecting real keyboards too |
| 2026-07-10 | Login submit (shubhamzinbox@gmail.com) | Redirects to workspace dashboard | Immediate redirect to dashboard: "Good evening, Shubham. Your AI workforce is ready." Shows 3 AI employees, 1 room, 0 open tasks, 0 approvals, 8 memory facts, 17 work log entries | N/A | - | - | Pass | Dashboard is information-dense but readable; good empty-state numbers legible at a glance |
| 2026-07-10 | Open DM with Maya (AI Workforce Manager) | Chat loads with history | Loaded instantly, no refresh needed, showed prior seeded conversation about hiring Elena Rossi/David Kim/Sofia York | N/A | - | - | Pass | Good UI: model-effort chips (Fast/Balanced/Deep Thinking/Research/Collaboration), quick actions (Summarize/Create task/Save memory), @mention and / command affordances visible in composer |
| 2026-07-10 | Reproduce CRM/task tool failure: DM'd `@Elena Rossi` in Launch Room "add a CRM contact for investor lead Marcus Chen" | Either succeeds cleanly or fails cleanly with accurate messaging | Elena replied correctly ("On it — created contact... logged task...") with a green "Task created: Follow up with Marcus Chen" card + "Open in Tasks →" link and a "Saved to memory: Note" chip, then asked an intelligent follow-up ("Want me to set a reminder for a specific date?"). BUT clicking straight to the Tasks board showed **0 total tasks / "No tasks match"**. Only after a full page navigation (not just revisit) did the task appear (1 total task, in "Open" column, correctly labeled, tagged to Launch Room, owner avatar ER). | **Critical** | Tasks board is not subscribed to realtime updates (or cache not invalidated) when a task is created via chat/tool-call from another view; requires a hard navigation to reflect new state | Add realtime subscription / cache invalidation so Tasks (and likely CRM, Drive) boards refresh live when AI employees create records, matching the "never require a refresh" rule | Open | This directly violates the explicit platform requirement that the app should never need a refresh to continue working. A user who created a task via chat and immediately checked the Tasks tab would reasonably conclude the AI lied about creating it — even though it did succeed. This is a trust-damaging UX bug on top of a real (if intermittent) `team.coordinate` tool failure logged separately below. |
| 2026-07-10 | Checked CRM board for Marcus Chen contact | Contact appears live | Confirmed present (2 contacts total) after navigation. CRM page has a manual "Refresh" button next to "Add record" | Medium | Same realtime-sync gap as Tasks; manual Refresh button is a tacit admission the live-update isn't trustworthy | Same fix as above — realtime subscriptions on CRM/Tasks/Drive boards; the "Refresh" button is a reasonable stopgap but shouldn't be the primary mechanism | Open | Also noted: zero third-party integrations are live yet (HubSpot, Salesforce, Slack, Gmail, Stripe, Zapier, Google Sheets, Calendly, Outlook — all "SOON"). For a $19/mo tool competing with Monday/ClickUp this is a real gap since those tools already have live integrations; acceptable for now if positioned as "AI does the work natively" rather than "connects your stack," but worth being explicit about in marketing. |
| 2026-07-10 | Opened pre-existing "Launch Room" (General Chat topic) | Room loads with history | Loaded fine, but surfaced a **pre-existing unresolved failure**: (1) a `@Elena Rossi` mention triggered `Failed: coordinate — Invalid arguments for team.coordinate — message: Invalid input` with a Retry button left un-clicked; (2) a later request to Sofia York + Elena Rossi resulted in Sofia replying "I wasn't able to actually complete those actions just now — nothing was saved to your CRM, Tasks, or Drive. This was a tool execution issue on my side." with a red "Actions not completed" banner | **Critical** | Tool-calling layer (`team.coordinate` and CRM/Tasks/Drive write tools) throwing invalid-argument / execution errors that are surfaced to the end user as broken promises | Investigate `team.coordinate` tool schema validation and CRM/Tasks/Drive write-tool error handling; add retry/backoff and don't let the model claim work is in progress when the tool call already failed | Open — reproducing next | This is exactly the kind of failure that breaks trust vs. ChatGPT/Claude — the AI is honest about the failure (good) but the underlying capability (routing @mentions to teammates, saving CRM/task/drive artifacts) is broken. Room list preview text is literally "I wasn't able to actually complete those actions" — a failure message is the front-door impression of this room. |
| 2026-07-10 | DM Maya: "I'm launching a 40-unit luxury apartment development downtown. Give me a quick market positioning summary and 3 immediate next steps." | Either answers or hands off to a more relevant employee | Maya replied in <1s: "I'm here to help with hiring, workforce reviews, employee improvements, and navigating AdeHQ. What would be most useful right now?" — correctly declined out-of-scope work and stayed in her lane | N/A (positive finding) | Role-scoped system prompt for the Guide/Manager persona | - | Pass — but UX gap | Good: avoids hallucinating outside her role, unlike a generic chatbot. Gap: she did NOT proactively route me to Sofia York (Product Manager) or suggest which employee to ask, despite know­ing the full roster — a real EA/manager would say "ask Sofia" or offer to loop her in. This is a missed "feels like a colleague" moment (see Phase 2/5 notes). |
