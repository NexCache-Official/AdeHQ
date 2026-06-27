# AdeHQ — AI Workforce Workspace

> The easiest way to create and manage your AI workforce.

AdeHQ is a futuristic workspace where humans and AI employees work together in
project rooms. Hire AI employees, give them tools, chat with them like coworkers,
assign tasks, watch their work logs, review approvals, and watch them collaborate
with each other — all in one calm, premium command center.

AdeHQ now uses Supabase as its core workspace backend: auth, workspace records,
workspace members/invitations, AI employees, rooms, messages, tasks, memory,
approvals, work logs, tools, calls, and call transcripts are persisted in
Postgres with workspace-scoped RLS.
Scripted AI still exists as the safe default, and a server API route can use
OpenAI through the Vercel AI SDK when configured.

## Quick start

```bash
npm install
npm run dev      # http://localhost:3000
```

## Implementation map (Phase 1 + 2)

| Concern | Location |
| --- | --- |
| Real workspace creation | `createWorkspaceForUser()` in `src/lib/supabase/persistence.ts` — empty state, `workspace_mode: real` |
| Demo workspace | `loginDemo()` in `src/lib/demo-store.tsx` → `buildDemoState()` in `src/lib/demo/` (in-memory only) |
| Onboarding writes | `OnboardingFlow.tsx` → store actions → Supabase persistence |
| Invites stored/accepted | `workspace_invitations` table; `createWorkspaceInvitation` / `acceptWorkspaceInvitation` in persistence |
| Message + AI runtime | `POST /api/rooms/[roomId]/messages`, `POST /api/employees/[employeeId]/respond` |
| Model routing | `src/lib/ai/model-router.ts` (OpenAI + scripted fallback) |
| Permission enforcement | `src/lib/ai/enforce-permissions.ts` before side effects persist |
| RLS | All workspace tables in `supabase/schema.sql`; admin-only `model_provider_configs` |
| Missing RLS / future | `workspace_settings` table not yet created; Vault encryption TODO for BYOK |

Run `supabase/schema.sql` in your Supabase SQL editor before using real auth.


Real workspaces start empty. Onboarding creates the first room and AI employee;
demo rooms such as Forgefield and Stripe are only loaded through the demo button.
If an older workspace was created before this split and contains demo rows, go
to **Settings -> Clear workspace** to wipe the workspace data and rerun onboarding.

Public Supabase config is already wired to the project URL/publishable key in
code, with these optional deployment overrides:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

Server-only secrets go in your deployment environment, not in client code:

```bash
SUPABASE_SERVICE_ROLE_KEY=...   # only needed for future admin/server tasks
OPENAI_API_KEY=...              # enables live OpenAI replies
ADEHQ_OPENAI_MODEL=gpt-4o-mini  # optional
```

```bash
npm run build    # production build (typechecked)
npm start        # serve the production build
```

## The magic moment

In a real account, finish onboarding, open the room it created, and mention the
AI employee you hired:

```
@Research Employee research competitors for our launch plan.
```

The employee replies like a coworker, writes findings to memory, creates work
logs, and can produce tasks or approval requests. In demo mode, open the
preloaded Forgefield room to see richer seed data.

```
Owners/admins can invite real teammates from **Settings -> Workspace humans**.
Invitations are stored by email, so someone can be invited before signing up and
accept it during onboarding after they create an account with that email.

## Tech stack

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS** (dark-first, glassy, custom theme)
- **Framer Motion** for polish
- **Lucide** icons
- **Supabase** Auth, Postgres, RLS, and Realtime
- **Vercel AI SDK** route for live OpenAI replies when enabled

## Architecture

```
src/
  app/
    (auth)/login, (auth)/signup     # public auth screens
    onboarding/                     # first-run flow
    (app)/                          # authenticated shell (sidebar + topbar)
      page.tsx                      # Home — "My AI Workforce"
      rooms/ , rooms/[roomId]/      # project rooms + room chat
      workforce/ , [employeeId]/    # directory + employee profiles
      tasks/ memory/ approvals/
      work-log/ tools/ calls/ settings/
  components/                       # AppShell, RoomChat, cards, modals, ...
  lib/
    types.ts                        # domain + workspace membership types
    demo-data.ts                    # rich seed data + role templates
    demo-store.tsx                  # Context store + Supabase-backed actions
    supabase/                       # Supabase clients + persistence adapter
    ai/employee-engine.ts           # sendMessageToEmployee() — the AI seam
    ai/use-responder.ts             # orchestrates replies → side effects
  app/api/employees/[employeeId]/respond
                                    # AI response API route
supabase/schema.sql                 # tables, invitations, seed tool catalog, RLS policies
```

### Live AI route

`src/app/api/employees/[employeeId]/respond/route.ts` returns the same shape as
the existing scripted engine:

```ts
{
  employeeId,
  employeeName,
  reply,
  effect: { workLog, tasks, memory, approvals, statusChange, handoffTo, currentTask }
}
```

When Settings is in Mock Mode, or `OPENAI_API_KEY` is missing, the route falls
back to deterministic scripted responses. When Live Mode + OpenAI are selected
and `OPENAI_API_KEY` is present server-side, it uses the Vercel AI SDK.

## What's intentionally not built

Real email delivery for invitations, OAuth/integrations (Slack, GitHub, Cursor,
Unity, Godot, Figma...), MCP, billing, and LiveKit calls. Those remain later
phases.
