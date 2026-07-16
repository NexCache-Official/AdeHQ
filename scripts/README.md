# Scripts index

Runnable tooling for AdeHQ. Prefer **npm scripts** from the repo root (`package.json`) so paths stay stable. This folder stays **flat on purpose** — moving files would churn every `package.json` entry.

## Quick map

| Need | Command / path |
|------|----------------|
| Local app | `npm run dev` |
| AI runtime smoke | `npm run test:runtime:mock` then `npm run test:runtime` |
| Work Hours | `npm run test:work-hours` (+ `:shadow`, `:calibration`, …) |
| AdeHQ Brain | `npm run test:brain` (catalog, metering matrix, steward, media CTA audit) |
| Brain Step shadow | `npm run test:brain:step-shadow` (live SF: Qwen3-8B vs Step-3.5-Flash) |
| Brain Step harness | `npm run test:brain:step-harness` (larger agreement + WH cost report) |
| Brain Exa search | `npm run test:brain:search` (Exa-first chain, routing, citations) |
| Human burst / typing | `npm run test:human-burst` |
| Inbox Resend proof | `npm run test:inbox-transport-proof` (needs `.env.local`) |
| AI caller audit | `npm run audit:ai-callers` |
| Model pricing sync | `npm run sync:model-pricing` |
| Activate live env merge | `npm run env:activate-live` (**writes `.env.local` — never commit**) |
| Headed product E2E | [`e2e-playbook/README.md`](./e2e-playbook/README.md) |
| Roles smoke | `node scripts/smoke-workspace-roles.mjs` |

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
| `e2e-playbook/*.mjs` | Playwright production walkthroughs — see playbook README |
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
