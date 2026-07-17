-- PR-17.5 Brain Reliability Foundation
-- Extends brain_runs / brain_capability_steps for unified lifecycle,
-- permission envelopes, budgets, and step idempotency.

-- ---------------------------------------------------------------------------
-- brain_runs: initiator, lifecycle, budget, permission envelope
-- ---------------------------------------------------------------------------
alter table public.brain_runs
  add column if not exists initiated_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists lifecycle_status text,
  add column if not exists estimated_wh_min numeric(12,4) not null default 0,
  add column if not exists estimated_wh_max numeric(12,4) not null default 0,
  add column if not exists hard_wh_limit numeric(12,4) not null default 50,
  add column if not exists actual_wh numeric(12,4) not null default 0,
  add column if not exists permission_version bigint not null default 1,
  add column if not exists permission_envelope jsonb not null default '{}'::jsonb,
  add column if not exists agent_run_id text;

update public.brain_runs
set lifecycle_status = case
  when status = 'running' then 'running'
  when status = 'completed' then 'completed'
  when status = 'failed' then 'failed'
  when status = 'cancelled' then 'cancelled'
  when status = 'blocked' then 'waiting_for_approval'
  else 'running'
end
where lifecycle_status is null;

alter table public.brain_runs
  alter column lifecycle_status set default 'running';

alter table public.brain_runs
  drop constraint if exists brain_runs_lifecycle_status_check;
alter table public.brain_runs
  add constraint brain_runs_lifecycle_status_check
  check (
    lifecycle_status in (
      'planning',
      'running',
      'waiting_for_approval',
      'completed',
      'failed',
      'cancelled'
    )
  );

-- Widen legacy status to include planning / waiting (keep old values)
alter table public.brain_runs drop constraint if exists brain_runs_status_check;
alter table public.brain_runs
  add constraint brain_runs_status_check
  check (
    status in (
      'planning',
      'running',
      'waiting_for_approval',
      'completed',
      'failed',
      'cancelled',
      'blocked'
    )
  );

create index if not exists idx_brain_runs_initiator
  on public.brain_runs (workspace_id, initiated_by_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- brain_capability_steps: leases, idempotency, WH, failure class
-- ---------------------------------------------------------------------------
alter table public.brain_capability_steps
  add column if not exists assigned_employee_id text,
  add column if not exists idempotency_key text,
  add column if not exists estimated_wh numeric(12,4) not null default 0,
  add column if not exists actual_wh numeric(12,4) not null default 0,
  add column if not exists input_contract_version integer not null default 1,
  add column if not exists output_contract_version integer not null default 1,
  add column if not exists failure_class text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists lease_heartbeat_at timestamptz,
  add column if not exists completed_at timestamptz;

-- Backfill idempotency keys for existing rows
update public.brain_capability_steps
set idempotency_key = id
where idempotency_key is null;

create unique index if not exists brain_capability_steps_idempotency_unique
  on public.brain_capability_steps (brain_run_id, idempotency_key)
  where idempotency_key is not null;

alter table public.brain_capability_steps
  drop constraint if exists brain_capability_steps_status_check;
alter table public.brain_capability_steps
  add constraint brain_capability_steps_status_check
  check (
    status in (
      'pending',
      'queued',
      'leased',
      'running',
      'waiting_for_approval',
      'completed',
      'failed',
      'cancelled'
    )
  );

alter table public.brain_capability_steps
  drop constraint if exists brain_capability_steps_failure_class_check;
alter table public.brain_capability_steps
  add constraint brain_capability_steps_failure_class_check
  check (
    failure_class is null
    or failure_class in (
      'transient_provider',
      'malformed_output',
      'permission',
      'user_input',
      'insufficient_evidence',
      'internal_application',
      'cancelled',
      'budget'
    )
  );

-- ---------------------------------------------------------------------------
-- Route health snapshots (optional persistence for circuit breakers)
-- ---------------------------------------------------------------------------
create table if not exists public.brain_route_health (
  route_id text primary key,
  recent_success_rate numeric(6,4) not null default 1,
  recent_timeout_rate numeric(6,4) not null default 0,
  p50_latency_ms integer not null default 0,
  p95_latency_ms integer not null default 0,
  schema_failure_rate numeric(6,4) not null default 0,
  disabled_until timestamptz,
  sample_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.brain_route_health enable row level security;
-- No authenticated policies: service_role bypasses RLS; clients cannot read route health.
