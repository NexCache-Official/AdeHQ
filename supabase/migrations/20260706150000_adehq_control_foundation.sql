-- AdeHQ Control — platform admin foundation (Stage 1)
-- Platform-level admin plane: separate from workspace owner/admin roles.
-- All platform_* tables are service-role only: RLS enabled with no client policies.

-- 1. Platform admins ---------------------------------------------------------

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'super_admin'
    check (role in ('super_admin', 'ops_admin', 'support_admin', 'billing_admin', 'readonly_admin')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_platform_admins_email
  on public.platform_admins (lower(email));

-- 2. Admin audit log ---------------------------------------------------------

create table if not exists public.platform_admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  target_type text,
  target_id text,
  before jsonb,
  after jsonb,
  reason text,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_admin_audit_logs_created
  on public.platform_admin_audit_logs (created_at desc);
create index if not exists idx_platform_admin_audit_logs_admin
  on public.platform_admin_audit_logs (admin_user_id, created_at desc);
create index if not exists idx_platform_admin_audit_logs_action
  on public.platform_admin_audit_logs (action, created_at desc);

-- 3. Platform feature flags --------------------------------------------------

create table if not exists public.platform_feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  value jsonb not null default 'false'::jsonb,
  flag_type text not null default 'boolean'
    check (flag_type in ('boolean', 'string', 'number', 'json')),
  scope text not null default 'global'
    check (scope in ('global', 'plan', 'workspace', 'user')),
  scope_id text,
  rollout jsonb,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create unique index if not exists platform_feature_flags_key_scope_unique
  on public.platform_feature_flags (key, scope, coalesce(scope_id, ''));

insert into public.platform_feature_flags (key, value, flag_type, description)
values
  ('signups_enabled', 'true'::jsonb, 'boolean', 'Allow new account signups.'),
  ('invite_only_mode', 'false'::jsonb, 'boolean', 'Restrict signups to invited emails only.'),
  ('maintenance_mode', 'false'::jsonb, 'boolean', 'Platform-wide maintenance mode.'),
  ('maintenance_message', '""'::jsonb, 'string', 'Announcement banner shown during maintenance.'),
  ('ai_runs_enabled', 'true'::jsonb, 'boolean', 'Allow AI agent runs to execute.'),
  ('browser_research_enabled', 'true'::jsonb, 'boolean', 'Allow browser research runs.'),
  ('gateway_search_enabled', 'true'::jsonb, 'boolean', 'Allow gateway search calls.'),
  ('tavily_enabled', 'true'::jsonb, 'boolean', 'Allow Tavily search provider.'),
  ('file_uploads_enabled', 'true'::jsonb, 'boolean', 'Allow Drive file uploads.')
on conflict do nothing;

-- 4. Platform plan configs ---------------------------------------------------

create table if not exists public.platform_plan_configs (
  plan_slug text primary key,
  display_name text not null,
  monthly_price_cents integer not null default 0,
  annual_price_cents integer not null default 0,
  trial_days integer not null default 0,
  is_active boolean not null default true,
  weekly_work_hours numeric(8,2) not null default 0,
  max_ai_employees integer not null default 1,
  max_members integer not null default 1,
  max_workspaces integer not null default 1,
  max_rooms integer not null default 5,
  max_topics integer not null default 25,
  max_storage_bytes bigint not null default 1073741824,
  max_browser_runs_per_week integer not null default 0,
  max_file_upload_mb integer not null default 10,
  allowed_intelligence_tiers jsonb not null default '["cheap","balanced"]'::jsonb,
  browser_research_enabled boolean not null default false,
  gateway_search_enabled boolean not null default false,
  custom_ai_employees_enabled boolean not null default false,
  team_features_enabled boolean not null default false,
  admin_controls_enabled boolean not null default false,
  priority_support boolean not null default false,
  entitlements jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_platform_plan_configs_updated_at on public.platform_plan_configs;
create trigger set_platform_plan_configs_updated_at
  before update on public.platform_plan_configs
  for each row execute function public.set_updated_at();

insert into public.platform_plan_configs (
  plan_slug, display_name, monthly_price_cents, annual_price_cents, trial_days,
  weekly_work_hours, max_ai_employees, max_members, max_workspaces,
  max_rooms, max_topics, max_storage_bytes, max_browser_runs_per_week, max_file_upload_mb,
  allowed_intelligence_tiers, browser_research_enabled, gateway_search_enabled,
  custom_ai_employees_enabled, team_features_enabled, admin_controls_enabled, priority_support
) values
  ('free', 'Free', 0, 0, 0,
    2, 1, 1, 1,
    3, 15, 1073741824, 2, 10,
    '["cheap","balanced"]'::jsonb, false, false,
    false, false, false, false),
  ('pro', 'Pro', 2900, 29000, 7,
    10, 3, 1, 2,
    10, 50, 10737418240, 15, 25,
    '["cheap","balanced","strong","coding"]'::jsonb, true, true,
    false, false, false, false),
  ('team', 'Team', 9900, 99000, 14,
    40, 10, 10, 3,
    25, 150, 53687091200, 60, 50,
    '["cheap","balanced","strong","long_context","coding"]'::jsonb, true, true,
    true, true, true, false),
  ('business', 'Business', 29900, 299000, 14,
    150, 30, 30, 10,
    100, 500, 214748364800, 250, 100,
    '["cheap","balanced","strong","long_context","coding","creative"]'::jsonb, true, true,
    true, true, true, true),
  ('enterprise', 'Enterprise', 0, 0, 30,
    0, 0, 0, 0,
    0, 0, 0, 0, 0,
    '["cheap","balanced","strong","long_context","coding","creative"]'::jsonb, true, true,
    true, true, true, true)
on conflict (plan_slug) do nothing;

-- 5. Maintenance events ------------------------------------------------------

create table if not exists public.platform_maintenance_events (
  id uuid primary key default gen_random_uuid(),
  mode text not null
    check (mode in (
      'maintenance', 'signups_disabled', 'ai_disabled',
      'browser_disabled', 'uploads_disabled', 'announcement'
    )),
  enabled boolean not null default true,
  message text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_platform_maintenance_events_started
  on public.platform_maintenance_events (started_at desc);

-- 6. Workspace status for platform-level disable (Stage 2 action) ------------

alter table public.workspaces
  add column if not exists status text not null default 'active'
    check (status in ('active', 'disabled', 'test'));

-- 7. RLS: service-role only for all platform tables ---------------------------
-- RLS enabled with no policies = anon/authenticated clients get nothing.
-- Admin APIs use the service role, which bypasses RLS.

alter table public.platform_admins enable row level security;
alter table public.platform_admin_audit_logs enable row level security;
alter table public.platform_feature_flags enable row level security;
alter table public.platform_plan_configs enable row level security;
alter table public.platform_maintenance_events enable row level security;

comment on table public.platform_admins is
  'AdeHQ Control: platform-level admins. Separate from workspace roles. Service-role access only.';
comment on table public.platform_admin_audit_logs is
  'AdeHQ Control: audit trail for every platform admin mutation and restricted view.';
comment on table public.platform_feature_flags is
  'AdeHQ Control: platform feature flags (DB overrides env). Service-role access only.';
comment on table public.platform_plan_configs is
  'AdeHQ Control: subscription plan configs and entitlements.';
comment on table public.platform_maintenance_events is
  'AdeHQ Control: maintenance windows and platform announcements.';
