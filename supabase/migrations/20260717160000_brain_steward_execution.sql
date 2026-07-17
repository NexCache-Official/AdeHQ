-- PR-19 Steward execution: work leases + shared findings board

-- ---------------------------------------------------------------------------
-- Work leases — one active owner per brain step
-- ---------------------------------------------------------------------------
create table if not exists public.brain_work_leases (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brain_run_id text not null,
  brain_step_id text not null,
  employee_id text not null,
  leased_at timestamptz not null default now(),
  expires_at timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  status text not null default 'active'
    check (status in ('active', 'released', 'expired')),
  agent_run_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists brain_work_leases_active_step_unique
  on public.brain_work_leases (brain_step_id)
  where status = 'active';

create index if not exists idx_brain_work_leases_run
  on public.brain_work_leases (workspace_id, brain_run_id, status);

alter table public.brain_work_leases enable row level security;

-- ---------------------------------------------------------------------------
-- Shared findings — structured collaborator outputs (no private DM bleed)
-- ---------------------------------------------------------------------------
create table if not exists public.brain_shared_findings (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brain_run_id text not null,
  brain_step_id text,
  produced_by_employee_id text not null,
  title text not null,
  summary text not null,
  evidence_source_ids jsonb not null default '[]'::jsonb,
  artifact_ids jsonb not null default '[]'::jsonb,
  confidence numeric(4,3) not null default 0.7,
  visibility text not null default 'lead_only'
    check (visibility in ('lead_only', 'room', 'workspace')),
  contains_private_dm_context boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_brain_shared_findings_run
  on public.brain_shared_findings (workspace_id, brain_run_id, created_at);

alter table public.brain_shared_findings enable row level security;

-- Steward plan snapshot on brain_runs
alter table public.brain_runs
  add column if not exists steward_plan jsonb,
  add column if not exists steward_progress jsonb not null default '{}'::jsonb;
