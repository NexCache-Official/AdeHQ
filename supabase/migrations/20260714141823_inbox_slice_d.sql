-- Slice D: email → work integration (idempotent actions, Work Graph tombstones, memory provenance)

-- ---------------------------------------------------------------------------
-- Work Graph: tombstone / unlink support + unique active edges
-- ---------------------------------------------------------------------------
alter table public.work_graph_edges
  add column if not exists unlinked_at timestamptz,
  add column if not exists unlinked_by uuid,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists work_graph_edges_active_unique
  on public.work_graph_edges (
    workspace_id,
    from_object_type,
    from_object_id,
    to_object_type,
    to_object_id,
    relation_type
  )
  where unlinked_at is null;

create index if not exists idx_work_graph_edges_thread_active
  on public.work_graph_edges (workspace_id, from_object_id)
  where from_object_type = 'email_thread' and unlinked_at is null;

-- ---------------------------------------------------------------------------
-- Idempotent inbox work actions
-- ---------------------------------------------------------------------------
create table if not exists public.email_work_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mailbox_id uuid references public.workspace_mailboxes(id) on delete set null,
  thread_id uuid references public.email_threads(id) on delete set null,
  client_action_id text not null,
  action_type text not null,
  actor_user_id uuid not null,
  status text not null default 'completed'
    check (status in ('completed', 'failed')),
  result_payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  unique (workspace_id, client_action_id)
);

create index if not exists idx_email_work_actions_thread
  on public.email_work_actions (workspace_id, thread_id, created_at desc);

alter table public.email_work_actions enable row level security;

drop policy if exists "email_work_actions_member_select" on public.email_work_actions;
create policy "email_work_actions_member_select"
on public.email_work_actions for select
using (public.is_active_workspace_member(workspace_id));

-- Service role / API uses secret client for writes; no insert policy for authed users.

-- ---------------------------------------------------------------------------
-- Memory: message-level email provenance (general source reference)
-- ---------------------------------------------------------------------------
alter table public.memory_entries
  add column if not exists source_object_type text,
  add column if not exists source_object_id text,
  add column if not exists source_thread_id text,
  add column if not exists source_excerpt text,
  add column if not exists source_received_at timestamptz,
  add column if not exists external_sender text,
  add column if not exists reviewed_by_user_id uuid;

create index if not exists idx_memory_entries_source_thread
  on public.memory_entries (workspace_id, source_thread_id)
  where source_thread_id is not null;

comment on table public.email_work_actions is
  'Idempotency ledger for Slice D inbox→work actions (client_action_id unique per workspace).';
