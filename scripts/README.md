# Scripts index

Runnable tooling for AdeHQ. Prefer **npm scripts** from the repo root (`package.json`) so paths stay stable. This folder stays **flat on purpose** — moving files would churn every `package.json` entry.

## Quick map

| Need | Command / path |
|------|----------------|
| Local app | `npm run dev` |
| AI runtime smoke | `npm run test:runtime:mock` then `npm run test:runtime` |
| Work Hours | `npm run test:work-hours` (+ `:shadow`, `:calibration`, …) |
| Plan terms / Revolut helpers | `npm run test:workspace-plan-terms` |
| WH workforce offline | `npm run test:workforce-wh-offline` |
| Versioned commerce (clocks, pricing math, Revolut API pin) | `npm run test:commerce` |
| AdeHQ Brain | `npm run test:brain` (catalog, metering matrix, steward, media CTA audit) |
| Release baseline | `npm run verify:release` (+ optional `BUILD_INFO_URL=…` for prod probe) |
| Brain reliability | `npm run test:brain:reliability` (PR-17.5 retry/idempotency/circuit) |
| Steward shadow | `npm run test:brain:steward-shadow` (PR-19 plan-only golden scenarios) |
| Steward execution | `npm run test:brain:steward-execution` (PR-19 leases/findings/receipts/DAG) |
| Brain voice | `npm run test:brain:voice` (PR-18 STT/TTS routes, policy, metering) |
| Voice billing | `npm run test:voice-billing` (PR-18.2E allowances, treatments, idempotency/RLS contract) |
| Realtime Brain Calls | `npm run test:brain:voice:live-benchmark` (PR-18.1 routing, Groq minimum billing, chunking, PCM transport) |
| CPU voice worker | `npm run test:voice-worker` (runtime E2E, auth, interruption, readiness) + `npm run test:voice-worker:app` (token and safe transport fallback) |
| Voice pipeline candidates | `npm run test:voice-benchmark` (no-credentials contract), `npm run benchmark:voice-worker -- --list` (registry), or `npm run benchmark:voice-worker` (configured whole-pipeline run; see [protocol](../docs/architecture/voice-benchmark.md)) |
| Human/hybrid calls | `npm run test:calls:human` (canonical state, SFU secret boundary, push, consent, WH voice path) |
| Group Call Steward | `npm run test:calls:steward` (participation, attribution, floor, council, billing metadata) |
| Cloudflare Realtime live | `vercel env run -- npm run test:calls:cloudflare-live` (real session, publish, subscribe, echo; uses server env) |
| Human call API E2E | `npm run test:calls:e2e` (two humans, idempotency, atomic accept, leases, consent, artifacts, cleanup) |
| Hiring brief edits | `npm run test:hiring:brief-edit` (Maya must rewrite the job brief, not append chat instructions as bullets) |
| Hiring role-aware questions | `npm run test:hiring:role-questions` (quality/approval questions must match the role's category, not default to shipping language, and must parse into clean chips) |
| Workforce Studio composition | `npm run test:workforce-studio:composition` (template manifest structure, JsonLogic scaling rules, deterministic composition, canonical hash) |
| Workforce Studio Business Architect | `npm run test:workforce-studio:architect` (ontology pack compile + diagnosis → pack mapping + adaptive-question stop conditions) |
| Workforce Studio goldens | `npm run test:workforce-studio:goldens` (35 offline business-description → compose assertions) |
| Workforce Studio pack score | `npm run test:workforce-studio:pack-score` (structural quality across all registry packs) |
| Workforce Studio provisioning E2E | `npm run test:workforce-studio:provisioning` (needs `.env.local`; live Supabase service-role: full lifecycle, forced-failure compensation, retry-after-failure, 2/5/20-seat matrix) |
| Workforce Studio NL-edit golden + adversarial | `npm run test:workforce-studio:promptfoo` (needs `SILICONFLOW_API_KEY` in `.env.local`; live SiliconFlow call via custom promptfoo provider — see [`docs/architecture/workforce-studio.md`](../docs/architecture/workforce-studio.md)) |
| Call browser compatibility | `npm run test:calls:browsers` (Chromium, Firefox, WebKit WebRTC/media/push capability probe; set `CALL_BROWSER_REQUIRE_ALL=1` for release gating) |
| Brain gauntlet | `npm run test:brain:gauntlet` (release + reliability + steward shadow + brain + access) |
| Brain Step shadow | `npm run test:brain:step-shadow` (live SF: Qwen3-8B vs Step-3.5-Flash) |
| Brain Step harness | `npm run test:brain:step-harness` (larger agreement + WH cost report) |
| Brain Exa search | `npm run test:brain:search` (Exa-first chain, routing, citations) |
| Brain vision | `npm run test:brain:vision` (+ `:benchmark`; live with `ADEHQ_VISION_BENCHMARK_LIVE=1`) |
| Brain image | `npm run test:brain:image` (create/edit routes, WH policy, tools) |
| Brain video | `npm run test:brain:video` (T2V/I2V routes, 29 WH policy, approval tool, mp4 preview) |
| Human burst / typing | `npm run test:human-burst` |
| Inbox Resend proof | `npm run test:inbox-transport-proof` (needs `.env.local`) |
| AI caller audit | `npm run audit:ai-callers` |
| Model pricing sync | `npm run sync:model-pricing` |
| Activate live env merge | `npm run env:activate-live` (**writes `.env.local` — never commit**) |
| Roles smoke | `node scripts/smoke-workspace-roles.mjs` |
| Refund Maya WH from open periods | `node scripts/correct-maya-work-hours-period.mjs` (`--dry-run` first) |

## Categories

### Wired in `package.json`

- **`test:*`** — unit/integration/shadow tests (runtime, work-hours, search, integrations, stewards, browser research, …)
- **`report:*`** — work-hours calibration / readiness reports
- **`audit:*`** — static audits (e.g. AI callers vs checklist)
- **`sync:*` / `verify:*`** — model pricing + capability checks
- **`env:*`** — merge/pull live env into local (secrets-adjacent)
- **`email:*`** — React Email preview/build
- **`db:seed-demo`** — demo seed (dev server must be up)

### Manual / one-off (not in package.json)

| Script | Use |
|--------|-----|
| `archive-duplicate-rooms.ts` (+ `.sql`) | One-off DB cleanup |
| `backfill-drive-storage-paths.ts` | One-off Drive path backfill |
| `generate-email-assets.mjs` | Regenerate `public/email` assets |
| `smoke-workspace-roles.mjs` | Role normalize + safe-next smoke |

## Conventions for agents

1. Prefer adding a **named npm script** when a test should be re-run often.  
2. Do **not** commit `.env.local`, `.env.vercel.*`, or E2E passwords.  
3. Point audit narratives at [`docs/audits/`](../docs/audits/), not the repo root.  
4. Inbox transport proof harness is marked removable after Slice A is solid — see [`src/lib/inbox-transport-proof/README.md`](../src/lib/inbox-transport-proof/README.md).  

## Related docs

- Agent entry: [`../AGENTS.md`](../AGENTS.md)  
- Ops testing paste sheet: [`../docs/ops/testing-instructions.md`](../docs/ops/testing-instructions.md)  
- Runtime migration archive: [`../docs/audits/archive/`](../docs/audits/archive/)  
