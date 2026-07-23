# AdeHQ — guide for AI coding agents

Read this before large changes. Product docs for humans live in Mintlify; this file is the **in-repo agent map**.

## What this product is

AdeHQ is a Next.js workspace where humans and AI employees collaborate (rooms, DMs, inbox, drive, CRM, tasks, billing). Auth and data are Supabase; AI runtime is SiliconFlow / gateway oriented.

## Canonical docs

| Kind | Location |
|------|----------|
| Product / developer docs | [NexCache-Official/docs](https://github.com/NexCache-Official/docs) (Mintlify) |
| Engineering docs (this repo) | [`docs/README.md`](./docs/README.md) |
| Design system | [`docs/design-system/README.md`](./docs/design-system/README.md) |
| Scripts index | [`scripts/README.md`](./scripts/README.md) |
| QA audit log | [`docs/audits/AUDIT_REPORT.md`](./docs/audits/AUDIT_REPORT.md) |
| Agent testing paste sheet | [`docs/ops/testing-instructions.md`](./docs/ops/testing-instructions.md) |

## Stack map (where to edit)

```
src/app/(app)/          # authenticated product routes
src/app/(auth)/         # login, signup, invite accept
src/app/api/            # route handlers
src/components/         # UI (AppShell, Sidebar, RoomChat, layout/)
src/components/ui.tsx   # shared primitives (Button, Card, …)
src/lib/                # domain logic (ai, inbox, workspace, supabase)
src/emails/             # React Email templates
supabase/migrations/    # schema changes (push with supabase CLI)
```

## Design / UI rules (non-negotiable for app chrome)

1. Tokens live in `src/app/globals.css` + `tailwind.config.ts` — do not invent a parallel palette.  
2. Left rail: pinned header (workspace → search) and footer (hire + profile); only the middle scrolls.  
3. Side panes use `ResizablePane` (`src/components/layout/`). Main work column stays `flex-1` and is not collapsible.  
4. Flex text in narrow panes: `min-w-0` + `truncate`. Do not pad content away from the resize seam.  
5. Workspace roles are **`admin` | `member` only** (`src/lib/workspace/permissions.ts`).  

## Data / security

- Never commit `.env*`, secrets, or live credentials.  
- Prefer service-role only on the server (`createSupabaseSecretClient`).  
- Schema changes: add a migration under `supabase/migrations/`, then `supabase db push --linked`. Keep `supabase/schema.sql` aligned for greenfield installs.  

## Common commands

```bash
npm run dev
npm run build
npm run test:runtime:mock
npm run test:human-burst
npm run audit:ai-callers
node scripts/smoke-workspace-roles.mjs
```

Full script index: [`scripts/README.md`](./scripts/README.md).

## Change discipline

- Match existing patterns; avoid drive-by refactors unrelated to the task.  
- Do not edit plan files under `.cursor/plans/` unless asked.  
- Prefer updating docs under `docs/` when you change architecture; keep Mintlify as the user-facing source of truth.  
- Log product QA findings in `docs/audits/AUDIT_REPORT.md`, not a new root file.  

## Removable / temporary

- Inbox transport proof harness: `src/lib/inbox-transport-proof/`, `scripts/inbox-transport-proof.ts`, `docs/inbox/inbox-transport-proof.md` — removable once Slice A+ is validated. 
- Design HTML mocks: `docs/design-system/mocks/` — reference only, not runtime.

## Cursor Cloud specific instructions

Node 20+ is required (VM uses Node 22). Dependencies install via `npm install` (already run by the startup update script). Standard commands live in `package.json` / `scripts/README.md`.

- Run the app: `npm run dev` (Next.js on `http://localhost:3000`). No `.env.local` is needed just to boot — `src/lib/supabase/config.ts` bakes in a default hosted Supabase project, so the login/signup pages and browser client work out of the box. Server-side write/auth paths need `SUPABASE_SECRET_KEY` (`sb_secret_…`); without it those paths log "Supabase secret key is not configured" and degrade gracefully rather than crashing.
- Demo walkthrough without real auth: start dev with `NEXT_PUBLIC_ENABLE_DEMO_MODE=true npm run dev`, then use the "Continue as Demo Founder" button on `/login`. This loads in-memory seed data (rooms, AI employees, tasks) and is the fastest way to exercise core UI (rooms/chat) end-to-end. Real signup on the default project requires email confirmation, which cannot be completed in the VM.
- AI employee replies are optional: with no provider key the runtime falls back to scripted responses. Validate the AI runtime offline with `npm run test:runtime:mock` (no keys needed).
- Lint: `npm run lint` is NOT usable non-interactively — ESLint is not configured in this repo (no config/deps) and `next.config.mjs` sets `eslint.ignoreDuringBuilds: true`. Running it drops into the interactive "How would you like to configure ESLint?" prompt. Use TypeScript as the effective static check instead of relying on `next lint`.
- The `⚠ Unrecognized key(s) in object: 'serverExternalPackages'` warning on dev startup is benign (Next 14.2.5 vs newer config key) and does not affect the app.
- The `services/voice-worker/` package is a separate, feature-flagged-off service with its own `npm install`; it is not part of `npm run dev` and is not required for core dev.
