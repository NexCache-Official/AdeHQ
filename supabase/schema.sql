-- AdeHQ Supabase schema
-- Run this in the Supabase SQL editor before using the app with a fresh project.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  avatar text,
  role text not null default 'Founder',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  plan text not null default 'founder',
  workspace_mode text not null default 'real' check (workspace_mode in ('real', 'demo')),
  owner_id uuid not null references auth.users(id) on delete cascade,
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'active' check (status in ('active', 'removed')),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invited_email text not null,
  invited_by uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'pending',
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  expires_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tools (
  id text primary key,
  name text not null,
  category text not null,
  description text not null,
  status text not null default 'not_connected',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_tools (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  tool_id text not null references public.tools(id) on delete cascade,
  status text not null default 'not_connected',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, tool_id)
);

create table if not exists public.ai_employees (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  name text not null,
  role text not null,
  role_key text not null,
  provider text not null,
  model text not null,
  model_mode text not null default 'balanced'
    check (model_mode in ('cheap','balanced','strong','long_context','coding','creative')),
  seniority text not null,
  status text not null,
  current_task text,
  instructions text not null,
  communication_style text not null,
  success_criteria text not null,
  permissions jsonb not null default '{}'::jsonb,
  memory_count integer not null default 0,
  tasks_completed integer not null default 0,
  messages_sent integer not null default 0,
  approvals_requested integer not null default 0,
  avg_response_time text not null default '-',
  trust_score integer not null default 75,
  accent text not null default '#f97316',
  default_room_id text,
  is_system_employee boolean not null default false,
  system_employee_key text,
  metadata jsonb not null default '{}'::jsonb,
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists public.employee_tools (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id text not null,
  tool_id text not null references public.tools(id) on delete cascade,
  status text not null default 'mock',
  permission text not null default 'read',
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, employee_id, tool_id),
  foreign key (workspace_id, employee_id)
    references public.ai_employees(workspace_id, id)
    on delete cascade
);

create table if not exists public.rooms (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  name text not null,
  kind text not null default 'room',
  dm_employee_id text,
  description text not null default '',
  brief text not null default '',
  unread integer not null default 0,
  accent text not null default '#f97316',
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  constraint rooms_kind_shape check (
    (kind = 'dm' and dm_employee_id is not null)
    or (kind <> 'dm' and dm_employee_id is null)
  )
);

create table if not exists public.room_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  room_id text not null,
  member_type text not null check (member_type in ('human', 'ai')),
  member_id text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, room_id, member_type, member_id),
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id)
    on delete cascade
);

create table if not exists public.messages (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  room_id text not null,
  sender_type text not null,
  sender_id text not null,
  sender_name text not null,
  content text not null,
  mentions jsonb not null default '[]'::jsonb,
  mentions_json jsonb not null default '[]'::jsonb,
  agent_run_id text,
  trigger_message_id text,
  artifacts jsonb,
  pending boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id)
    on delete cascade
);

create table if not exists public.tasks (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  room_id text not null,
  title text not null,
  description text,
  status text not null,
  priority text not null,
  assignee_type text not null,
  assignee_id text not null,
  created_from text,
  created_by_run_id text,
  due_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id)
    on delete cascade
);

create table if not exists public.memory_entries (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  room_id text not null,
  type text not null,
  title text not null,
  content text not null,
  status text not null,
  created_by_type text not null,
  created_by_id text not null,
  created_by_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id)
    on delete cascade
);

create table if not exists public.approvals (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  room_id text not null,
  requested_by text not null,
  title text not null,
  description text not null default '',
  risk text not null,
  status text not null,
  action_type text not null,
  created_by_run_id text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id)
    on delete cascade
);

create table if not exists public.work_log_events (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  room_id text not null,
  employee_id text not null,
  action text not null,
  summary text not null default '',
  tool_used text,
  status text not null,
  related_entity_type text,
  related_entity_id text,
  agent_run_id text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id)
    on delete cascade
);

create table if not exists public.calls (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  room_id text not null,
  title text not null,
  status text not null,
  participants jsonb not null default '[]'::jsonb,
  transcript jsonb not null default '[]'::jsonb,
  action_items jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id)
    on delete cascade
);

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
  autonomy_step_budget smallint not null default 8,
  autonomy_cost_budget_usd numeric(12,6) not null default 0.50,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
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
  finalized_at timestamptz
);

create table if not exists public.agent_runs (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  employee_id text not null,
  room_id text not null,
  task_id text,
  trigger_message_id text not null,
  response_message_id text,
  status text not null check (status in (
    'queued','waiting','running','waiting_approval','completed','failed','blocked','cancelled'
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
    references public.rooms(workspace_id, id) on delete cascade
);

create table if not exists public.agent_run_steps (
  id uuid primary key default gen_random_uuid(),
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
  foreign key (workspace_id, agent_run_id)
    references public.agent_runs(workspace_id, id) on delete cascade
);

create table if not exists public.model_provider_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (
    provider in ('openai', 'anthropic', 'gemini', 'perplexity', 'openrouter', 'siliconflow', 'mock')
  ),
  encrypted_api_key text,
  vault_secret_id text,
  default_model text,
  status text not null default 'not_configured',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create table if not exists public.call_transcripts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  call_id text not null,
  speaker_id text not null,
  speaker_name text not null,
  text text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, call_id)
    references public.calls(workspace_id, id)
    on delete cascade
);

create index if not exists idx_workspace_members_user
  on public.workspace_members(user_id);
create index if not exists idx_workspace_invitations_email_status
  on public.workspace_invitations(lower(invited_email), status);
create index if not exists idx_workspace_invitations_workspace
  on public.workspace_invitations(workspace_id, created_at desc);
create index if not exists idx_messages_room_created
  on public.messages(workspace_id, room_id, created_at);
create index if not exists idx_tasks_room
  on public.tasks(workspace_id, room_id);
create index if not exists idx_memory_room
  on public.memory_entries(workspace_id, room_id);
create index if not exists idx_work_log_room_created
  on public.work_log_events(workspace_id, room_id, created_at desc);
create index if not exists idx_ai_usage_workspace_day
  on public.ai_usage_events(workspace_id, created_at desc);
create index if not exists idx_ai_usage_agent_run
  on public.ai_usage_events(workspace_id, agent_run_id);
create index if not exists idx_agent_runs_room
  on public.agent_runs(workspace_id, room_id, started_at desc);
create index if not exists idx_agent_run_steps_run
  on public.agent_run_steps(workspace_id, agent_run_id, started_at);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_workspaces_updated_at on public.workspaces;
create trigger set_workspaces_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

drop trigger if exists set_workspace_invitations_updated_at on public.workspace_invitations;
create trigger set_workspace_invitations_updated_at
before update on public.workspace_invitations
for each row execute function public.set_updated_at();

drop trigger if exists set_tools_updated_at on public.tools;
create trigger set_tools_updated_at
before update on public.tools
for each row execute function public.set_updated_at();

drop trigger if exists set_workspace_tools_updated_at on public.workspace_tools;
create trigger set_workspace_tools_updated_at
before update on public.workspace_tools
for each row execute function public.set_updated_at();

drop trigger if exists set_ai_employees_updated_at on public.ai_employees;
create trigger set_ai_employees_updated_at
before update on public.ai_employees
for each row execute function public.set_updated_at();

drop trigger if exists set_employee_tools_updated_at on public.employee_tools;
create trigger set_employee_tools_updated_at
before update on public.employee_tools
for each row execute function public.set_updated_at();

drop trigger if exists set_rooms_updated_at on public.rooms;
create trigger set_rooms_updated_at
before update on public.rooms
for each row execute function public.set_updated_at();

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

drop trigger if exists set_memory_entries_updated_at on public.memory_entries;
create trigger set_memory_entries_updated_at
before update on public.memory_entries
for each row execute function public.set_updated_at();

drop trigger if exists set_approvals_updated_at on public.approvals;
create trigger set_approvals_updated_at
before update on public.approvals
for each row execute function public.set_updated_at();

drop trigger if exists set_calls_updated_at on public.calls;
create trigger set_calls_updated_at
before update on public.calls
for each row execute function public.set_updated_at();

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and coalesce(wm.status, 'active') = 'active'
  );
$$;

create or replace function public.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status is distinct from 'removed'
      and wm.role = 'admin'
  );
$$;

create or replace function public.shares_workspace_with(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() = target_user_id
    or exists (
      select 1
      from public.workspace_members viewer
      join public.workspace_members target
        on target.workspace_id = viewer.workspace_id
      where viewer.user_id = auth.uid()
        and target.user_id = target_user_id
        and coalesce(viewer.status, 'active') = 'active'
        and coalesce(target.status, 'active') = 'active'
    );
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.tools enable row level security;
alter table public.workspace_tools enable row level security;
alter table public.ai_employees enable row level security;
alter table public.employee_tools enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;
alter table public.tasks enable row level security;
alter table public.memory_entries enable row level security;
alter table public.approvals enable row level security;
alter table public.work_log_events enable row level security;
alter table public.calls enable row level security;
alter table public.call_transcripts enable row level security;
alter table public.model_provider_configs enable row level security;
alter table public.workspace_ai_settings enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_run_steps enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (public.shares_workspace_with(id));

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member"
on public.workspaces for select
using (
  public.is_workspace_member(id)
  or owner_id = auth.uid()
  or exists (
    select 1
    from public.workspace_invitations wi
    where wi.workspace_id = id
      and wi.status = 'pending'
      and lower(wi.invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

drop policy if exists "workspaces_insert_owner" on public.workspaces;
create policy "workspaces_insert_owner"
on public.workspaces for insert
with check (owner_id = auth.uid());

drop policy if exists "workspaces_update_member" on public.workspaces;
drop policy if exists "workspaces_update_admin" on public.workspaces;
create policy "workspaces_update_admin"
on public.workspaces for update
using (public.is_workspace_admin(id) or owner_id = auth.uid())
with check (public.is_workspace_admin(id) or owner_id = auth.uid());

drop policy if exists "workspace_members_select_member" on public.workspace_members;
create policy "workspace_members_select_member"
on public.workspace_members for select
using (public.is_workspace_member(workspace_id) or user_id = auth.uid());

drop policy if exists "workspace_members_insert_self" on public.workspace_members;
create policy "workspace_members_insert_self"
on public.workspace_members for insert
with check (
  user_id = auth.uid()
  and (
    exists (
      select 1
      from public.workspaces w
      where w.id = workspace_id
        and w.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.workspace_invitations wi
      where wi.workspace_id = workspace_id
        and wi.status = 'pending'
        and lower(wi.invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  )
);

drop policy if exists "workspace_members_update_member" on public.workspace_members;
drop policy if exists "workspace_members_update_admin" on public.workspace_members;
create policy "workspace_members_update_admin"
on public.workspace_members for update
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

drop policy if exists "workspace_members_delete_member" on public.workspace_members;
drop policy if exists "workspace_members_delete_admin" on public.workspace_members;
create policy "workspace_members_delete_admin"
on public.workspace_members for delete
using (public.is_workspace_admin(workspace_id));

drop policy if exists "workspace_invitations_select_relevant" on public.workspace_invitations;
create policy "workspace_invitations_select_relevant"
on public.workspace_invitations for select
using (
  public.is_workspace_member(workspace_id)
  or (
    status = 'pending'
    and lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

drop policy if exists "workspace_invitations_insert_admin" on public.workspace_invitations;
create policy "workspace_invitations_insert_admin"
on public.workspace_invitations for insert
with check (
  public.is_workspace_admin(workspace_id)
  and invited_by = auth.uid()
);

drop policy if exists "workspace_invitations_update_admin_or_invitee" on public.workspace_invitations;
create policy "workspace_invitations_update_admin_or_invitee"
on public.workspace_invitations for update
using (
  public.is_workspace_admin(workspace_id)
  or lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
)
with check (
  public.is_workspace_admin(workspace_id)
  or lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

drop policy if exists "tools_select_authenticated" on public.tools;
create policy "tools_select_authenticated"
on public.tools for select
to authenticated
using (true);

drop policy if exists "workspace_tools_all_member" on public.workspace_tools;
create policy "workspace_tools_all_member"
on public.workspace_tools for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "ai_employees_all_member" on public.ai_employees;
create policy "ai_employees_all_member"
on public.ai_employees for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "employee_tools_all_member" on public.employee_tools;
create policy "employee_tools_all_member"
on public.employee_tools for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "rooms_all_member" on public.rooms;
create policy "rooms_all_member"
on public.rooms for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "room_members_all_member" on public.room_members;
create policy "room_members_all_member"
on public.room_members for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "messages_all_member" on public.messages;
create policy "messages_all_member"
on public.messages for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "tasks_all_member" on public.tasks;
create policy "tasks_all_member"
on public.tasks for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "memory_entries_all_member" on public.memory_entries;
create policy "memory_entries_all_member"
on public.memory_entries for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "approvals_all_member" on public.approvals;
create policy "approvals_all_member"
on public.approvals for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "work_log_events_all_member" on public.work_log_events;
create policy "work_log_events_all_member"
on public.work_log_events for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "calls_all_member" on public.calls;
create policy "calls_all_member"
on public.calls for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "call_transcripts_all_member" on public.call_transcripts;
create policy "call_transcripts_all_member"
on public.call_transcripts for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "model_provider_configs_admin" on public.model_provider_configs;
create policy "model_provider_configs_admin"
on public.model_provider_configs for all
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

drop policy if exists "model_provider_configs_select_member" on public.model_provider_configs;
create policy "model_provider_configs_select_member"
on public.model_provider_configs for select
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_ai_settings_select_member" on public.workspace_ai_settings;
create policy "workspace_ai_settings_select_member"
on public.workspace_ai_settings for select
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_ai_settings_write_admin" on public.workspace_ai_settings;
create policy "workspace_ai_settings_write_admin"
on public.workspace_ai_settings for all
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

drop policy if exists "ai_usage_events_select_admin" on public.ai_usage_events;
create policy "ai_usage_events_select_admin"
on public.ai_usage_events for select
using (public.is_workspace_admin(workspace_id));

drop policy if exists "ai_usage_events_insert_member" on public.ai_usage_events;
drop policy if exists "ai_usage_events_update_member" on public.ai_usage_events;

drop policy if exists "agent_runs_select_member" on public.agent_runs;
create policy "agent_runs_select_member"
on public.agent_runs for select
using (public.is_workspace_member(workspace_id));

drop policy if exists "agent_runs_insert_member" on public.agent_runs;
drop policy if exists "agent_runs_update_member" on public.agent_runs;

drop policy if exists "agent_run_steps_select_member" on public.agent_run_steps;
create policy "agent_run_steps_select_member"
on public.agent_run_steps for select
using (public.is_workspace_member(workspace_id));

drop policy if exists "agent_run_steps_insert_member" on public.agent_run_steps;
drop policy if exists "agent_run_steps_update_member" on public.agent_run_steps;

create table if not exists public.security_rate_limit_events (
  id bigint generated by default as identity primary key,
  bucket text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_security_rate_limit_events_lookup
  on public.security_rate_limit_events (bucket, key_hash, created_at desc);

create index if not exists idx_security_rate_limit_events_created
  on public.security_rate_limit_events (created_at);

alter table public.security_rate_limit_events enable row level security;
revoke all on table public.security_rate_limit_events from anon, authenticated;
revoke all on sequence public.security_rate_limit_events_id_seq from anon, authenticated;

drop trigger if exists set_workspace_ai_settings_updated_at on public.workspace_ai_settings;
create trigger set_workspace_ai_settings_updated_at
before update on public.workspace_ai_settings
for each row execute function public.set_updated_at();

drop trigger if exists set_model_provider_configs_updated_at on public.model_provider_configs;
create trigger set_model_provider_configs_updated_at
before update on public.model_provider_configs
for each row execute function public.set_updated_at();

insert into public.tools (id, name, category, description, status)
values
  ('web-search', 'Web Search', 'Research', 'Search the live web for fresh information and sources.', 'mock'),
  ('browser', 'Browser', 'Research', 'Open and read web pages like a human researcher.', 'mock'),
  ('perplexity', 'Perplexity', 'Research', 'Answer engine for deep, cited research.', 'mock'),
  ('files', 'Files', 'Storage', 'Read and write project files and documents.', 'mock'),
  ('google-drive', 'Google Drive', 'Storage', 'Access shared docs, sheets, and folders.', 'not_connected'),
  ('github', 'GitHub', 'Coding', 'Read repos, open PRs, and manage issues.', 'mock'),
  ('cursor', 'Cursor', 'Coding', 'Pair-program inside the codebase.', 'mock'),
  ('vercel', 'Vercel', 'Coding', 'Deploy previews and inspect production.', 'mock'),
  ('supabase', 'Supabase', 'Coding', 'Query the database and manage schema.', 'mock'),
  ('figma', 'Figma', 'Design', 'Read design files and leave critique.', 'not_connected'),
  ('notion', 'Notion', 'Productivity', 'Read and write docs, specs, and wikis.', 'mock'),
  ('linear', 'Linear', 'Productivity', 'Create and track issues and cycles.', 'mock'),
  ('slack', 'Slack', 'Communication', 'Post updates and read channels.', 'not_connected'),
  ('discord', 'Discord', 'Communication', 'Engage your community server.', 'not_connected'),
  ('gmail', 'Gmail', 'Communication', 'Draft and send email with approval.', 'not_connected'),
  ('calendar', 'Calendar', 'Productivity', 'Schedule meetings and standups.', 'not_connected'),
  ('unity', 'Unity', 'Game development', 'Inspect Unity scenes and assets.', 'not_connected'),
  ('godot', 'Godot', 'Game development', 'Work with Godot scenes and scripts.', 'mock'),
  ('blender', 'Blender', 'Game development', 'Generate and tweak 3D assets.', 'not_connected'),
  ('stripe', 'Stripe', 'Business', 'Inspect payments and revenue with approval.', 'not_connected'),
  ('siliconflow', 'SiliconFlow', 'Model providers', 'DeepSeek, Qwen, Kimi, and more.', 'mock'),
  ('anthropic', 'Anthropic', 'Model providers', 'Claude models for reasoning and writing.', 'mock'),
  ('gemini', 'Gemini', 'Model providers', 'Google multimodal models.', 'mock')
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  status = excluded.status;
