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
  avatar_source text
    check (avatar_source is null or avatar_source in ('generated', 'upload')),
  avatar_updated_at timestamptz,
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
  access_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'active' check (status in ('active', 'removed')),
  access_version bigint not null default 1,
  display_title text,
  bio text,
  timezone text,
  availability_status text,
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
  access_preset text not null default 'full_member',
  access_package jsonb not null default '{}'::jsonb,
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
  employee_kind text not null default 'workspace_employee'
    check (employee_kind in ('workspace_employee', 'system_manager')),
  employee_access text not null default 'workspace'
    check (employee_access in ('workspace', 'department', 'restricted')),
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
  dm_owner_user_id uuid references auth.users(id) on delete cascade,
  dm_peer_user_id uuid references auth.users(id) on delete cascade,
  dm_pair_key text,
  room_visibility text
    check (room_visibility is null or room_visibility in ('workspace', 'restricted', 'private')),
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
    (
      kind = 'dm'
      and dm_owner_user_id is not null
      and (
        (dm_employee_id is not null and dm_peer_user_id is null and dm_pair_key is null)
        or (dm_employee_id is null and dm_peer_user_id is not null and dm_pair_key is not null)
      )
    )
    or (
      kind <> 'dm'
      and dm_employee_id is null
      and dm_owner_user_id is null
      and dm_peer_user_id is null
      and dm_pair_key is null
      and room_visibility is not null
    )
  )
);

create unique index if not exists rooms_ai_dm_unique
  on public.rooms (workspace_id, dm_owner_user_id, dm_employee_id)
  where kind = 'dm' and dm_employee_id is not null;

create unique index if not exists rooms_human_dm_unique
  on public.rooms (workspace_id, dm_pair_key)
  where kind = 'dm' and dm_pair_key is not null;

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
  conversation_type text not null default 'human_ai_dm'
    check (conversation_type in ('human_ai_dm','room','topic')),
  conversation_id text not null,
  initiator_user_id uuid references auth.users(id) on delete set null,
  primary_employee_id text,
  participant_ids jsonb not null default '[]'::jsonb,
  permission_version integer not null default 1,
  stt_mode text not null default 'fast_turn'
    check (stt_mode in ('fast_turn','live_streaming')),
  voice_route_policy text not null default 'standard',
  session_state text not null default 'ended'
    check (session_state in ('connecting','active','reconnecting','ending','ended','failed')),
  title text not null,
  status text not null,
  participants jsonb not null default '[]'::jsonb,
  transcript jsonb not null default '[]'::jsonb,
  action_items jsonb not null default '[]'::jsonb,
  estimated_wh numeric(14,6) not null default 0,
  settled_wh numeric(14,6) not null default 0,
  last_activity_at timestamptz not null default now(),
  reconnect_expires_at timestamptz,
  recording_consent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
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

create table if not exists public.call_turns (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  call_id text not null,
  sequence integer not null check (sequence >= 0),
  idempotency_key text not null,
  state text not null default 'listening'
    check (state in (
      'listening','transcribing','thinking','using_tools','synthesizing',
      'speaking','interrupted','completed','failed'
    )),
  human_transcript text not null default '',
  employee_transcript text not null default '',
  spoken_text text not null default '',
  unspoken_text text not null default '',
  interrupted boolean not null default false,
  interrupted_at_character integer,
  stt_route_id text,
  tts_route_id text,
  agent_run_id text,
  brain_run_id uuid,
  stt_wh numeric(14,6) not null default 0,
  brain_wh numeric(14,6) not null default 0,
  tts_wh numeric(14,6) not null default 0,
  estimated_wh numeric(14,6) not null default 0,
  reserved_wh numeric(14,6) not null default 0,
  settled_wh numeric(14,6) not null default 0,
  human_started_at timestamptz,
  human_ended_at timestamptz,
  first_transcript_at timestamptz,
  brain_started_at timestamptz,
  first_text_token_at timestamptz,
  first_audio_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, call_id, sequence),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, call_id)
    references public.calls(workspace_id, id) on delete cascade
);

create table if not exists public.call_usage_settlements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  call_id text not null,
  turn_id text not null,
  component text not null check (component in ('stt','brain','tts')),
  idempotency_key text not null,
  route_id text,
  estimated_wh numeric(14,6) not null default 0,
  reserved_wh numeric(14,6) not null default 0,
  actual_wh numeric(14,6) not null default 0,
  customer_charged_wh numeric(14,6) not null default 0,
  outcome text not null check (outcome in (
    'success','partial','failed_provider_billed','failed_unbilled','cancelled'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  settled_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, call_id)
    references public.calls(workspace_id, id) on delete cascade,
  foreign key (workspace_id, turn_id)
    references public.call_turns(workspace_id, id) on delete cascade
);

create index if not exists idx_calls_workspace_state_activity
  on public.calls(workspace_id, session_state, last_activity_at desc);
create index if not exists idx_calls_initiator_active
  on public.calls(workspace_id, initiator_user_id, session_state);
create index if not exists idx_call_turns_call_sequence
  on public.call_turns(workspace_id, call_id, sequence);
create index if not exists idx_call_usage_turn
  on public.call_usage_settlements(workspace_id, turn_id, component);

revoke insert, update, delete on public.calls from anon, authenticated;
revoke insert, update, delete on public.call_transcripts from anon, authenticated;
revoke insert, update, delete on public.call_turns from anon, authenticated;
revoke insert, update, delete on public.call_usage_settlements from anon, authenticated;

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
alter table public.call_turns enable row level security;
alter table public.call_usage_settlements enable row level security;
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

create or replace function public.bump_workspace_access_version(target_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.workspaces
  set access_version = access_version + 1
  where id = target_workspace_id;
end;
$$;

create or replace function public.bump_member_access_version(
  target_workspace_id uuid,
  target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.workspace_members
  set access_version = access_version + 1
  where workspace_id = target_workspace_id
    and user_id = target_user_id;
  perform public.bump_workspace_access_version(target_workspace_id);
end;
$$;

create or replace function public.can_access_room_row(
  p_workspace_id uuid,
  p_room_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rooms r
    where r.workspace_id = p_workspace_id
      and r.id = p_room_id
      and public.is_workspace_member(r.workspace_id)
      and (
        (
          r.kind = 'dm'
          and (
            r.dm_owner_user_id = auth.uid()
            or r.dm_peer_user_id = auth.uid()
          )
        )
        or (
          r.kind <> 'dm'
          and coalesce(r.room_visibility, 'workspace') = 'workspace'
        )
        or (
          r.kind <> 'dm'
          and coalesce(r.room_visibility, 'workspace') in ('restricted', 'private')
          and exists (
            select 1
            from public.room_members rm
            where rm.workspace_id = r.workspace_id
              and rm.room_id = r.id
              and rm.member_type = 'human'
              and rm.member_id = auth.uid()::text
          )
        )
      )
  );
$$;

grant execute on function public.can_access_room_row(uuid, text) to authenticated;
grant execute on function public.bump_workspace_access_version(uuid) to service_role;
grant execute on function public.bump_member_access_version(uuid, uuid) to service_role;

drop policy if exists "rooms_all_member" on public.rooms;
drop policy if exists "rooms_select_accessible" on public.rooms;
drop policy if exists "rooms_insert_member" on public.rooms;
drop policy if exists "rooms_update_accessible" on public.rooms;
drop policy if exists "rooms_delete_admin" on public.rooms;
create policy "rooms_select_accessible"
on public.rooms for select
using (public.can_access_room_row(workspace_id, id));
create policy "rooms_insert_member"
on public.rooms for insert
with check (public.is_workspace_member(workspace_id));
create policy "rooms_update_accessible"
on public.rooms for update
using (public.can_access_room_row(workspace_id, id))
with check (public.can_access_room_row(workspace_id, id));
create policy "rooms_delete_admin"
on public.rooms for delete
using (public.is_workspace_admin(workspace_id));

drop policy if exists "room_members_all_member" on public.room_members;
create policy "room_members_all_member"
on public.room_members for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "messages_all_member" on public.messages;
drop policy if exists "messages_select_accessible" on public.messages;
drop policy if exists "messages_insert_accessible" on public.messages;
drop policy if exists "messages_update_accessible" on public.messages;
drop policy if exists "messages_delete_accessible" on public.messages;
create policy "messages_select_accessible"
on public.messages for select
using (public.can_access_room_row(workspace_id, room_id));
create policy "messages_insert_accessible"
on public.messages for insert
with check (public.can_access_room_row(workspace_id, room_id));
create policy "messages_update_accessible"
on public.messages for update
using (public.can_access_room_row(workspace_id, room_id))
with check (public.can_access_room_row(workspace_id, room_id));
create policy "messages_delete_accessible"
on public.messages for delete
using (public.can_access_room_row(workspace_id, room_id));

drop policy if exists "tasks_all_member" on public.tasks;
drop policy if exists "tasks_select_accessible" on public.tasks;
drop policy if exists "tasks_insert_accessible" on public.tasks;
drop policy if exists "tasks_update_accessible" on public.tasks;
drop policy if exists "tasks_delete_accessible" on public.tasks;
create policy "tasks_select_accessible"
on public.tasks for select
using (public.can_access_room_row(workspace_id, room_id));
create policy "tasks_insert_accessible"
on public.tasks for insert
with check (public.can_access_room_row(workspace_id, room_id));
create policy "tasks_update_accessible"
on public.tasks for update
using (public.can_access_room_row(workspace_id, room_id))
with check (public.can_access_room_row(workspace_id, room_id));
create policy "tasks_delete_accessible"
on public.tasks for delete
using (public.can_access_room_row(workspace_id, room_id));

drop policy if exists "memory_entries_all_member" on public.memory_entries;
drop policy if exists "memory_entries_select_accessible" on public.memory_entries;
drop policy if exists "memory_entries_insert_accessible" on public.memory_entries;
drop policy if exists "memory_entries_update_accessible" on public.memory_entries;
drop policy if exists "memory_entries_delete_accessible" on public.memory_entries;
create policy "memory_entries_select_accessible"
on public.memory_entries for select
using (public.can_access_room_row(workspace_id, room_id));
create policy "memory_entries_insert_accessible"
on public.memory_entries for insert
with check (public.can_access_room_row(workspace_id, room_id));
create policy "memory_entries_update_accessible"
on public.memory_entries for update
using (public.can_access_room_row(workspace_id, room_id))
with check (public.can_access_room_row(workspace_id, room_id));
create policy "memory_entries_delete_accessible"
on public.memory_entries for delete
using (public.can_access_room_row(workspace_id, room_id));

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
drop policy if exists "calls_scoped_member" on public.calls;
drop policy if exists "calls_scoped_member_select" on public.calls;
create policy "calls_scoped_member_select"
on public.calls for select
using (public.can_access_room_row(workspace_id, room_id));

drop policy if exists "call_transcripts_all_member" on public.call_transcripts;
drop policy if exists "call_transcripts_scoped_member" on public.call_transcripts;
drop policy if exists "call_transcripts_scoped_member_select" on public.call_transcripts;
create policy "call_transcripts_scoped_member_select"
on public.call_transcripts for select
using (
  exists (
    select 1 from public.calls c
    where c.workspace_id = call_transcripts.workspace_id
      and c.id = call_transcripts.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  )
);

drop policy if exists "call_turns_scoped_member" on public.call_turns;
drop policy if exists "call_turns_scoped_member_select" on public.call_turns;
create policy "call_turns_scoped_member_select"
on public.call_turns for select
using (
  exists (
    select 1 from public.calls c
    where c.workspace_id = call_turns.workspace_id
      and c.id = call_turns.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  )
);

drop policy if exists "call_usage_scoped_member" on public.call_usage_settlements;
create policy "call_usage_scoped_member"
on public.call_usage_settlements for select
using (
  exists (
    select 1 from public.calls c
    where c.workspace_id = call_usage_settlements.workspace_id
      and c.id = call_usage_settlements.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  )
);

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

-- Hybrid workforce access tables (private DMs + grants)
create table if not exists public.ai_employee_user_grants (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_id text not null,
  access_effect text not null check (access_effect in ('allow', 'deny')),
  can_dm boolean not null default true,
  can_assign_work boolean not null default true,
  can_view_shared_outputs boolean not null default true,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (workspace_id, user_id, employee_id),
  foreign key (workspace_id, employee_id)
    references public.ai_employees(workspace_id, id)
    on delete cascade
);

create table if not exists public.topic_access_overrides (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  topic_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  access text not null default 'denied' check (access = 'denied'),
  created_at timestamptz not null default now(),
  primary key (workspace_id, topic_id, user_id)
);

create table if not exists public.room_user_state (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  room_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_message_id text,
  last_read_at timestamptz,
  muted boolean not null default false,
  archived boolean not null default false,
  pinned boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, room_id, user_id),
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id)
    on delete cascade
);

create table if not exists public.invite_ai_employee_grants (
  invite_id uuid not null references public.workspace_invitations(id) on delete cascade,
  employee_id text not null,
  access_effect text not null default 'allow' check (access_effect in ('allow', 'deny')),
  can_dm boolean not null default true,
  can_assign_work boolean not null default true,
  can_view_shared_outputs boolean not null default true,
  primary key (invite_id, employee_id)
);

create table if not exists public.invite_room_grants (
  invite_id uuid not null references public.workspace_invitations(id) on delete cascade,
  room_id text not null,
  primary key (invite_id, room_id)
);

create table if not exists public.invite_topic_grants (
  invite_id uuid not null references public.workspace_invitations(id) on delete cascade,
  topic_id text not null,
  access text not null default 'denied' check (access = 'denied'),
  primary key (invite_id, topic_id)
);

create table if not exists public.access_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.dm_ownership_migration_report (
  workspace_id uuid not null,
  room_id text not null,
  selected_owner uuid,
  selection_reason text not null,
  message_count integer not null default 0,
  fallback_used boolean not null default false,
  migrated_at timestamptz not null default now(),
  primary key (workspace_id, room_id)
);

alter table public.ai_employee_user_grants enable row level security;
alter table public.topic_access_overrides enable row level security;
alter table public.room_user_state enable row level security;
alter table public.invite_ai_employee_grants enable row level security;
alter table public.invite_room_grants enable row level security;
alter table public.invite_topic_grants enable row level security;
alter table public.access_audit_events enable row level security;
alter table public.dm_ownership_migration_report enable row level security;

-- AdeHQ Brain tables/columns: see migrations
--   20260716190000_brain_pricing_snapshots.sql
--   20260716190100_brain_pricing_snapshots_seed.sql
--   20260716191000_brain_ledger_extension.sql
--   20260716192000_brain_runs_decisions.sql
--   20260716193000_brain_employee_auto_intelligence.sql
--   20260716193500_messages_metadata_wh_receipt.sql
--   20260716194000_brain_drop_legacy_ledger_dedupe.sql
--   20260716195000_brain_catalog_v2_seed.sql
-- Living eng plan: docs/architecture/adehq-brain.md (CATALOG_VERSION=7)
-- Private DMs / hybrid access: 20260717120000_private_dms_hybrid_access.sql
--   20260717130000_access_scoped_memory_tasks.sql
-- Profile avatars: 20260717140000_profile_avatars.sql
-- Brain reliability (PR-17.5): 20260717150000_brain_reliability_foundation.sql
-- Steward execution (PR-19): 20260717160000_brain_steward_execution.sql
-- Voice (PR-18): 20260717170000_brain_voice_v1.sql
-- Plan terms + Revolut billing cleanup: 20260717192753_workspace_plan_terms_revolut_billing.sql
-- Human/hybrid calls (PR-18.2): 20260721160000_human_hybrid_calls.sql

-- Canonical call domain. The migration also installs scoped RLS, indexes,
-- legacy AI-call backfill, and the atomic accept_call_invitation function.
create table if not exists public.call_sessions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  room_id text not null,
  kind text not null check (kind in ('human_human','human_ai','group','hybrid')),
  status text not null default 'ringing'
    check (status in ('ringing','connecting','active','reconnecting','declined','missed','cancelled','ended','failed')),
  privacy_mode text not null default 'human_private'
    check (privacy_mode in ('human_private','ai_assisted','recorded_work_session')),
  title text not null default 'Call',
  created_by uuid references auth.users(id) on delete set null,
  idempotency_key text not null,
  audio_enabled boolean not null default true,
  video_enabled boolean not null default false,
  screen_share_enabled boolean not null default false,
  participant_limit integer not null default 2 check (participant_limit between 2 and 100),
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  last_activity_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, room_id) references public.rooms(workspace_id, id) on delete cascade
);

create table if not exists public.call_participants (
  workspace_id uuid not null,
  id text not null,
  call_id text not null,
  participant_type text not null check (participant_type in ('human','ai_employee')),
  user_id uuid references auth.users(id) on delete cascade,
  employee_id text,
  role text not null default 'participant' check (role in ('host','participant','observer')),
  participation_mode text check (participation_mode in ('silent_observer','on_request','advisor','facilitator','active')),
  state text not null default 'invited'
    check (state in ('invited','ringing','accepted','joining','joined','left','declined','missed','removed')),
  device_id text,
  joined_at timestamptz,
  left_at timestamptz,
  mute_state boolean not null default false,
  camera_state boolean not null default false,
  provider_session_id text,
  published_tracks jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, call_id) references public.call_sessions(workspace_id, id) on delete cascade,
  check (
    (participant_type = 'human' and user_id is not null and employee_id is null)
    or (participant_type = 'ai_employee' and employee_id is not null and user_id is null)
  )
);

create table if not exists public.call_invitations (
  workspace_id uuid not null,
  id text not null,
  call_id text not null,
  inviter_user_id uuid references auth.users(id) on delete set null,
  invitee_user_id uuid references auth.users(id) on delete cascade,
  invitee_employee_id text,
  status text not null default 'pending'
    check (status in ('pending','accepted','declined','missed','cancelled','answered_elsewhere','expired')),
  accepted_device_id text,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, call_id) references public.call_sessions(workspace_id, id) on delete cascade
);

create table if not exists public.call_participant_leases (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  call_id text not null,
  participant_id text not null,
  device_id text not null,
  heartbeat_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  foreign key (workspace_id, call_id) references public.call_sessions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, participant_id) references public.call_participants(workspace_id, id) on delete cascade
);

create table if not exists public.call_media_sessions (
  workspace_id uuid not null,
  id text not null,
  call_id text not null,
  participant_id text,
  topology text not null check (topology in ('p2p','sfu')),
  backend text not null check (backend in ('cloudflare_sfu','cloudflare_realtimekit','custom_webrtc','brain_voice')),
  relay_policy text not null default 'automatic' check (relay_policy in ('automatic','force_relay')),
  provider_session_id text,
  published_tracks jsonb not null default '[]'::jsonb,
  transition_reason text check (transition_reason in ('group_join','ai_join','recording','network_failure')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  primary key (workspace_id, id),
  foreign key (workspace_id, call_id) references public.call_sessions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, participant_id) references public.call_participants(workspace_id, id) on delete set null
);

create table if not exists public.call_events (
  workspace_id uuid not null,
  id text not null,
  call_id text not null,
  event_type text not null,
  actor_type text not null default 'system' check (actor_type in ('human','ai_employee','system')),
  actor_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, call_id) references public.call_sessions(workspace_id, id) on delete cascade
);

create table if not exists public.call_consents (
  workspace_id uuid not null,
  id text not null,
  call_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null check (consent_type in ('ai_listening','transcription','recording')),
  granted boolean not null,
  retention_policy text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (workspace_id, id),
  unique (workspace_id, call_id, user_id, consent_type),
  foreign key (workspace_id, call_id) references public.call_sessions(workspace_id, id) on delete cascade
);

create table if not exists public.call_artifacts (
  workspace_id uuid not null,
  id text not null,
  call_id text not null,
  room_id text not null,
  artifact_type text not null check (artifact_type in ('decision','task','question','risk','approval','artifact','memory','summary','note')),
  visibility text not null default 'shared' check (visibility in ('private','shared')),
  title text not null,
  content text not null default '',
  owner_id text,
  due_at timestamptz,
  source_employee_id text,
  graph_entity_type text,
  graph_entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, call_id) references public.call_sessions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, room_id) references public.rooms(workspace_id, id) on delete cascade
);

create table if not exists public.call_ai_turns (
  workspace_id uuid not null,
  id text not null,
  call_id text not null,
  employee_id text not null,
  mode text not null default 'on_request'
    check (mode in ('silent_observer','on_request','advisor','facilitator','active')),
  state text not null default 'queued'
    check (state in ('queued','listening','thinking','speaking','completed','interrupted','failed')),
  source_turn_id text,
  transcript text not null default '',
  response text not null default '',
  estimated_wh numeric(14,6) not null default 0,
  settled_wh numeric(14,6) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (workspace_id, id),
  foreign key (workspace_id, call_id) references public.call_sessions(workspace_id, id) on delete cascade
);

create table if not exists public.push_subscriptions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled boolean not null default true,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, endpoint)
);

alter table public.call_sessions enable row level security;
alter table public.call_participants enable row level security;
alter table public.call_invitations enable row level security;
alter table public.call_participant_leases enable row level security;
alter table public.call_media_sessions enable row level security;
alter table public.call_events enable row level security;
alter table public.call_consents enable row level security;
alter table public.call_artifacts enable row level security;
alter table public.call_ai_turns enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "call_sessions_scoped_select" on public.call_sessions for select
  using (public.can_access_room_row(workspace_id, room_id));
create policy "call_participants_scoped_select" on public.call_participants for select
  using (exists (
    select 1 from public.call_sessions c
    where c.workspace_id = call_participants.workspace_id
      and c.id = call_participants.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  ));
create policy "call_invitations_scoped_select" on public.call_invitations for select
  using (exists (
    select 1 from public.call_sessions c
    where c.workspace_id = call_invitations.workspace_id
      and c.id = call_invitations.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  ));
create policy "call_media_sessions_scoped_select" on public.call_media_sessions for select
  using (exists (
    select 1 from public.call_sessions c
    where c.workspace_id = call_media_sessions.workspace_id
      and c.id = call_media_sessions.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  ));
create policy "call_events_scoped_select" on public.call_events for select
  using (exists (
    select 1 from public.call_sessions c
    where c.workspace_id = call_events.workspace_id
      and c.id = call_events.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  ));
create policy "call_consents_scoped_select" on public.call_consents for select
  using (exists (
    select 1 from public.call_sessions c
    where c.workspace_id = call_consents.workspace_id
      and c.id = call_consents.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  ));
create policy "call_artifacts_scoped_select" on public.call_artifacts for select
  using (exists (
    select 1 from public.call_sessions c
    where c.workspace_id = call_artifacts.workspace_id
      and c.id = call_artifacts.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  ));
create policy "call_ai_turns_scoped_select" on public.call_ai_turns for select
  using (exists (
    select 1 from public.call_sessions c
    where c.workspace_id = call_ai_turns.workspace_id
      and c.id = call_ai_turns.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  ));
create policy "own_push_subscriptions_select" on public.push_subscriptions for select
  using (user_id = auth.uid());

revoke insert, update, delete on public.call_sessions from anon, authenticated;
revoke insert, update, delete on public.call_participants from anon, authenticated;
revoke insert, update, delete on public.call_invitations from anon, authenticated;
revoke all on public.call_participant_leases from anon, authenticated;
revoke insert, update, delete on public.call_media_sessions from anon, authenticated;
revoke insert, update, delete on public.call_events from anon, authenticated;
revoke insert, update, delete on public.call_consents from anon, authenticated;
revoke insert, update, delete on public.call_artifacts from anon, authenticated;
revoke insert, update, delete on public.call_ai_turns from anon, authenticated;
revoke insert, update, delete on public.push_subscriptions from anon, authenticated;

create or replace function public.accept_call_invitation(
  p_workspace_id uuid,
  p_invitation_id text,
  p_user_id uuid,
  p_device_id text,
  p_lease_seconds integer default 45
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.call_invitations%rowtype;
  v_part public.call_participants%rowtype;
begin
  select * into v_inv from public.call_invitations
  where workspace_id = p_workspace_id and id = p_invitation_id for update;
  if not found or v_inv.invitee_user_id is distinct from p_user_id then
    raise exception 'Invitation not found';
  end if;
  if v_inv.status <> 'pending' then
    return jsonb_build_object('won', false, 'status', v_inv.status, 'callId', v_inv.call_id);
  end if;
  if v_inv.expires_at <= now() then
    update public.call_invitations set status = 'expired', responded_at = now(), updated_at = now()
      where workspace_id = p_workspace_id and id = p_invitation_id;
    return jsonb_build_object('won', false, 'status', 'expired', 'callId', v_inv.call_id);
  end if;
  select * into v_part from public.call_participants
  where workspace_id = p_workspace_id and call_id = v_inv.call_id and user_id = p_user_id
  for update;
  delete from public.call_participant_leases
  where workspace_id = p_workspace_id and user_id = p_user_id and lease_expires_at <= now();
  if exists (
    select 1 from public.call_participant_leases
    where workspace_id = p_workspace_id and user_id = p_user_id and call_id <> v_inv.call_id
  ) then
    raise exception 'User is already active in another call';
  end if;
  update public.call_invitations
    set status = 'accepted', accepted_device_id = p_device_id,
        accepted_at = now(), responded_at = now(), updated_at = now()
    where workspace_id = p_workspace_id and id = p_invitation_id;
  update public.call_participants
    set state = 'accepted', device_id = p_device_id, updated_at = now()
    where workspace_id = p_workspace_id and id = v_part.id;
  insert into public.call_participant_leases (
    workspace_id, user_id, call_id, participant_id, device_id, heartbeat_at, lease_expires_at
  ) values (
    p_workspace_id, p_user_id, v_inv.call_id, v_part.id, p_device_id, now(),
    now() + make_interval(secs => greatest(15, least(p_lease_seconds, 120)))
  )
  on conflict (workspace_id, user_id) do update
    set call_id = excluded.call_id, participant_id = excluded.participant_id,
        device_id = excluded.device_id, heartbeat_at = excluded.heartbeat_at,
        lease_expires_at = excluded.lease_expires_at;
  update public.call_sessions
    set status = 'connecting', answered_at = coalesce(answered_at, now()),
        last_activity_at = now(), updated_at = now()
    where workspace_id = p_workspace_id and id = v_inv.call_id;
  return jsonb_build_object('won', true, 'status', 'accepted', 'callId', v_inv.call_id, 'participantId', v_part.id);
end;
$$;

revoke all on function public.accept_call_invitation(uuid,text,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.accept_call_invitation(uuid,text,uuid,text,integer) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'call-recordings',
  'call-recordings',
  false,
  262144000,
  array['audio/webm', 'video/webm', 'video/mp4', 'audio/mp4']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Maya Workforce Studio (PR-21A): schema/rule/simulation versioning, draft +
-- append-only revision history, draft locking, template governance,
-- provenance columns, and the Company Operating Profile.
--
-- Access model follows the rest of AdeHQ: service-role only from the server
-- (see AGENTS.md "Prefer service-role only on the server"). RLS below is a
-- defense-in-depth backstop scoped to workspace admins, matching
-- is_workspace_admin() used across hiring/admin tables.

-- ===========================================================================
-- Company Operating Profile — persistent, versioned company context that
-- grounds every Workforce Studio decision (Maya reads it, never guesses).
-- ===========================================================================
create table if not exists public.company_operating_profiles (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  revision integer not null default 1,
  payload jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_operating_profile_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  revision integer not null,
  payload jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, revision)
);

-- ===========================================================================
-- Workforce Blueprints — the durable, versioned artifact behind a designed
-- team. draft_payload is the live editable state; approved_payload is an
-- immutable snapshot frozen at approval time and used for provisioning.
-- ===========================================================================
create table if not exists public.workforce_blueprints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null default 'Untitled team',
  template_key text not null,
  template_version text not null default '1.0.0',
  blueprint_mode text not null default 'new_team'
    check (blueprint_mode in ('new_team')),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'provisioning', 'active', 'superseded', 'archived')),

  -- Engine versions captured at last edit — every revision is reproducible
  -- against the exact rule/simulation logic that produced it.
  schema_version integer not null default 1,
  template_engine_version text not null default '1.0.0',
  composition_rules_version text not null default '1.0.0',
  simulation_engine_version text not null default '1.0.0',

  revision integer not null default 1,
  draft_payload jsonb not null default '{}'::jsonb,

  approved_revision integer,
  approved_payload jsonb,
  approval_hash text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,

  -- Draft locking + optimistic concurrency (single active editor at a time).
  lock_token uuid,
  locked_by_user_id uuid references auth.users(id) on delete set null,
  lock_acquired_at timestamptz,
  lock_expires_at timestamptz,

  simulation_report jsonb,
  simulated_at timestamptz,

  superseded_by_blueprint_id uuid references public.workforce_blueprints(id) on delete set null,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workforce_blueprints_workspace
  on public.workforce_blueprints(workspace_id, status, updated_at desc);

-- Append-only revision history for audit + reproducibility. Never updated or
-- deleted once written.
create table if not exists public.workforce_blueprint_revisions (
  id uuid primary key default gen_random_uuid(),
  blueprint_id uuid not null references public.workforce_blueprints(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  revision integer not null,
  payload jsonb not null,
  change_summary text not null default '',
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (blueprint_id, revision)
);

create index if not exists idx_workforce_blueprint_revisions_blueprint
  on public.workforce_blueprint_revisions(blueprint_id, revision desc);

-- ===========================================================================
-- Template governance — published, versioned template manifests. Source of
-- truth for manifests is code (src/lib/hiring/workforce-studio/templates),
-- this table tracks publish state / rollout so we never silently change the
-- behavior of an already-approved blueprint.
-- ===========================================================================
create table if not exists public.workforce_studio_templates (
  template_key text not null,
  version text not null,
  name text not null,
  status text not null default 'published'
    check (status in ('draft', 'published', 'deprecated')),
  manifest_checksum text not null,
  published_at timestamptz not null default now(),
  deprecated_at timestamptz,
  primary key (template_key, version)
);

-- ===========================================================================
-- Team Hire Plans — one durable, idempotent provisioning saga per approved
-- blueprint revision. Steps are batched and individually checkpointed so
-- provisioning survives serverless function timeouts and retries safely.
-- ===========================================================================
create table if not exists public.team_hire_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  blueprint_id uuid not null references public.workforce_blueprints(id) on delete cascade,
  blueprint_revision integer not null,
  approval_hash text not null,
  idempotency_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'cancelled', 'compensating', 'compensated')),
  total_steps integer not null default 0,
  completed_steps integer not null default 0,
  error jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, idempotency_key)
);

create index if not exists idx_team_hire_plans_blueprint
  on public.team_hire_plans(blueprint_id, created_at desc);

create table if not exists public.team_hire_plan_steps (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.team_hire_plans(id) on delete cascade,
  step_index integer not null,
  step_type text not null
    check (step_type in (
      'create_room', 'create_employee', 'grant_tools', 'add_room_member',
      'create_collaboration_edge', 'create_outcome_task', 'create_artifact',
      'first_mission_task', 'first_mission_message'
    )),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'compensated', 'skipped')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  provenance jsonb not null default '{}'::jsonb,
  depends_on_step_indexes integer[] not null default '{}'::integer[],

  -- Exclusive ownership for the batched executor (atomic conditional claim).
  owner_token uuid,
  owner_acquired_at timestamptz,

  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, step_index)
);

create index if not exists idx_team_hire_plan_steps_plan_status
  on public.team_hire_plan_steps(plan_id, status, step_index);

-- ===========================================================================
-- Workforce Studio events — composer-specific analytics, additive to the
-- existing recordAiRuntime hooks (which cover AI usage, not composer UX).
-- ===========================================================================
create table if not exists public.workforce_studio_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  blueprint_id uuid references public.workforce_blueprints(id) on delete set null,
  plan_id uuid references public.team_hire_plans(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_workforce_studio_events_workspace
  on public.workforce_studio_events(workspace_id, created_at desc);

-- ===========================================================================
-- Provenance columns — link objects created by a hire plan back to the exact
-- blueprint revision + plan that produced them (for audit + compensation).
-- ===========================================================================
alter table public.ai_employees
  add column if not exists created_by_blueprint_id uuid references public.workforce_blueprints(id) on delete set null,
  add column if not exists created_by_blueprint_revision integer,
  add column if not exists created_by_plan_id uuid references public.team_hire_plans(id) on delete set null;

alter table public.rooms
  add column if not exists created_by_blueprint_id uuid references public.workforce_blueprints(id) on delete set null,
  add column if not exists created_by_blueprint_revision integer,
  add column if not exists created_by_plan_id uuid references public.team_hire_plans(id) on delete set null;

alter table public.employee_tools
  add column if not exists created_by_plan_id uuid references public.team_hire_plans(id) on delete set null;

alter table public.artifacts
  add column if not exists created_by_blueprint_id uuid references public.workforce_blueprints(id) on delete set null,
  add column if not exists created_by_blueprint_revision integer,
  add column if not exists created_by_plan_id uuid references public.team_hire_plans(id) on delete set null;

alter table public.tasks
  add column if not exists created_by_blueprint_id uuid references public.workforce_blueprints(id) on delete set null,
  add column if not exists created_by_blueprint_revision integer,
  add column if not exists created_by_plan_id uuid references public.team_hire_plans(id) on delete set null;

alter table public.work_graph_edges
  add column if not exists created_by_blueprint_id uuid references public.workforce_blueprints(id) on delete set null,
  add column if not exists created_by_plan_id uuid references public.team_hire_plans(id) on delete set null;

-- Extend artifact_type for Workforce Studio generated artifacts (additive —
-- existing values are unaffected).
alter table public.artifacts drop constraint if exists artifacts_artifact_type_check;
alter table public.artifacts
  add constraint artifacts_artifact_type_check
  check (artifact_type in (
    'prd', 'report', 'brief', 'research_summary', 'meeting_notes',
    'strategy_memo', 'email_draft', 'proposal', 'checklist', 'decision', 'note', 'other',
    'team_charter', 'role_scorecard', 'workforce_blueprint_summary'
  ));

-- ===========================================================================
-- Triggers
-- ===========================================================================
drop trigger if exists set_company_operating_profiles_updated_at on public.company_operating_profiles;
create trigger set_company_operating_profiles_updated_at
before update on public.company_operating_profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_workforce_blueprints_updated_at on public.workforce_blueprints;
create trigger set_workforce_blueprints_updated_at
before update on public.workforce_blueprints
for each row execute function public.set_updated_at();

drop trigger if exists set_team_hire_plans_updated_at on public.team_hire_plans;
create trigger set_team_hire_plans_updated_at
before update on public.team_hire_plans
for each row execute function public.set_updated_at();

drop trigger if exists set_team_hire_plan_steps_updated_at on public.team_hire_plan_steps;
create trigger set_team_hire_plan_steps_updated_at
before update on public.team_hire_plan_steps
for each row execute function public.set_updated_at();

-- ===========================================================================
-- RLS — admin-only, workspace-scoped. Server routes use the service-role
-- client (bypasses RLS) after requireHireAdmin(); this is a backstop.
-- ===========================================================================
alter table public.company_operating_profiles enable row level security;
alter table public.company_operating_profile_revisions enable row level security;
alter table public.workforce_blueprints enable row level security;
alter table public.workforce_blueprint_revisions enable row level security;
alter table public.workforce_studio_templates enable row level security;
alter table public.team_hire_plans enable row level security;
alter table public.team_hire_plan_steps enable row level security;
alter table public.workforce_studio_events enable row level security;

drop policy if exists "cop_admin_all" on public.company_operating_profiles;
create policy "cop_admin_all"
on public.company_operating_profiles for all
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

drop policy if exists "cop_revisions_admin_select" on public.company_operating_profile_revisions;
create policy "cop_revisions_admin_select"
on public.company_operating_profile_revisions for select
using (public.is_workspace_admin(workspace_id));

drop policy if exists "wf_blueprints_admin_all" on public.workforce_blueprints;
create policy "wf_blueprints_admin_all"
on public.workforce_blueprints for all
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

drop policy if exists "wf_blueprint_revisions_admin_select" on public.workforce_blueprint_revisions;
create policy "wf_blueprint_revisions_admin_select"
on public.workforce_blueprint_revisions for select
using (public.is_workspace_admin(workspace_id));

drop policy if exists "wf_templates_member_select" on public.workforce_studio_templates;
create policy "wf_templates_member_select"
on public.workforce_studio_templates for select
using (true);

drop policy if exists "team_hire_plans_admin_all" on public.team_hire_plans;
create policy "team_hire_plans_admin_all"
on public.team_hire_plans for all
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

drop policy if exists "team_hire_plan_steps_admin_select" on public.team_hire_plan_steps;
create policy "team_hire_plan_steps_admin_select"
on public.team_hire_plan_steps for select
using (
  exists (
    select 1 from public.team_hire_plans p
    where p.id = team_hire_plan_steps.plan_id
      and public.is_workspace_admin(p.workspace_id)
  )
);

drop policy if exists "workforce_studio_events_admin_all" on public.workforce_studio_events;
create policy "workforce_studio_events_admin_all"
on public.workforce_studio_events for all
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));
