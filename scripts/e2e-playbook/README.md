# AdeHQ E2E playbook

Reusable Playwright scripts for production / staging hybrid-workforce testing.
Keep these; extend them instead of reinventing one-off `tmp-*.mjs` files each session.

## Prerequisites

```bash
# from repo root
export E2E_EMAIL='…'
export E2E_PASSWORD='…'
# optional
export E2E_BASE_URL='https://app.adehq.com'
```

Install Playwright browsers once:

```bash
npx playwright install chrome
```

**Default run mode is headed Google Chrome** (visible window, `slowMo`) so you can watch authentic owner flows. Set `E2E_HEADLESS=1` only for CI. Override browser with `E2E_CHANNEL=chromium` if Chrome is not installed.

## Scripts

| Script | Purpose |
| --- | --- |
| `hybrid-workforce-e2e.mjs` | Business-owner product/sales collab turns; screenshots + UX notes |
| `topic-same-session.mjs` | Unique product name → wait for suggested topic → accept → continue |
| `accept-topic-now.mjs` | Open room and accept an already-pending topic banner |
| `suggestion-followup-e2e.mjs` | Topic + memory suggestion follow-up after a prior session |
| `room-collab-e2e.mjs` | Silent steward routing + brainstorm + tasks page smoke |

## Run examples

```bash
E2E_EMAIL=… E2E_PASSWORD=… node scripts/e2e-playbook/hybrid-workforce-e2e.mjs
E2E_EMAIL=… E2E_PASSWORD=… node scripts/e2e-playbook/topic-same-session.mjs
```

Artifacts land under `/tmp/adehq-*` (see each script’s `OUT` path) with `report.json` + screenshots.

## Conventions

- Prompts should sound like a business owner (specific, human, non-generic).
- Prefer unique product/workstream names so topic-title cooldown does not suppress banners.
- On failure, stop and capture a screenshot — do not invent green passes.
- Log product bugs into `AUDIT_REPORT.md` at the repo root.
