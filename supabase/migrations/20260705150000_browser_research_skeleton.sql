-- V20.0.0 — Browser Research Skeleton (additive only)
-- Mock research runs + work units. No live browsing. browser_evidence reserved for V20.0.2.

create table if not exists public.browser_research_runs (
  id text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  room_id text null,
  topic_id text null,
  employee_id text not null,
  created_by uuid not null,

  query text not null,
  status text not null default 'created',
  provider text not null default 'mock',
  work_unit_id text null,

  planned_steps jsonb not null default '[]'::jsonb,
  mock_sources jsonb not null default '[]'::jsonb,
  findings jsonb not null default '[]'::jsonb,

  estimated_work_minutes numeric(10, 2) null,
  estimated_cost_usd numeric(12, 6) null,

  error_message text null,
  metadata jsonb not null default '{}'::jsonb,

  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_browser_research_runs_workspace_created
  on public.browser_research_runs (workspace_id, created_at desc);

create index if not exists idx_browser_research_runs_employee_created
  on public.browser_research_runs (employee_id, created_at desc);

create index if not exists idx_browser_research_runs_topic_created
  on public.browser_research_runs (topic_id, created_at desc);

create index if not exists idx_browser_research_runs_status
  on public.browser_research_runs (status);

alter table public.browser_research_runs enable row level security;

drop policy if exists "browser_research_runs_select_member" on public.browser_research_runs;
create policy "browser_research_runs_select_member"
on public.browser_research_runs for select
using (public.is_workspace_member(workspace_id));

drop policy if exists "browser_research_runs_insert_member" on public.browser_research_runs;
create policy "browser_research_runs_insert_member"
on public.browser_research_runs for insert
with check (public.is_workspace_member(workspace_id));

-- Updates/deletes are server-side only (service role) — no member update/delete policies.

drop trigger if exists set_browser_research_runs_updated_at on public.browser_research_runs;
create trigger set_browser_research_runs_updated_at
before update on public.browser_research_runs
for each row execute function public.set_updated_at();

comment on table public.browser_research_runs is
  'V20.0.0 mock browser research runs. Live browsing arrives in V20.0.1+. browser_evidence (drive) is reserved for V20.0.2.';
