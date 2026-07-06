-- AdeHQ Control — Stage 2–4 tables

-- Incidents (Stage 2) --------------------------------------------------------
create table if not exists public.platform_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  incident_type text not null
    check (incident_type in (
      'provider_outage', 'cost_spike', 'browser_failure', 'database_issue',
      'signup_outage', 'billing_issue', 'security_event', 'other'
    )),
  status text not null default 'open'
    check (status in ('open', 'investigating', 'mitigated', 'resolved')),
  severity text not null default 'medium'
    check (severity in ('low', 'medium', 'high', 'critical')),
  affected_systems jsonb not null default '[]'::jsonb,
  public_message text,
  internal_notes text,
  owner_admin_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_platform_incidents_status
  on public.platform_incidents (status, started_at desc);

drop trigger if exists set_platform_incidents_updated_at on public.platform_incidents;
create trigger set_platform_incidents_updated_at
  before update on public.platform_incidents
  for each row execute function public.set_updated_at();

-- Job events (Stage 4) ---------------------------------------------------------
create table if not exists public.platform_job_events (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  job_key text,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  workspace_id uuid references public.workspaces(id) on delete set null,
  retry_count integer not null default 0,
  last_error text,
  duration_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_platform_job_events_type_status
  on public.platform_job_events (job_type, status, created_at desc);

-- Support access (Stage 4) -----------------------------------------------------
create table if not exists public.platform_admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_support_access_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.platform_admin_sessions(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_support_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);

-- Risk events (Stage 4) --------------------------------------------------------
create table if not exists public.platform_risk_events (
  id uuid primary key default gen_random_uuid(),
  risk_type text not null,
  severity text not null default 'medium'
    check (severity in ('low', 'medium', 'high', 'critical')),
  workspace_id uuid references public.workspaces(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_risk_events_created
  on public.platform_risk_events (created_at desc);

-- Experiments (Stage 4) --------------------------------------------------------
create table if not exists public.platform_experiments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  variants jsonb not null default '[]'::jsonb,
  target_scope text not null default 'global',
  target_scope_id text,
  status text not null default 'draft'
    check (status in ('draft', 'running', 'paused', 'completed')),
  metrics jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- AI prompt templates (Stage 4) ------------------------------------------------
create table if not exists public.ai_prompt_templates (
  id uuid primary key default gen_random_uuid(),
  role_key text not null unique,
  display_name text not null,
  is_active boolean not null default true,
  default_intelligence_mode text,
  browser_access_default boolean not null default false,
  tool_permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_prompt_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.ai_prompt_templates(id) on delete cascade,
  version integer not null,
  system_prompt text not null,
  policy_notes text,
  is_active boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

-- Runtime flags in platform_feature_flags --------------------------------------
insert into public.platform_feature_flags (key, value, flag_type, description)
select v.key, v.value, v.flag_type, v.description
from (values
  ('runtime_v2_mode', '"off"'::jsonb, 'string', 'Runtime V2 mode: off, shadow, on.'),
  ('route_optimizer_mode', '"off"'::jsonb, 'string', 'Route optimizer: off, shadow, on.'),
  ('employee_direct_execution', 'false'::jsonb, 'boolean', 'Direct employee Runtime V2 execution.'),
  ('employee_queued_execution', 'false'::jsonb, 'boolean', 'Queued employee Runtime V2 execution.')
) as v(key, value, flag_type, description)
where not exists (
  select 1 from public.platform_feature_flags f
  where f.key = v.key and f.scope = 'global' and coalesce(f.scope_id, '') = ''
);

-- RLS --------------------------------------------------------------------------
alter table public.platform_incidents enable row level security;
alter table public.platform_job_events enable row level security;
alter table public.platform_admin_sessions enable row level security;
alter table public.platform_support_access_logs enable row level security;
alter table public.platform_support_notes enable row level security;
alter table public.platform_risk_events enable row level security;
alter table public.platform_experiments enable row level security;
alter table public.ai_prompt_templates enable row level security;
alter table public.ai_prompt_template_versions enable row level security;
