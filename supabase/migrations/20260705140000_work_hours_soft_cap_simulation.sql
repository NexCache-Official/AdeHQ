-- V19.9.1c-final — Work Hours soft-cap simulation events (simulation only, no enforcement)

create table if not exists public.ai_work_hours_simulation_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id text null,

  event_type text not null,
  source_type text not null,
  source_id text null,

  work_type text null,
  capability text null,

  used_minutes_before numeric(10, 2) not null default 0,
  estimated_next_minutes numeric(10, 2) not null default 0,
  projected_minutes_after numeric(10, 2) not null default 0,

  workspace_soft_cap_minutes numeric(10, 2) null,
  employee_soft_cap_minutes numeric(10, 2) null,

  would_exceed_workspace_soft_cap boolean not null default false,
  would_exceed_employee_soft_cap boolean not null default false,

  action text not null default 'allow',
  shadow_only boolean not null default true,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_work_hours_simulation_events_workspace_created
  on public.ai_work_hours_simulation_events (workspace_id, created_at desc);

create index if not exists idx_ai_work_hours_simulation_events_workspace_week
  on public.ai_work_hours_simulation_events (workspace_id, created_at);

alter table public.ai_work_hours_simulation_events enable row level security;

drop policy if exists "ai_work_hours_simulation_events_select_member" on public.ai_work_hours_simulation_events;
create policy "ai_work_hours_simulation_events_select_member"
on public.ai_work_hours_simulation_events for select
using (public.is_workspace_member(workspace_id));

-- Writes are server-side / service-role only (no insert/update/delete policies for authenticated).
