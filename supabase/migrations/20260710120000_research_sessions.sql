-- Research sessions: reusable multi-search findings within a topic.

create table if not exists public.research_sessions (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  topic_id uuid not null,
  title text not null,
  status text not null default 'active',
  lead_employee_id text,
  created_by_run_id text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_research_sessions_workspace_topic
  on public.research_sessions (workspace_id, topic_id, status, expires_at desc);

create table if not exists public.research_session_events (
  id text primary key,
  session_id text not null references public.research_sessions(id) on delete cascade,
  event_type text not null default 'search',
  query text,
  answer text,
  sources jsonb not null default '[]'::jsonb,
  provider text,
  provider_route text,
  confidence numeric,
  agent_run_id text,
  message_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_research_session_events_session
  on public.research_session_events (session_id, created_at desc);

alter table public.research_sessions enable row level security;
alter table public.research_session_events enable row level security;

drop policy if exists research_sessions_select_member on public.research_sessions;
create policy research_sessions_select_member
  on public.research_sessions
  for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists research_sessions_insert_member on public.research_sessions;
create policy research_sessions_insert_member
  on public.research_sessions
  for insert
  with check (public.is_workspace_member(workspace_id));

drop policy if exists research_sessions_update_member on public.research_sessions;
create policy research_sessions_update_member
  on public.research_sessions
  for update
  using (public.is_workspace_member(workspace_id));

drop policy if exists research_session_events_select_member on public.research_session_events;
create policy research_session_events_select_member
  on public.research_session_events
  for select
  using (
    exists (
      select 1 from public.research_sessions rs
      where rs.id = research_session_events.session_id
        and public.is_workspace_member(rs.workspace_id)
    )
  );

drop policy if exists research_session_events_insert_member on public.research_session_events;
create policy research_session_events_insert_member
  on public.research_session_events
  for insert
  with check (
    exists (
      select 1 from public.research_sessions rs
      where rs.id = research_session_events.session_id
        and public.is_workspace_member(rs.workspace_id)
    )
  );
