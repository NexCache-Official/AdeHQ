-- One-time / session-scoped tool capability grants (Allow Once).

create table if not exists public.employee_tool_session_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id text not null,
  catalog_tool_id text not null,
  room_id text,
  topic_id text,
  permission text not null default 'write'
    check (permission in ('read', 'write')),
  granted_by uuid references auth.users(id) on delete set null,
  approval_id text,
  uses_remaining int not null default 1 check (uses_remaining >= 0),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

create index if not exists idx_employee_tool_session_grants_lookup
  on public.employee_tool_session_grants (
    workspace_id,
    employee_id,
    catalog_tool_id
  )
  where uses_remaining > 0;

alter table public.employee_tool_session_grants enable row level security;

drop policy if exists "employee_tool_session_grants_member_select"
  on public.employee_tool_session_grants;
create policy "employee_tool_session_grants_member_select"
on public.employee_tool_session_grants for select
using (public.is_active_workspace_member(workspace_id));

comment on table public.employee_tool_session_grants is
  'Ephemeral Allow Once tool grants for AI employees (iOS-style permission).';
