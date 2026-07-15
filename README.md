# AdeHQ — AI Workforce Workspace

> The easiest way to create and manage your AI workforce.

AdeHQ is a workspace where humans and AI employees collaborate in project rooms.
Hire AI employees, chat in rooms, assign tasks, review approvals, and inspect work logs —
all backed by Supabase with SiliconFlow-powered employee replies.

## Documentation

| Audience | Where |
|----------|--------|
| Product & developer docs | **[Mintlify](https://github.com/NexCache-Official/docs)** (user guides, PRDs, API, schema) |
| Engineering docs (this repo) | [`docs/README.md`](./docs/README.md) — architecture, inbox, audits, ops |
| Design system (tokens / rail / panes) | [`docs/design-system/README.md`](./docs/design-system/README.md) |
| AI coding agents | [`AGENTS.md`](./AGENTS.md) |
| Scripts index | [`scripts/README.md`](./scripts/README.md) |

Mintlify remains the canonical product/developer site. In-repo `docs/` is for engineers and agents working in this codebase.

## Quick start

```bash
npm install
npm run dev      # http://localhost:3000
```

Run `supabase/schema.sql` in your Supabase SQL editor before using real auth.
If the project already exists, run the idempotent patch in
`supabase/migrations/20250627120000_align_production_schema.sql`.

## Production vs demo separation

**Demo mode is disabled by default.** Production users sign up, complete onboarding,
and work in real empty workspaces — no Forgefield, Stripe, or seeded demo data.

To enable demo locally:

```bash
NEXT_PUBLIC_ENABLE_DEMO_MODE=true
npm run dev
```

With the flag enabled, login/signup show a demo workspace option and in-memory
`loginDemo()` loads seeded data from `src/lib/demo/`.

To inspect demo seed data in development:

```bash
npm run dev
npm run db:seed-demo   # hits POST /api/dev/seed-demo (development only)
```

## Environment variables

Public (browser):

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
NEXT_PUBLIC_SITE_URL=https://app.adehq.com
NEXT_PUBLIC_APP_URL=https://app.adehq.com
NEXT_PUBLIC_ENABLE_DEMO_MODE=false   # default
```

Server-only:

```bash
# Supabase (new API key format — create in Supabase → Settings → API Keys)
SUPABASE_SECRET_KEY=sb_secret_...

# SiliconFlow (primary live provider)
SILICONFLOW_API_KEY=...
ADEHQ_SILICONFLOW_MODEL=deepseek-ai/DeepSeek-V4-Flash
ADEHQ_SILICONFLOW_CHEAP_MODEL=deepseek-ai/DeepSeek-V4-Flash
ADEHQ_SILICONFLOW_CODER_MODEL=Qwen/Qwen3-Coder-30B-A3B-Instruct
ADEHQ_SILICONFLOW_LONG_CONTEXT_MODEL=MiniMaxAI/MiniMax-M2.5
ADEHQ_SILICONFLOW_STRONG_MODEL=deepseek-ai/DeepSeek-V4-Pro
ADEHQ_DEFAULT_PROVIDER=siliconflow
AI_GATEWAY_API_KEY=...
# Gateway mirrors SiliconFlow families (strong/long route here when cheaper)
AI_GATEWAY_MODEL_EFFICIENT=deepseek/deepseek-v4-flash
AI_GATEWAY_MODEL_BALANCED=deepseek/deepseek-v4-flash
AI_GATEWAY_MODEL_STRONG=deepseek/deepseek-v4-pro
AI_GATEWAY_MODEL_LONG_CONTEXT=minimax/minimax-m2.5
AI_GATEWAY_MODEL_CODING=qwen/qwen3-coder-30b-a3b-instruct

# Provider Credential Management V1 (server-only)
# Use a 32-byte base64, hex, or raw UTF-8 key. Rotate by bumping the version
# and keeping ADEHQ_SECRET_ENCRYPTION_KEY_V<n> for old envelopes.
ADEHQ_SECRET_ENCRYPTION_KEY=...
ADEHQ_SECRET_ENCRYPTION_KEY_VERSION=1
ALLOW_PROVIDER_ENV_FALLBACK=true

# Revolut Pay (payment processor for AdeHQ subscriptions)
# The platform runs against Revolut's sandbox by default and degrades gracefully
# until a merchant key is set: checkout still records an intent, no payment is taken.
# Set REVOLUT_ENVIRONMENT=production to go live.
REVOLUT_ENVIRONMENT=sandbox            # sandbox (default) | production
REVOLUT_MERCHANT_API_KEY=...           # Merchant API secret key (server-only)
REVOLUT_WEBHOOK_SECRET=...             # Verifies ORDER_COMPLETED webhook signatures
# REVOLUT_API_BASE_URL=...             # Optional override; defaults per environment
# REVOLUT_API_VERSION=2024-09-01       # Optional Revolut-Api-Version override

# Transactional email (Resend + Supabase Send Email hook)
RESEND_API_KEY=...
SEND_EMAIL_HOOK_SECRET=...             # Supabase Auth → Hooks → Send Email
EMAIL_FROM="AdeHQ <noreply@adehq.com>"
EMAIL_REPLY_TO="AdeHQ <hello@adehq.com>"
# EMAIL_TEST_MODE=true                 # Preview/staging: redirect all mail
# EMAIL_TEST_INBOX=you@example.com
```

Apply `supabase/migrations/20250629120000_ai_runtime_and_work_graph.sql` (or the synced
`supabase/schema.sql`) for AI runtime tables, cost controls, and work-graph linking.

Add redirect URLs in Supabase → Authentication → URL configuration:

- **Site URL:** `https://app.adehq.com`
- **Redirect URLs:** `https://app.adehq.com/**`

## SiliconFlow setup (recommended)

1. Set `SILICONFLOW_API_KEY` in your deployment environment.
2. Optionally tune `ADEHQ_SILICONFLOW_*` model env vars (see above).
3. Apply the AI runtime migration (`20250629120000_ai_runtime_and_work_graph.sql`).
4. Hire or onboard an employee with provider `siliconflow` and an intelligence level.
5. **Settings → AI Runtime → Test provider** — confirm `ok: true` before room debugging.

When the key is missing or a model call fails, AdeHQ falls back to scripted responses
and records a work log / runtime event — the app does not crash.

## Manual model test

1. Create an account and confirm email.
2. Complete onboarding (creates workspace, employee, and room).
3. Open **Settings → AI Runtime** as owner/admin.
4. Confirm **SiliconFlow configured: Yes**.
5. Run **Test provider**, then **Test employee reply**, or mention the employee in a room.
6. Check work log and runtime status for `live` vs `fallback`.

## Messaging test

1. Open a room and send a normal human message (no `@mention`).
2. Refresh — the message should persist.
3. Open a second tab — send from tab A; tab B should update via Supabase Realtime.
4. Send `@Employee Name …` — server saves your message, then runs the AI runtime.

Human messaging works without AI configured. AI is additive when employees are mentioned.

## Clear polluted workspace data

**Settings → Clear workspace data** (owners/admins). Type `CLEAR WORKSPACE` to confirm.
This removes rooms, employees, messages, tasks, memory, approvals, work logs, and calls
while preserving the workspace, owner, and members.

## Architecture

```
src/
  app/
    (auth)/login, signup
    onboarding/                     # first-run flow
    (app)/                          # authenticated shell
    api/rooms/[roomId]/messages     # human + mention-triggered AI
    api/employees/[employeeId]/respond
    api/ai/runtime                  # admin runtime status
  lib/
    config/features.ts              # ENABLE_DEMO_MODE, default model
    demo/                           # dev-only demo seed
    demo-store.tsx                  # Supabase-backed workspace store
    ai/model-router.ts              # SiliconFlow routing + logging
    server/room-access.ts           # room membership checks
```

## Build

```bash
npm run build
npm start
```

## Intentionally deferred / partial

Some surfaces are shipped in a limited form (inbox, billing/checkout, browser research,
provider credentials). Treat Mintlify + `docs/architecture/` as the current truth for
what is production-ready versus experimental.
