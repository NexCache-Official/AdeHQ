-- V19.3.0: Durable hiring sessions and candidates (Supabase-backed)

create table if not exists public.hiring_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  maya_room_id text not null,
  maya_topic_id text,
  status text not null default 'active'
    check (status in ('active', 'hiring', 'hired', 'abandoned')),
  step text not null default 'role',
  session_state jsonb not null default '{}'::jsonb,
  job_brief jsonb,
  job_brief_partial jsonb,
  hired_employee_id text,
  dm_room_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hiring_sessions_active_uidx
  on public.hiring_sessions (workspace_id, user_id, maya_room_id)
  where status in ('active', 'hiring');

create index if not exists hiring_sessions_workspace_user_idx
  on public.hiring_sessions (workspace_id, user_id, updated_at desc);

create table if not exists public.hiring_candidates (
  id uuid primary key default gen_random_uuid(),
  hiring_session_id uuid not null references public.hiring_sessions(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  candidate_id text not null,
  sort_order int not null default 0,
  candidate jsonb not null,
  hired boolean not null default false,
  hired_employee_id text,
  created_at timestamptz not null default now(),
  unique (hiring_session_id, candidate_id)
);

create index if not exists hiring_candidates_session_idx
  on public.hiring_candidates (hiring_session_id, sort_order);

drop trigger if exists set_hiring_sessions_updated_at on public.hiring_sessions;
create trigger set_hiring_sessions_updated_at
before update on public.hiring_sessions
for each row execute function public.set_updated_at();

alter table public.hiring_sessions enable row level security;
alter table public.hiring_candidates enable row level security;

drop policy if exists "hiring_sessions_select_member" on public.hiring_sessions;
create policy "hiring_sessions_select_member"
on public.hiring_sessions for select
using (
  public.is_workspace_member(workspace_id)
  and user_id = auth.uid()
);

drop policy if exists "hiring_sessions_insert_member" on public.hiring_sessions;
create policy "hiring_sessions_insert_member"
on public.hiring_sessions for insert
with check (
  public.is_workspace_member(workspace_id)
  and user_id = auth.uid()
);

drop policy if exists "hiring_sessions_update_member" on public.hiring_sessions;
create policy "hiring_sessions_update_member"
on public.hiring_sessions for update
using (
  public.is_workspace_member(workspace_id)
  and user_id = auth.uid()
)
with check (
  public.is_workspace_member(workspace_id)
  and user_id = auth.uid()
);

drop policy if exists "hiring_sessions_delete_member" on public.hiring_sessions;
create policy "hiring_sessions_delete_member"
on public.hiring_sessions for delete
using (
  public.is_workspace_member(workspace_id)
  and user_id = auth.uid()
);

drop policy if exists "hiring_candidates_select_member" on public.hiring_candidates;
create policy "hiring_candidates_select_member"
on public.hiring_candidates for select
using (public.is_workspace_member(workspace_id));

drop policy if exists "hiring_candidates_insert_member" on public.hiring_candidates;
create policy "hiring_candidates_insert_member"
on public.hiring_candidates for insert
with check (public.is_workspace_member(workspace_id));

drop policy if exists "hiring_candidates_update_member" on public.hiring_candidates;
create policy "hiring_candidates_update_member"
on public.hiring_candidates for update
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "hiring_candidates_delete_member" on public.hiring_candidates;
create policy "hiring_candidates_delete_member"
on public.hiring_candidates for delete
using (public.is_workspace_member(workspace_id));
