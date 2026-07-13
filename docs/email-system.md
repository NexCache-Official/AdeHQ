# AdeHQ Email System

A component-based transactional email design system built with **React Email** and
sent via **Resend**. Auth emails are delivered through a **Supabase "Send Email"
Auth Hook** (dynamic, single source of truth); product / security / notification /
billing emails are sent from app code through one shared pipeline.

## Architecture

Every email — auth or product — flows through `src/lib/email/send.ts`:

```
sendEmail({ template, to, props, workspaceId?, userId? })
  → preference gate (skip gated opt-outs; always-on categories bypass)
  → test-mode redirect (EMAIL_TEST_MODE → EMAIL_TEST_INBOX, subject tagged)
  → renderEmail() (React Email → html + text)
  → resend.emails.send()
  → email_send_log write (sent | failed | skipped_unsubscribed | test_redirected)
```

Auth emails additionally arrive via the Supabase hook:

```
Supabase Auth event → POST /api/auth/hooks/send-email
  → verify signed webhook (standardwebhooks + SEND_EMAIL_HOOK_SECRET)
  → route by email_action_type → template
  → build verify URL → sendEmail(...) → 200 / Supabase error shape on failure
```

## Directory map

| Path | Purpose |
| --- | --- |
| `src/emails/theme.ts` | Light-only color / spacing / font tokens, `EMAIL_FROM` |
| `src/emails/layouts/EmailLayout.tsx` | Html/head/preview/body wrapper + header/footer |
| `src/emails/components/*` | Design-system components (Button, Card, Alert, Metric, Activity, Workspace, Employee, Signature, EmptyState, …) |
| `src/emails/illustrations/Illustration.tsx` | Hosted-PNG illustration wrapper (Gmail-safe) |
| `src/emails/templates/{auth,product,security,notification,billing}/` | Template components |
| `src/emails/registry.ts` | `template key → { category, subject(props), Component }` — the one place templates register |
| `src/lib/email/send.ts` | The single send pipeline |
| `src/lib/email/render.ts` | `renderEmail(react)` → `{ html, text }` |
| `src/lib/email/log.ts` | `recordEmailSend(...)` → `email_send_log` |
| `src/lib/email/preferences.ts` | Categories, `checkEmailAllowed`, unsubscribe tokens |
| `public/email/*.png` | Hosted logo + illustration PNGs (generated) |
| `public/brand/*.svg` | Brand icon + wordmark source |

## Categories & preferences

- **Always-on** (never gated, no unsubscribe): `auth`, `security`, `billing`.
- **Preference-gated** (respect `email_preferences`, include `List-Unsubscribe`):
  `product_updates`, `weekly_reports`, `activity_notifications`.

Gated emails add `List-Unsubscribe` + `List-Unsubscribe-Post: One-Click` headers and a
footer "Manage email preferences" link. `GET/POST /api/email/unsubscribe?token=…&category=…`
flips a category off by token (no login). `/settings/notifications` lets logged-in users
toggle each gated category. Rows in `email_preferences` default to opted-in and are created
lazily on first send/lookup.

## Templates shipped in v1

**Auth (wired via hook):** `verify_email`, `magic_link`, `reset_password`,
`change_email`, `reauthentication`, `workspace_invite`.

**Product (gated):** `welcome` (wired after first-workspace creation),
`ai_employee_hired`, `weekly_workspace_summary`, `ai_work_hours_low`.

**Security (always-on):** `new_login`, `password_changed` (render-ready).

**Notification (gated):** `browser_research_finished`, `approval_required` (render-ready).

**Billing (always-on):** `payment_succeeded`, `payment_failed`, `trial_ending`
(render-ready, not wired).

### Future templates (~30, not yet built)

Mentions, task assigned/completed, research failed, intelligence report, milestone
reached, plan upgraded/downgraded, seat added, invoice upcoming, card expiring, usage
limit reached, workspace archived, member removed, role changed, digest (daily), tool
connected/disconnected, approval approved/rejected, employee paused, call summary, etc.
Add each by registering in `src/emails/registry.ts`.

## Adding a template

1. Build the component under `src/emails/templates/<category>/MyTemplate.tsx` using only
   design-system components. Export a `Props` type and a `.PreviewProps` sample.
2. Register it in `src/emails/registry.ts` with a `category`, `subject(props)`, and `Component`.
3. Send it: `await sendEmail({ template: "my_template", to, props, userId, workspaceId })`.
4. Preview with `npm run email:dev`; render-check with `npx tsx scripts/test-email.ts --render`.

## Assets

`public/email/*.png` and `public/brand/*.svg` are generated from the brand SVGs.
Regenerate after a brand change:

```
node scripts/generate-email-assets.mjs
```

Gmail strips inline SVG and blocks external SVG `<img>`, so email logos and illustrations
are **hosted PNGs** referenced by absolute URL (`getSiteUrl()`), with alt text.

## Test mode

Set `EMAIL_TEST_MODE=true` + `EMAIL_TEST_INBOX=you@example.com` on dev/staging. Every
outgoing email is rerouted to the test inbox, the subject is prefixed
`[test -> real@user] …`, and `email_send_log.status = test_redirected` (original recipient
in `metadata`). Guards against emailing real users from non-prod.

## Scripts

```
npm run email:dev                        # React Email preview server
npm run email:build                      # Static export
npx tsx scripts/test-email.ts --render   # Render every template (no send)
npx tsx scripts/test-email.ts welcome --to you@x.io   # Send one (needs RESEND_API_KEY)
```

## Environment

| Var | Where | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | server | Resend API key. `adehq.com` must be verified in Resend. |
| `SEND_EMAIL_HOOK_SECRET` | server | From Supabase → Auth → Hooks → Send Email (`v1,whsec_…`). |
| `EMAIL_FROM` | server | e.g. `AdeHQ <noreply@adehq.com>` (defaults to this if unset) |
| `EMAIL_REPLY_TO` | server | e.g. `AdeHQ <hello@adehq.com>` (defaults to this if unset) |
| `EMAIL_TEST_MODE` | server | `true` on dev/staging |
| `EMAIL_TEST_INBOX` | server | used when test mode is on |

## Supabase "Send Email" Auth Hook setup (manual — dashboard only)

The Auth Hook is **not** exposed via the Supabase MCP, so configure it in the dashboard:

1. **Supabase → Authentication → Hooks → Send Email → Enable.**
2. Hook type: **HTTPS**. URL: `${APP_URL}/api/auth/hooks/send-email`
   (e.g. `https://app.adehq.com/api/auth/hooks/send-email`).
3. Copy the generated **signing secret** (`v1,whsec_…`) into `SEND_EMAIL_HOOK_SECRET`
   (local `.env.local` + Vercel).
4. The hook takes precedence over dashboard SMTP — no SMTP changes needed.
5. Ensure Auth redirect URLs allow `${APP_URL}/auth/callback` (the verify URL lands there).

## Vercel env setup

Add all vars above under **Project → Settings → Environment Variables** (Production +
Preview). Set `EMAIL_TEST_MODE=true` + `EMAIL_TEST_INBOX` on Preview so preview
deployments never email real users. Redeploy after changes.

## Transactional vs Workspace Inbox

AdeHQ has **two separate email systems**. Do not mix them.

| | Transactional (`src/lib/email/`) | Workspace Inbox (`src/lib/inbox/`) |
| --- | --- | --- |
| Purpose | Auth, product, security, billing notifications | Shared conversational mailbox per workspace |
| From | `noreply@adehq.com` / `EMAIL_FROM` | `{canonical}@inbox.adehq.com` |
| Resend account | `RESEND_API_KEY` (transactional domain) | `RESEND_INBOX_API_KEY` (inbox domain) |
| Store | `email_send_log` | `email_threads` / `email_messages` / outbox |
| AI | Not involved | Cost-aware steward; on-demand drafts; approval gate |
| Docs | This file | [`docs/workspace-inbox-foundation.md`](./workspace-inbox-foundation.md), [`docs/inbox-transport-proof.md`](./inbox-transport-proof.md) |

Workspace inbox is claim-first, permissioned via mailbox grants, and never auto-sends AI mail without version-locked approval.

## Workspace inbox (Slice 0–C)

Conversational shared-inbox transport was proven in Slice 0
([`docs/inbox-transport-proof.md`](inbox-transport-proof.md)). Slices A–C add the
secure foundation, human UI, and AI steward —
[`docs/workspace-inbox-foundation.md`](workspace-inbox-foundation.md).

Do not reuse `noreply@adehq.com` / `sendEmail()` for workspace mailbox traffic.
Use `RESEND_INBOX_API_KEY` and `POST /api/inbox/webhooks/resend`.

## Database

Migration `supabase/migrations/20260708150000_email_system.sql` adds:

- `email_send_log` — one row per send (`template`, `category`, `recipient`, `subject`,
  `status`, `provider_message_id`, `error`, `workspace_id`, `user_id`, `metadata`).
- `email_preferences` — per-user opt-outs (`product_updates`, `weekly_reports`,
  `activity_notifications`) + `unsubscribe_token`.

Both are service-role / platform-admin only (no customer-facing RLS policies). Apply with
the Supabase CLI (`supabase db push`) or the SQL editor, then verify it appears in
`list_migrations`.
