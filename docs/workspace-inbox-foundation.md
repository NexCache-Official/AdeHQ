# Workspace Inbox — Slice A–E foundation

Secure foundation for AdeHQ’s **shared workspace inbox** (not per-AI-employee mailboxes). Transport is Resend (`inbox.adehq.com`); system of record is Supabase.

- **Slice A** — schema, provider, webhook, outbox, sanitisation
- **Slice B** — claim-first mailbox, query folders, permissions, drafts, send UI
- **Slice C** — cost-aware Email Steward (organise + on-demand AI drafts + version-locked approval)
- **Slice D** — email → AdeHQ work (rooms/topics/tasks/artifacts/memory) via privacy-safe bridge + Work Graph
- **Slice E** — CRM linking, labels, simple rules, follow-up tasks, Context CRM panel

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

`email.read`, `email.compose`, `email.send`, `email.assign`, `email.create_ai_draft`, `email.approve_ai_send`, `email.manage_mailbox`, `email.manage_rules`.

Approve = manage grant or manager-with-read (plus owners/admins). Rules CRUD requires manage / `email.manage_rules`.

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
→ CRM resolve (existing contact by sender email)
→ user email_rules → heuristics / cheap classifier
→ suggest vs auto-assign (skip if assignment_source = human)
  (Maya / system / DM-only employees are never inbox-eligible)
→ user Draft with AI → draft job → approval envelope → send gate
```

## Slice D — work integration

Privacy-safe `EmailWorkContext` bridge, idempotent `email_work_actions`, Work Graph upsert/unlink, Context work panel. Human actions = 0 Work Hours; AI ask/prepare use `email_ask_employee` / `email_prepare_proposal`.

## Slice E — CRM and workflow

- **IDs:** `assigned_employee_id`, `suggested_employee_id`, `email_drafts.employee_id`, `contact_id`, `deal_id` are **text** (match `ai_employees` / CRM ids).
- **Resolve:** auto-link existing contact by From email; create contact is confirm-gated.
- **Context:** live CRM panel (contact, deal, follow-ups) + labels + work actions.
- **Labels:** `email_labels` / `email_thread_labels` — chips on list + Context; list filter `?label=`; CRUD APIs.
- **Rules:** simple `email_rules` (domain/address/subject/attachment/category → label, priority, assign, spam, waiting). Never send email / never spawn rooms. Rule assigns use `assignment_source = deterministic_rule`.
- **Follow-ups:** dated room-scoped tasks via `create-follow-up`; listed in Context.
- **Detach contact:** tombstones `linked_contact` Work Graph edge and clears `contact_id`.
- **Property linking** and **scheduled send sequences** are out of E.

Also: AI employee **Allow once / Always allow** tool grants use `employee_tool_session_grants` (platform-wide, not inbox-only).

### Key E routes

| Method | Path |
|--------|------|
| GET | `/api/inbox/threads/[id]/context` (includes `crm`) |
| POST | `/api/inbox/threads/[id]/work/attach-contact` |
| POST | `/api/inbox/threads/[id]/work/create-contact` |
| POST | `/api/inbox/threads/[id]/work/detach-contact` |
| POST | `/api/inbox/threads/[id]/work/create-follow-up` |
| GET/POST | `/api/inbox/labels` |
| PUT | `/api/inbox/threads/[id]/labels` |
| GET | `/api/inbox/threads?label=` |
| GET/POST | `/api/inbox/rules` |

## Key routes (C + D + E)

| Method | Path |
|--------|------|
| GET/PATCH | `/api/inbox/mailbox/settings` |
| POST | `/api/inbox/threads/[id]/assign` |
| POST | `/api/inbox/threads/[id]/draft` |
| GET/POST | `/api/inbox/jobs/process` (cron via `vercel.json`) |
| GET | `/api/inbox/threads/[id]/context` |
| POST | `/api/inbox/threads/[id]/work/*` |
| GET | `/api/inbox/deals` |

## Migrations

1. `20260712180000_workspace_inbox_foundation.sql` — Slice A
2. `20260712222716_inbox_slice_b.sql` — Slice B
3. `20260713210328_inbox_slice_c.sql` — empty stub
4. `20260713210407_inbox_slice_c.sql` — Slice C
5. `20260714141733_inbox_slice_d.sql` — empty stub
6. `20260714141823_inbox_slice_d.sql` — Slice D
7. `20260714145149_inbox_slice_e.sql` — Slice E (employee/CRM text IDs + FKs)
8. `20260714150150_employee_tool_session_grants.sql` — Allow-once tool session grants

## Out of scope (F+)

- Custom domains, aliases UX, Gmail/Outlook sync → **F**
- Autonomous send / AI auto-draft mode → **G**
- Property linking (no CRM property entity yet)
- Scheduled outbound sequences / Scheduled folder as send queue
- Silent auto-create contacts; auto-sending follow-up emails
