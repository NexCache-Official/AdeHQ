-- Commercial Usage System — Phase 3: weekly AI Work Hours usage periods.
-- Rolls billable cost ledger events into weekly per-workspace allowance vs usage.
-- Week boundary: Monday 00:00 UTC.

create table if not exists public.workspace_usage_periods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_slug text not null,
  period_type text not null default 'weekly',
  period_start timestamptz not null,
  period_end timestamptz not null,

  ai_work_hours_allowance numeric(14,4) not null,
  ai_work_hours_used numeric(14,4) not null default 0,
  ai_work_hours_remaining numeric(14,4) generated always as
    (greatest(ai_work_hours_allowance - ai_work_hours_used, 0)) stored,

  actual_cost_usd numeric(14,8) not null default 0,
  status text not null default 'active',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, period_start, period_end)
);

create index if not exists idx_workspace_usage_periods_workspace
  on public.workspace_usage_periods (workspace_id, period_start desc);

drop trigger if exists set_workspace_usage_periods_updated_at on public.workspace_usage_periods;
create trigger set_workspace_usage_periods_updated_at
  before update on public.workspace_usage_periods
  for each row execute function public.set_updated_at();

-- Atomic rollup: increment used Work Hours + actual cost for the current period.
create or replace function public.increment_workspace_usage_period(
  p_period_id uuid,
  p_work_hours numeric,
  p_cost_usd numeric
) returns void
language sql
as $$
  update public.workspace_usage_periods
  set ai_work_hours_used = ai_work_hours_used + coalesce(p_work_hours, 0),
      actual_cost_usd = actual_cost_usd + coalesce(p_cost_usd, 0)
  where id = p_period_id;
$$;

alter table public.workspace_usage_periods enable row level security;
