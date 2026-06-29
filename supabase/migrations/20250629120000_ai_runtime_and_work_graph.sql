-- AI runtime, cost governance, and work-graph linking
-- Apply via supabase db push or SQL editor

-- 2.1 ai_employees: model_mode
alter table public.ai_employees
  add column if not exists model_mode text not null default 'balanced'
  check (model_mode in ('cheap','balanced','strong','long_context','coding','creative'));

-- Backfill real employees (production-safe)
update public.ai_employees
  set provider = 'siliconflow', model_mode = 'long_context'
  where role_key = 'research'
    and lower(provider) not in ('mock')
    and provider not in ('siliconflow', 'openai');

update public.ai_employees
  set provider = 'siliconflow', model_mode = 'coding'
  where role_key in ('engineering', 'gamedev')
    and lower(provider) not in ('mock')
    and provider not in ('siliconflow', 'openai');

update public.ai_employees
  set provider = 'siliconflow', model_mode = 'balanced'
  where lower(provider) not in ('mock')
    and provider not in ('siliconflow', 'openai')
    and role_key not in ('research', 'engineering', 'gamedev');

update public.ai_employees set provider = lower(provider) where provider != lower(provider);

-- 2.2 workspace_ai_settings
create table if not exists public.workspace_ai_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  ai_enabled boolean not null default true,
  default_provider text not null default 'siliconflow'
    check (default_provider in ('siliconflow','openai','mock')),
  daily_token_limit bigint not null default 500000,
  daily_cost_limit_usd numeric(10,4) not null default 5.00,
  employee_daily_token_limit bigint not null default 100000,
  max_parallel_runs smallint not null default 3,
  max_output_tokens integer not null default 4096,
  max_tool_runs_per_task smallint not null default 10,
  max_handoff_depth smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2.3 ai_usage_events
create table if not exists public.ai_usage_events (
  id text not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_run_id text,
  employee_id text,
  room_id text,
  trigger_message_id text,
  response_message_id text,
  provider text not null,
  model text not null,
  model_mode text,
  status text not null check (status in ('reserved','success','failed','blocked','fallback')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  estimated_input_tokens integer,
  estimated_max_output_tokens integer,
  estimated_cost_usd numeric(12,6) not null default 0,
  actual_cost_usd numeric(12,6),
  latency_ms integer,
  fallback_used boolean not null default false,
  error_message text,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  primary key (workspace_id, id)
);

create index if not exists idx_ai_usage_workspace_day
  on public.ai_usage_events(workspace_id, created_at desc);
create index if not exists idx_ai_usage_agent_run
  on public.ai_usage_events(workspace_id, agent_run_id);

-- 2.4 agent_runs
create table if not exists public.agent_runs (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  employee_id text not null,
  room_id text not null,
  task_id text,
  trigger_message_id text not null,
  response_message_id text,
  status text not null check (status in (
    'queued','running','waiting_approval','completed','failed','blocked'
  )),
  provider text not null,
  model text not null,
  model_mode text not null,
  estimated_cost_usd numeric(12,6) not null default 0,
  actual_cost_usd numeric(12,6),
  latency_ms integer,
  parent_run_id text,
  handoff_depth smallint not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (workspace_id, id),
  foreign key (workspace_id, room_id)
    references public.project_rooms(workspace_id, id) on delete cascade
);

create index if not exists idx_agent_runs_room
  on public.agent_runs(workspace_id, room_id, started_at desc);

-- 2.5 agent_run_steps
create table if not exists public.agent_run_steps (
  id text not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_run_id text not null,
  room_id text not null,
  employee_id text not null,
  step_type text not null check (step_type in (
    'thinking','model_call','tool_call','memory_write',
    'task_create','approval_request','error'
  )),
  title text not null,
  summary text not null default '',
  status text not null check (status in ('running','success','failed','skipped')),
  metadata_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (workspace_id, id),
  foreign key (workspace_id, agent_run_id)
    references public.agent_runs(workspace_id, id) on delete cascade
);

create index if not exists idx_agent_run_steps_run
  on public.agent_run_steps(workspace_id, agent_run_id, started_at);

-- 2.6 Work graph linking columns
alter table public.messages
  add column if not exists mentions_json jsonb not null default '[]'::jsonb,
  add column if not exists agent_run_id text,
  add column if not exists trigger_message_id text;

alter table public.tasks
  add column if not exists created_by_run_id text;

alter table public.memory_entries
  add column if not exists created_by_run_id text;

alter table public.approvals
  add column if not exists created_by_run_id text;

alter table public.work_log_events
  add column if not exists agent_run_id text;

-- 2.7 RLS
alter table public.workspace_ai_settings enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_run_steps enable row level security;

drop policy if exists "workspace_ai_settings_read_member" on public.workspace_ai_settings;
create policy "workspace_ai_settings_read_member"
on public.workspace_ai_settings for select
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_ai_settings_write_admin" on public.workspace_ai_settings;
create policy "workspace_ai_settings_write_admin"
on public.workspace_ai_settings for all
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

drop policy if exists "ai_usage_events_read_admin" on public.ai_usage_events;
create policy "ai_usage_events_read_admin"
on public.ai_usage_events for select
using (public.is_workspace_admin(workspace_id));

drop policy if exists "ai_usage_events_write_member" on public.ai_usage_events;
create policy "ai_usage_events_write_member"
on public.ai_usage_events for insert
with check (public.is_workspace_member(workspace_id));

drop policy if exists "ai_usage_events_update_member" on public.ai_usage_events;
create policy "ai_usage_events_update_member"
on public.ai_usage_events for update
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "agent_runs_all_member" on public.agent_runs;
create policy "agent_runs_all_member"
on public.agent_runs for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "agent_run_steps_all_member" on public.agent_run_steps;
create policy "agent_run_steps_all_member"
on public.agent_run_steps for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

-- updated_at trigger for workspace_ai_settings
drop trigger if exists set_workspace_ai_settings_updated_at on public.workspace_ai_settings;
create trigger set_workspace_ai_settings_updated_at
before update on public.workspace_ai_settings
for each row execute function public.set_updated_at();
