# AdeHQ — AI Workforce Workspace

> The easiest way to create and manage your AI workforce.

AdeHQ is a workspace where humans and AI employees collaborate in project rooms.
Hire AI employees, chat in rooms, assign tasks, review approvals, and inspect work logs —
all backed by Supabase with SiliconFlow-powered employee replies.

## Documentation

Product and developer docs live in a separate Mintlify repo:

**[github.com/NexCache-Official/docs](https://github.com/NexCache-Official/docs)**

- **Documentation** tab — user guides, concepts, quickstart
- **Developer** tab — PRDs, architecture, API reference, database schema

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
# SiliconFlow (primary live provider)
SILICONFLOW_API_KEY=...
ADEHQ_SILICONFLOW_MODEL=deepseek-ai/DeepSeek-V4-Flash
ADEHQ_SILICONFLOW_CHEAP_MODEL=deepseek-ai/DeepSeek-V3
ADEHQ_SILICONFLOW_CODER_MODEL=Qwen/Qwen3-Coder-30B-A3B-Instruct
ADEHQ_SILICONFLOW_LONG_CONTEXT_MODEL=MiniMaxAI/MiniMax-M2.5
ADEHQ_DEFAULT_PROVIDER=siliconflow
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

## Intentionally not built

Browserbase, virtual computers, MCP, ChatGPT App, real Slack/GitHub integrations,
billing, real calls, external OAuth, BYOK encryption, multi-model marketplace.
