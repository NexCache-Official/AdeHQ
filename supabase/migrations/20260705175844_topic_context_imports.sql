-- V19.9.4: Topic forks with context receipts

create table if not exists public.topic_context_imports (
  id uuid primary key default gen_random_uuid(),

  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  source_room_id text null,
  source_topic_id text null,
  source_dm_id text null,

  target_room_id text null,
  target_topic_id text not null,

  created_by uuid not null,

  import_reason text not null default 'topic_suggestion',
  suggested_title text null,

  source_message_ids text[] not null default '{}',
  source_range_start_message_id text null,
  source_range_end_message_id text null,

  summary text null,
  key_facts jsonb not null default '[]'::jsonb,
  open_questions jsonb not null default '[]'::jsonb,
  participants jsonb not null default '[]'::jsonb,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_topic_context_imports_workspace_created
  on public.topic_context_imports(workspace_id, created_at desc);

create index if not exists idx_topic_context_imports_target_topic
  on public.topic_context_imports(target_topic_id);

create index if not exists idx_topic_context_imports_source_topic
  on public.topic_context_imports(source_topic_id);

create index if not exists idx_topic_context_imports_source_dm
  on public.topic_context_imports(source_dm_id);

alter table public.topic_context_imports enable row level security;

drop policy if exists "topic_context_imports_member" on public.topic_context_imports;
create policy "topic_context_imports_member"
on public.topic_context_imports for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

comment on table public.topic_context_imports is
  'Read-only context receipts imported when forking a focused topic from a room, topic, or DM.';

alter table public.topic_suggestions
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.topic_suggestions.metadata is
  'Preview payload for topic fork suggestions (contextSummary, sourceScope, previewBullets).';
