# Workspace Inbox — Slice A + B + C foundation

Secure foundation for AdeHQ’s **shared workspace inbox** (not per-AI-employee mailboxes). Transport is Resend (`inbox.adehq.com`); system of record is Supabase.

- **Slice A** — schema, provider, webhook, outbox, sanitisation
- **Slice B** — claim-first mailbox, query folders, permissions, drafts, send UI
- **Slice C** — cost-aware Email Steward (organise + on-demand AI drafts + version-locked approval)

Slice 0 transport proof remains under `src/lib/inbox-transport-proof/` — do not delete yet.

## Address model

- Format: `{canonical_local_part}@inbox.adehq.com`
- **Claim-first**: owner/admin chooses the local-part; no silent auto-provision on workspace create
- Default assistance mode on claim: **Organise inbox** (`ai_triage`) with consent copy (no auto-draft/send)
- Consent audit: `mailbox.assistance_consent`
- `canonical_local_part` is **immutable** after claim
- One **primary** mailbox at launch; every thread/message has `mailbox_id`

## Permissions

Inbox is **not** plain workspace membership. Approve = manage grant or manager-with-read (plus owners/admins).

## Folders (queries)

| UI folder | Query |
|-----------|-------|
| Inbox | `status in (open,waiting)`, not spam |
| AI working | `triage_status` or `draft_status` in queued/running (active jobs only) |
| Needs approval | AI/origin drafts with pending approval or awaiting request; excludes stale |
| Awaiting reply | latest outbound |
| Sent | direction outbound/mixed |
| Drafts / Archived / Spam | as before |

## Slice C steward (cheap)

```
Inbound store → email_jobs triage (idempotent)
→ best-effort drain + Vercel Cron recovery (*/2)
→ rules/heuristics; cheap classifier only when ambiguous
→ suggest vs auto-assign (≥0.90 deterministic / continuity)
→ user Draft with AI → draft job → approval envelope → send gate
```

- `triage_status` and `draft_status` are **independent**
- Assignment never starts a model
- `summary` optional; rules only produce `keyPoints`
- AI-origin drafts always require server-recomputed envelope approval (with expiry)
- Bounce DSN updates outbound delivery; never opens a customer thread
- Job leases reclaim after 5 minutes; failed jobs retry with backoff (max 3)
- Rate limits: triage/min, draft jobs/user/min, concurrent jobs; delayed enqueue under pressure
- Ledger: `email_triage`, `email_draft`, `email_draft_rewrite`

## Approval / send gate

- Hash covers mailbox, from, reply-to, to/cc/bcc, subject, plain, HTML, attachments, thread, draft version
- UI emphasises From / To / Cc / Bcc / Attachments before Approve
- Send blocked client-side and server-side until approved hash matches and has not expired
- Edits invalidate approval; AI origin remains `requires_approval`

## Key routes (added in C)

| Method | Path |
|--------|------|
| GET/PATCH | `/api/inbox/mailbox/settings` |
| POST | `/api/inbox/threads/[id]/assign` |
| POST | `/api/inbox/threads/[id]/draft` |
| POST | `/api/inbox/threads/[id]/draft/cancel` |
| POST | `/api/inbox/threads/[id]/suggestion/dismiss` |
| GET | `/api/inbox/drafts/[id]/versions` |
| POST | `/api/inbox/drafts/[id]/approvals` |
| POST | `/api/inbox/approvals/[id]/decide` |
| GET/POST | `/api/inbox/jobs/process` (cron every 2m via `vercel.json`) |

## Migrations

1. `20260712180000_workspace_inbox_foundation.sql` — Slice A
2. `20260712222716_inbox_slice_b.sql` — Slice B
3. `20260713210328_inbox_slice_c.sql` — empty stub (CLI hung)
4. `20260713210407_inbox_slice_c.sql` — Slice C schema (`email_jobs`, triage/draft columns, approval hash/expiry, limits)

## Out of scope (D+)

- Inbox Brief dashboard, NL search, Work Graph/memory, CRM Context, multi-alias, autonomous send (G)
