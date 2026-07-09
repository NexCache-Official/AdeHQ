-- Topic-level search coordination (shared results across employees in a thread).

alter table public.workspace_search_cache
  add column if not exists topic_id text,
  add column if not exists source_agent_run_id text;

create index if not exists idx_workspace_search_cache_topic_key
  on public.workspace_search_cache (workspace_id, topic_id, cache_key)
  where topic_id is not null;

create table if not exists public.topic_search_inflight (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  topic_id text not null,
  cache_key text not null,
  agent_run_id text not null,
  status text not null default 'running',
  result_message_id text,
  shared_from_run_id text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, topic_id, cache_key)
);

create index if not exists idx_topic_search_inflight_expires
  on public.topic_search_inflight (workspace_id, expires_at);

alter table public.topic_search_inflight enable row level security;

drop policy if exists topic_search_inflight_select_member on public.topic_search_inflight;
create policy topic_search_inflight_select_member
  on public.topic_search_inflight
  for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists topic_search_inflight_insert_member on public.topic_search_inflight;
create policy topic_search_inflight_insert_member
  on public.topic_search_inflight
  for insert
  with check (public.is_workspace_member(workspace_id));
