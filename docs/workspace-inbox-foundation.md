# Workspace Inbox — Slice A foundation

Secure foundation for AdeHQ’s **shared workspace inbox** (not per-AI-employee mailboxes). Transport is Resend (`inbox.adehq.com`); system of record is Supabase. This slice has **no Inbox UI** and **no AI steward**.

Slice 0 transport proof remains isolated under `src/lib/inbox-transport-proof/` — do not delete it yet.

## What shipped

| Area | Location |
|------|----------|
| Schema + RLS + Storage + Realtime | `supabase/migrations/20260712180000_workspace_inbox_foundation.sql` |
| Provider abstraction | `src/lib/inbox/provider/` |
| Inbound store + async process | `src/lib/inbox/inbound/` |
| Outbox enqueue + send + delivery | `src/lib/inbox/outbox/` |
| Provisioning + sanitise + attachments | `src/lib/inbox/provision.ts`, `sanitize.ts`, `attachments.ts` |
| Production webhook | `POST /api/inbox/webhooks/resend` |
| Queue drain nudge | `POST /api/inbox/jobs/process` (Bearer `INTERNAL_CRON_SECRET`) |
| Ensure primary mailbox | `POST /api/inbox/mailboxes/ensure` (auth + membership) |
| Bootstrap wiring | `ensurePrimaryMailbox` in `workspace-bootstrap.ts` |

## Address model

- Format: `{canonical_local_part}@inbox.adehq.com`
- `canonical_local_part` is **immutable** after first provision
- Workspace display name / slug can change without changing the address
- One **primary** mailbox at launch; `mailbox_aliases` supports extra local-parts later
- Every thread and message carries `mailbox_id`

## Env (inbox account — separate from transactional)

| Var | Purpose |
|-----|---------|
| `RESEND_INBOX_API_KEY` | Conversational inbox Resend account |
| `RESEND_INBOX_WEBHOOK_SECRET` | Svix secret for inbox webhooks |
| `INBOX_DOMAIN` | Default `inbox.adehq.com` |
| `INTERNAL_CRON_SECRET` | Auth for `/api/inbox/jobs/process` |

Transactional product mail still uses `RESEND_API_KEY` + `src/lib/email/send.ts` — do not mix.

## Webhook contract

1. Verify Svix signature with `RESEND_INBOX_WEBHOOK_SECRET`
2. Idempotent insert into `email_inbound_events` (`svix_id`; received also by `provider_email_id`)
3. Fire-and-forget `processInboundEvent` (fetch body → sanitise → resolve mailbox → thread → store)
4. Return `200` immediately — **never** run AI inline

Point Resend (inbox account) webhooks at:

```text
https://<app-host>/api/inbox/webhooks/resend
```

Events: `email.received`, plus delivery (`email.delivered`, `email.bounced`, `email.complained`, …) for outbox updates.

## Outbound

1. Insert `email_outbox` with unique `idempotency_key` (DB-first)
2. Claim → send via Resend inbox key → write `email_messages` + audit event
3. Delivery webhooks update outbox / message status

## Apply migration

```bash
npx supabase db push --linked
```

Or apply `20260712180000_workspace_inbox_foundation.sql` in the SQL editor. Verify tables: `workspace_mailboxes`, `email_threads`, `email_messages`, `email_outbox`, `email_inbound_events`.

## Smoke checks

1. `POST /api/inbox/mailboxes/ensure` with `{ "workspaceId": "…" }` → address returned
2. Send mail to that address → webhook → row in `email_inbound_events` → `email_messages`
3. `POST /api/inbox/jobs/process` with cron secret drains any stuck queued rows

## Out of scope (later slices)

- **B** — Inbox UI (Onyx Blue, folders, composer)
- **C** — AI Steward triage / drafts
- **D** — Work Graph linking
