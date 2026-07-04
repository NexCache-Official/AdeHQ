-- V19.9.1a — Work Hours shadow metering (measurement only, no charging)

create table if not exists public.ai_work_minutes_ledger (
  id uuid primary key default gen_random_uuid(),

  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id text null,

  source_type text not null,
  source_id text null,

  work_unit_id text null,
  usage_event_id text null,

  capability text null,
  work_type text null,
  provider_route text null,
  provider_name text null,
  model_id text null,

  estimated_cost_usd numeric(12, 6) null,
  actual_cost_usd numeric(12, 6) null,

  work_minutes_estimated numeric(10, 2) not null default 0,
  work_minutes_charged numeric(10, 2) null,

  billing_week_start date not null,
  billing_month_start date not null,

  mode text not null default 'shadow',
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_ai_work_minutes_ledger_workspace_week
  on public.ai_work_minutes_ledger (workspace_id, billing_week_start);

create index if not exists idx_ai_work_minutes_ledger_employee_week
  on public.ai_work_minutes_ledger (employee_id, billing_week_start)
  where employee_id is not null;

create index if not exists idx_ai_work_minutes_ledger_work_unit
  on public.ai_work_minutes_ledger (work_unit_id)
  where work_unit_id is not null;

create index if not exists idx_ai_work_minutes_ledger_usage_event
  on public.ai_work_minutes_ledger (usage_event_id)
  where usage_event_id is not null;

create unique index if not exists idx_ai_work_minutes_ledger_work_unit_source
  on public.ai_work_minutes_ledger (work_unit_id, source_type)
  where work_unit_id is not null;

create unique index if not exists idx_ai_work_minutes_ledger_usage_event_source
  on public.ai_work_minutes_ledger (usage_event_id, source_type)
  where usage_event_id is not null;

alter table public.ai_work_minutes_ledger enable row level security;

drop policy if exists "ai_work_minutes_ledger_select_member" on public.ai_work_minutes_ledger;
create policy "ai_work_minutes_ledger_select_member"
on public.ai_work_minutes_ledger for select
using (public.is_workspace_member(workspace_id));

-- Writes are server-side / service-role only (no insert/update/delete policies for authenticated).
