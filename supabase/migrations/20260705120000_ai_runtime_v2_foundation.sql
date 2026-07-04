-- V19.9.0b — AI Runtime V2 foundation (additive only)
-- Model catalog, work units, extended usage events, employee intelligence policy fields

-- ---------------------------------------------------------------------------
-- ai_model_catalog
-- ---------------------------------------------------------------------------
create table if not exists public.ai_model_catalog (
  id uuid primary key default gen_random_uuid(),
  provider_route text not null check (
    provider_route in ('siliconflow_direct', 'vercel_gateway', 'mock')
  ),
  provider_name text not null,
  model_id text not null,
  display_name text not null,
  capabilities jsonb not null default '[]'::jsonb,
  runtime_modes jsonb not null default '[]'::jsonb,
  context_window integer,
  input_cost_per_million numeric(12, 6),
  output_cost_per_million numeric(12, 6),
  cache_read_cost_per_million numeric(12, 6),
  cache_write_cost_per_million numeric(12, 6),
  currency text not null default 'USD',
  latency_p50_ms integer,
  latency_p95_ms integer,
  quality_score numeric(4, 2),
  reliability_score numeric(4, 2),
  enabled boolean not null default true,
  source text not null default 'manual_seed',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_route, model_id)
);

create index if not exists idx_ai_model_catalog_enabled
  on public.ai_model_catalog (enabled);

create index if not exists idx_ai_model_catalog_provider_route
  on public.ai_model_catalog (provider_route);

create index if not exists idx_ai_model_catalog_capabilities
  on public.ai_model_catalog using gin (capabilities);

-- Static seed (safe defaults — matches codebase conventions, not env-dependent)
insert into public.ai_model_catalog (
  provider_route,
  provider_name,
  model_id,
  display_name,
  capabilities,
  runtime_modes,
  context_window,
  input_cost_per_million,
  output_cost_per_million,
  source
)
values
  (
    'mock',
    'mock',
    'mock-efficient',
    'Mock Efficient',
    '["quick_reply","classification","memory_curation"]'::jsonb,
    '["efficient"]'::jsonb,
    8192,
    0,
    0,
    'manual_seed'
  ),
  (
    'mock',
    'mock',
    'mock-balanced',
    'Mock Balanced',
    '["structured_chat","summarization","artifact_generation"]'::jsonb,
    '["balanced"]'::jsonb,
    8192,
    0,
    0,
    'manual_seed'
  ),
  (
    'siliconflow_direct',
    'siliconflow',
    'deepseek-ai/DeepSeek-V3',
    'DeepSeek V3 (Efficient)',
    '["quick_reply","classification","memory_curation","summarization"]'::jsonb,
    '["efficient"]'::jsonb,
    128000,
    0.1,
    0.15,
    'manual_seed'
  ),
  (
    'siliconflow_direct',
    'siliconflow',
    'deepseek-ai/DeepSeek-V4-Flash',
    'DeepSeek V4 Flash (Balanced)',
    '["structured_chat","summarization","artifact_generation","reasoning"]'::jsonb,
    '["balanced"]'::jsonb,
    128000,
    0.3,
    0.6,
    'manual_seed'
  ),
  (
    'siliconflow_direct',
    'siliconflow',
    'deepseek-ai/DeepSeek-V4-Pro',
    'DeepSeek V4 Pro (Strong)',
    '["deep_reasoning","artifact_generation","research_planning"]'::jsonb,
    '["strong","research"]'::jsonb,
    128000,
    0.8,
    1.6,
    'manual_seed'
  ),
  (
    'siliconflow_direct',
    'siliconflow',
    'MiniMaxAI/MiniMax-M2.5',
    'MiniMax M2.5 (Long Context)',
    '["long_context","research_planning","browser_research"]'::jsonb,
    '["long_context","research"]'::jsonb,
    256000,
    0.4,
    0.8,
    'manual_seed'
  ),
  (
    'siliconflow_direct',
    'siliconflow',
    'Qwen/Qwen3-Coder-30B-A3B-Instruct',
    'Qwen3 Coder',
    '["coding","structured_chat"]'::jsonb,
    '["coding"]'::jsonb,
    128000,
    0.5,
    1.0,
    'manual_seed'
  ),
  (
    'siliconflow_direct',
    'siliconflow',
    'BAAI/bge-large-en-v1.5',
    'BGE Large EN v1.5',
    '["embedding"]'::jsonb,
    '["embedding"]'::jsonb,
    8192,
    0.02,
    0.02,
    'manual_seed'
  )
on conflict (provider_route, model_id) do nothing;

-- ---------------------------------------------------------------------------
-- ai_work_units
-- ---------------------------------------------------------------------------
create table if not exists public.ai_work_units (
  id text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  room_id text null,
  topic_id text null,
  dm_id text null,
  employee_id text null,
  user_id uuid null,
  work_type text not null,
  capability text not null,
  objective text,
  status text not null default 'created' check (
    status in ('created', 'planned', 'running', 'completed', 'failed', 'cancelled')
  ),
  priority text not null default 'normal',
  runtime_mode text,
  reasoning_profile text,
  provider_route text,
  provider_name text,
  model_id text,
  estimated_cost_usd numeric(12, 6),
  actual_cost_usd numeric(12, 6),
  estimated_work_minutes numeric(10, 2),
  actual_work_minutes numeric(10, 2),
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ai_work_units_workspace_created
  on public.ai_work_units (workspace_id, created_at desc);

create index if not exists idx_ai_work_units_employee_created
  on public.ai_work_units (employee_id, created_at desc)
  where employee_id is not null;

create index if not exists idx_ai_work_units_status
  on public.ai_work_units (status);

create index if not exists idx_ai_work_units_capability
  on public.ai_work_units (capability);

-- ---------------------------------------------------------------------------
-- Extend ai_usage_events (nullable runtime V2 columns)
-- ---------------------------------------------------------------------------
alter table public.ai_usage_events
  add column if not exists work_unit_id text null,
  add column if not exists capability text null,
  add column if not exists provider_route text null,
  add column if not exists provider_name text null,
  add column if not exists work_minutes_estimated numeric(10, 2) null,
  add column if not exists work_minutes_charged numeric(10, 2) null,
  add column if not exists cache_read_tokens integer null,
  add column if not exists cache_write_tokens integer null;

create index if not exists idx_ai_usage_events_work_unit_id
  on public.ai_usage_events (work_unit_id)
  where work_unit_id is not null;

create index if not exists idx_ai_usage_events_capability
  on public.ai_usage_events (capability)
  where capability is not null;

create index if not exists idx_ai_usage_events_provider_route
  on public.ai_usage_events (provider_route)
  where provider_route is not null;

-- ---------------------------------------------------------------------------
-- Extend ai_employees (intelligence policy — nullable)
-- ---------------------------------------------------------------------------
alter table public.ai_employees
  add column if not exists intelligence_policy jsonb null,
  add column if not exists routing_policy_id uuid null;

update public.ai_employees
set intelligence_policy = jsonb_build_object(
  'defaultMode',
  case model_mode
    when 'cheap' then 'efficient'
    when 'strong' then 'strong'
    when 'long_context' then 'long_context'
    when 'coding' then 'coding'
    else 'balanced'
  end,
  'allowedModes', jsonb_build_array('efficient', 'balanced', 'strong'),
  'workHourProfile', 'moderate',
  'browserAccess',
  case
    when role_key = 'research' then 'research_only'
    when lower(role) like '%research%' then 'research_only'
    when lower(role) like '%market research%' then 'research_only'
    when lower(role) like '%competitive intelligence%' then 'research_only'
    else 'none'
  end,
  'routingPreference', 'auto'
)
where intelligence_policy is null;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.ai_model_catalog enable row level security;
alter table public.ai_work_units enable row level security;

drop policy if exists "ai_model_catalog_select_authenticated" on public.ai_model_catalog;
create policy "ai_model_catalog_select_authenticated"
on public.ai_model_catalog for select
to authenticated
using (true);

drop policy if exists "ai_work_units_select_member" on public.ai_work_units;
create policy "ai_work_units_select_member"
on public.ai_work_units for select
using (public.is_workspace_member(workspace_id));

drop policy if exists "ai_work_units_insert_member" on public.ai_work_units;
create policy "ai_work_units_insert_member"
on public.ai_work_units for insert
with check (public.is_workspace_member(workspace_id));

drop policy if exists "ai_work_units_update_member" on public.ai_work_units;
create policy "ai_work_units_update_member"
on public.ai_work_units for update
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "ai_work_units_delete_member" on public.ai_work_units;
create policy "ai_work_units_delete_member"
on public.ai_work_units for delete
using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
drop trigger if exists set_ai_model_catalog_updated_at on public.ai_model_catalog;
create trigger set_ai_model_catalog_updated_at
before update on public.ai_model_catalog
for each row execute function public.set_updated_at();

drop trigger if exists set_ai_work_units_updated_at on public.ai_work_units;
create trigger set_ai_work_units_updated_at
before update on public.ai_work_units
for each row execute function public.set_updated_at();
