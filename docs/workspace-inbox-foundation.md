# Workspace Inbox — Slice A + Slice B foundation

Secure foundation for AdeHQ’s **shared workspace inbox** (not per-AI-employee mailboxes). Transport is Resend (`inbox.adehq.com`); system of record is Supabase.

- **Slice A** — schema, provider, webhook, outbox, sanitisation
- **Slice B** — claim-first mailbox, query folders, permissions, drafts, send UI

Slice 0 transport proof remains under `src/lib/inbox-transport-proof/` — do not delete yet. **AI Steward is Slice C** (not here).

## Address model

- Format: `{canonical_local_part}@inbox.adehq.com`
- **Claim-first**: owner/admin chooses the local-part; no silent auto-provision on workspace create
- `canonical_local_part` is **immutable** after claim
- Retired mailboxes / `mailbox_address_reservations` prevent address recycling
- One **primary** mailbox at launch; every thread/message has `mailbox_id`

## Permissions

Inbox is **not** plain workspace membership.

| Action | Owner | Admin | Manager | Member | Guest |
|--------|-------|-------|---------|--------|-------|
| Claim mailbox | Yes | Yes | No | No | No |
| Read / send | Yes | Yes | Via `email_mailbox_access` | Via grant | No |
| Archive / spam | Yes | Yes | If can read (manager) or grant | Via grant | No |

API gate: `requireInboxAccess` in `src/lib/inbox/access.ts`.

## Folders (queries, not a mutable column)

| UI folder | Query |
|-----------|-------|
| Inbox | `status in (open,waiting)`, not spam (stays until archive — Gmail-like) |
| Awaiting reply | `status in (open,waiting)`, not spam, `latest_direction=outbound` |
| Sent | `direction_state in (outbound,mixed)`, not spam, not archived |
| Drafts | `email_drafts.status=draft` |
| Archived | `status=archived` |
| Spam | `is_spam=true` |

Thread fields: `status`, `direction_state`, `latest_direction`, `has_unread`, `is_spam`.

## Key routes

| Method | Path |
|--------|------|
| GET | `/api/inbox/mailbox` |
| GET | `/api/inbox/mailboxes/availability` |
| POST | `/api/inbox/mailboxes/claim` |
| GET | `/api/inbox/threads?folder=&cursor=&limit=` |
| GET | `/api/inbox/threads/[id]` |
| POST | `/api/inbox/threads/[id]/{archive,unarchive,read,unread,spam}` |
| GET/POST | `/api/inbox/drafts` |
| PATCH/DELETE | `/api/inbox/drafts/[id]` |
| POST | `/api/inbox/send` (`clientSendId` required) |
| POST | `/api/inbox/webhooks/resend` |
| POST | `/api/inbox/jobs/process` |

UI: `/inbox` (ClaimGate → split-pane folders | list | reader | composer).

## Env

| Var | Purpose |
|-----|---------|
| `RESEND_INBOX_API_KEY` | Conversational inbox Resend account |
| `RESEND_INBOX_WEBHOOK_SECRET` | Svix secret |
| `INBOX_DOMAIN` | Default `inbox.adehq.com` |
| `INTERNAL_CRON_SECRET` | Auth for jobs drain |

Do not mix with transactional `RESEND_API_KEY` / `sendEmail()`.

## Migrations

1. `20260712180000_workspace_inbox_foundation.sql` — Slice A tables/RLS/storage
2. `20260712222716_inbox_slice_b.sql` — Slice B fields, permissions, tombstones, `client_send_id`

```bash
npx supabase db push --linked
```

## Out of scope (Slice C+)

- Inbox Brief AI dashboard
- AI draft / approval steward
- NL search
- Multi-alias UI
