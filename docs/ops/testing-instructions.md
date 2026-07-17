# AdeHQ Testing Instructions (paste into any new chat)

Use this sheet whenever you want Claude to test AdeHQ, hunt for bugs, or run a
"simulate a real business" session. Paste it at the start of the conversation.

## 1. What AdeHQ is

AdeHQ is an AI-workforce SaaS platform (B2B + B2C). Users hire AI employees
that work inside chat rooms/DMs, use tools (CRM, Tasks, Drive/artifacts,
calendar, investor tracking), collaborate with each other and humans, and
produce real work product (documents, briefs, decks). It is NOT a workflow
builder, not an MCP client, not a Slack clone — see
[docs/adehq-positioning] memory / repo docs if that framing ever comes up.

## 2. Test credentials

- URL: `http://localhost:3000` (start the dev server first — see `.claude/launch.json` / `npm run dev`)
- Test account email: `shubhamzinbox@gmail.com`
- Password: **ask the user for it at the start of the session** — do not guess
  or reuse a password from memory/docs. It has never been logged in any
  report and should not be committed to any file.
- This account's workspace already has AI employees hired (as of last audit:
  3 employees, 1 room). **Maya is the default AI Workforce Manager — recruiting
  + workspace-guide only.** She must not be assigned rooms, inbox/email threads,
  CRM work, or other execution jobs. Use hired (non-system) employees for that.
  Candidate shortlist names must never include "Maya". If you're unsure who's
  hired, check Workforce before assuming.
- Never create a second real account, never touch billing/payment fields,
  never invite real external humans — this is a sandbox but treat any
  outbound-looking action (email send, invite, publish) as needing
  confirmation per the standing safety rules.

## 3. How to run a testing session

Prefer manual product QA in the browser against `http://localhost:3000`
(with `.env.local` pointed at the real Supabase/services). Do not commit
one-off `tmp-*.mjs` Playwright harnesses or passwords.

1. Log in via the Browser tool (not Bash) — `preview_start`/`navigate` to
   localhost, or the deployed URL if the user specifies one.
2. Pick a realistic business scenario (e.g. "run a real-estate brokerage") and
   drive it through the AI employees like a real user would: DM them, ask
   for documents/briefs, ask them to update CRM/Tasks, ask two employees to
   collaborate/hand off work, ask follow-up questions that require memory of
   earlier context.
3. Cover breadth, not just the happy path: tool-calling requests (CRM writes,
   task creation, artifact generation), research/search questions (fact
   lookups should be fast — a few seconds, not 20-30s), ambiguous room
   messages (does the right employee respond, does more than one respond
   redundantly, does a human-only message wrongly get an AI reply), and
   error/edge cases (missing info, contradictory instructions, long
   documents).
4. For every issue found, capture: what you did (exact input), what you
   expected, what actually happened (verbatim output/error, screenshot if
   visual), how severe it is, and a first-pass guess at root cause if one is
   obvious from the behavior.
5. Cross-check surprising behavior against the code before calling it a bug —
   read the relevant file/function rather than speculating.

## 4. Where findings go

- Log everything to **`docs/audits/AUDIT_REPORT.md`** (create it if
  missing) — one running table/log of test steps + a "Remaining work / open
  items" section for anything not fixed yet. This file is the persistent
  memory of what's been tested and what's still broken across sessions.
- If asked to also fix bugs: root-cause each one (don't just patch the
  symptom), fix it, verify the fix with a real test (not just "looks
  right"), then note the fix + verification in `docs/audits/AUDIT_REPORT.md`.
- Git hygiene: commit fixes in small, logically separate commits with real
  descriptive messages — not one giant commit — and never bundle unrelated
  changes together. Never commit files you didn't intentionally change
  (check `git status`/`git diff` first; other work-in-progress sessions may
  have touched files concurrently).

## 5. Known standing context (don't rediscover these every time)

- Primary LLM: SiliconFlow (DeepSeek-V4-Flash). Structured tool-calling
  requests (`generateObject`-shaped) have a known, still-open severe bug:
  DeepSeek's hidden "thinking" tokens can burn the entire output budget on a
  structured call and cause it to time out/abort — this shows up as CRM/task/
  artifact actions silently failing after 100+ seconds. If you hit a stalled
  or failed tool-call, check whether this is the cause before assuming
  something else broke.
- Search routing: Exa is the primary search engine for fact/company/research
  queries (fast, ~4s), with Perplexity-via-gateway and Tavily as fallbacks
  when Exa isn't configured. If a search reply takes 20-30s, that's a
  regression — it should route to Exa.
- Any Supabase schema migration (`supabase db push`) requires explicit
  per-instance user confirmation — never push automatically, even if a
  similar migration was approved earlier in the same session.
- `.env.local` already has the real API keys (SiliconFlow, Exa, Supabase,
  etc.) — check presence of a key, never print or log its value.
