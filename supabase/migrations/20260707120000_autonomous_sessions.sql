-- Autonomous employees — self-directed plan → act → observe → report loops.
-- An objective session runs one employee across bounded iterations, driving
-- the Tool Execution Core, with hard step/cost budgets, approval pauses, and
-- a human stop control. Rides the existing agent_runs / cost machinery.

alter table public.workspace_ai_settings
  add column if not exists autonomy_step_budget smallint not null default 8,
  add column if not exists autonomy_cost_budget_usd numeric(12,6) not null default 0.50;

-- ---------------------------------------------------------------------------
-- autonomous_sessions — one row per objective handed to an employee.
-- ---------------------------------------------------------------------------

create table if not exists public.autonomous_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id text not null,
  created_by_user_id uuid null,

  room_id text null,
  topic_id text null,
  task_id text null,

  objective text not null,
  status text not null default 'queued'
    check (status in (
      'queued', 'planning', 'running', 'waiting_approval', 'paused',
      'completed', 'failed', 'stopped'
    )),

  -- Guardrails.
  step_budget smallint not null default 8,
  steps_used smallint not null default 0,
  cost_budget_usd numeric(12,6) not null default 0.50,
  cost_used_usd numeric(12,6) not null default 0,

  -- Loop state.
  plan jsonb null,                       -- optional up-front plan (array of steps)
  pending_approval_id text null,         -- set while status = waiting_approval
  result_summary text null,              -- final report when completed
  stop_requested boolean not null default false,
  error_message text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null
);

create index if not exists idx_autonomous_sessions_workspace_created
  on public.autonomous_sessions (workspace_id, created_at desc);
create index if not exists idx_autonomous_sessions_employee
  on public.autonomous_sessions (workspace_id, employee_id, created_at desc);
create index if not exists idx_autonomous_sessions_active
  on public.autonomous_sessions (workspace_id, status)
  where status in ('queued', 'planning', 'running', 'waiting_approval', 'paused');
create index if not exists idx_autonomous_sessions_task
  on public.autonomous_sessions (workspace_id, task_id)
  where task_id is not null;

drop trigger if exists set_autonomous_sessions_updated_at on public.autonomous_sessions;
create trigger set_autonomous_sessions_updated_at
before update on public.autonomous_sessions
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- autonomous_session_steps — the streamable "watch it work" timeline.
-- ---------------------------------------------------------------------------

create table if not exists public.autonomous_session_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  session_id uuid not null references public.autonomous_sessions(id) on delete cascade,
  seq integer not null,
  kind text not null check (kind in (
    'plan', 'thought', 'tool_call', 'observation', 'approval', 'report', 'error', 'status'
  )),
  title text not null,
  detail text null,
  tool_name text null,
  tool_run_id uuid null,
  status text not null default 'success' check (status in ('running', 'success', 'failed', 'pending')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_autonomous_session_steps_session
  on public.autonomous_session_steps (session_id, seq);

create unique index if not exists uq_autonomous_session_steps_seq
  on public.autonomous_session_steps (session_id, seq);

-- Link tool runs back to the autonomous session that produced them (audit).
alter table public.integration_tool_runs
  add column if not exists autonomous_session_id uuid null;

create index if not exists idx_integration_tool_runs_session
  on public.integration_tool_runs (autonomous_session_id)
  where autonomous_session_id is not null;

-- ---------------------------------------------------------------------------
-- Row level security.
-- ---------------------------------------------------------------------------

alter table public.autonomous_sessions enable row level security;
alter table public.autonomous_session_steps enable row level security;

drop policy if exists "autonomous_sessions_all_member" on public.autonomous_sessions;
create policy "autonomous_sessions_all_member"
on public.autonomous_sessions for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "autonomous_session_steps_all_member" on public.autonomous_session_steps;
create policy "autonomous_session_steps_all_member"
on public.autonomous_session_steps for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));
