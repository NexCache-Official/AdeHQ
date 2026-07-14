# Workspace Inbox — Slice A–D foundation

Secure foundation for AdeHQ’s **shared workspace inbox** (not per-AI-employee mailboxes). Transport is Resend (`inbox.adehq.com`); system of record is Supabase.

- **Slice A** — schema, provider, webhook, outbox, sanitisation
- **Slice B** — claim-first mailbox, query folders, permissions, drafts, send UI
- **Slice C** — cost-aware Email Steward (organise + on-demand AI drafts + version-locked approval)
- **Slice D** — email → AdeHQ work (rooms/topics/tasks/artifacts/memory) via privacy-safe bridge + Work Graph

Slice 0 transport proof remains under `src/lib/inbox-transport-proof/` — do not delete yet.

## Address model

- Format: `{canonical_local_part}@inbox.adehq.com`
- **Claim-first**: owner/admin chooses the local-part; no silent auto-provision on workspace create
- Default assistance mode on claim: **Organise inbox** (`ai_triage`) with consent copy (no auto-draft/send)
- Consent audit: `mailbox.assistance_consent`
- `canonical_local_part` is **immutable** after claim
- One **primary** mailbox at launch; every thread/message has `mailbox_id`

## Permissions

Inbox is **not** plain workspace membership. Coarse mailbox grants map to plan names at the API:

`email.read`, `email.compose`, `email.send`, `email.assign`, `email.create_ai_draft`, `email.approve_ai_send`, `email.manage_mailbox`.

Approve = manage grant or manager-with-read (plus owners/admins).

## Folders (queries)

| UI folder | Query |
|-----------|-------|
| Inbox | `status in (open,waiting)`, not spam |
| Assigned to me | `assigned_human_id = current user` |
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
  (Maya / system / DM-only employees are never inbox-eligible)
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

## Slice D — work integration

An email thread can spawn or link rooms, topics, tasks, decision/proposal artifacts, and reviewable memory — with Work Graph edges, idempotent actions, and privacy-safe bridging.

### Privacy bridge (`EmailWorkContext`)

Default room/DM seeding uses structured context only (subject, participants, steward summary, key points, hard-capped excerpt, deep link, safety flags). Full raw body is never copied into rooms by default. Deep link: `/inbox?thread=` — requires mailbox read ACL; room members without inbox permission see the bridge card but cannot open the original email.

### Idempotency

Every work action accepts `clientActionId` (UUID). Rows in `email_work_actions` are unique on `(workspace_id, client_action_id)`; retries return the prior result.

### Work Graph

Module: `src/lib/inbox/work-graph.ts`. One active edge per `(workspace, from, to, relation_type)`; unlink tombstones (`unlinked_at` / `unlinked_by`). Relations: `spawned_room`, `linked_room`, `linked_topic`, `linked_task`, `linked_artifact`, `sources_memory`, `linked_deal`. Assignment remains on `email_threads.assigned_*` columns (no `assigned_owner` edges).

### Provenance & staleness

Created work snapshots `sourceEmailThreadId`, `sourceEmailMessageId`, `sourceSnapshotAt`, optional summary version. Context shows “Based on older email context” when newer inbound exists.

### Actions (`/api/inbox/threads/[threadId]/work/**`)

| Action | Notes |
|--------|-------|
| start-room / link-room | Separate APIs; start ≠ link |
| link-topic / create-task | Room-scoped; Maya excluded from assignees |
| ask-employee | No silent room; no outbound email; explicit DM / start room / link room |
| create-proposal | Sync placeholder artifact |
| prepare-proposal | Async AI; Work Hours (`email_prepare_proposal`) |
| save-decision | Canonical decision artifact (not memory-primary) |
| memory | Confirm → save with message-level provenance + dedupe |
| attach-deal | Thin: existing deal only |
| unlink | Tombstone edge |

Human-only actions consume **0** Work Hours. AI ask/prepare queue agent runs and bill shadow minutes under `email_ask_employee` / `email_prepare_proposal`.

### Context tab UX

`GET /api/inbox/threads/[threadId]/context` + `EmailWorkPanel`: linked-work cards, recommended next step, secondary action menu, unlink, staleness badges.

## Key routes (C + D)

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
| GET/POST | `/api/inbox/jobs/process` (cron via `vercel.json`) |
| GET | `/api/inbox/threads/[id]/context` |
| POST | `/api/inbox/threads/[id]/work/*` |
| GET | `/api/inbox/deals` |

## Migrations

1. `20260712180000_workspace_inbox_foundation.sql` — Slice A
2. `20260712222716_inbox_slice_b.sql` — Slice B
3. `20260713210328_inbox_slice_c.sql` — empty stub (CLI hung)
4. `20260713210407_inbox_slice_c.sql` — Slice C schema (`email_jobs`, triage/draft columns, approval hash/expiry, limits)
5. `20260714141733_inbox_slice_d.sql` — empty stub
6. `20260714141823_inbox_slice_d.sql` — Slice D (`email_work_actions`, Work Graph tombstones/unique active index, memory source columns)

## Out of scope (E+)

- Full CRM Context panels, auto contact create, labels/rules, follow-up automation → **E**
- Custom domains, aliases UX, Gmail/Outlook sync → **F**
- Autonomous send / AI auto-draft mode → **G**
- Auto-regenerating stale proposals/tasks; dumping full emails into rooms/memory
- Assigning Maya to email work; authoritative `assigned_owner` graph edges
