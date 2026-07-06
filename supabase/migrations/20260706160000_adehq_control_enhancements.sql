-- AdeHQ Control — audit severity, daily rollups, workspace admin metadata

-- 1. Audit log severity ------------------------------------------------------

alter table public.platform_admin_audit_logs
  add column if not exists severity text not null default 'info'
    check (severity in ('info', 'low', 'medium', 'high', 'critical')),
  add column if not exists requires_reason boolean not null default false,
  add column if not exists request_id text,
  add column if not exists session_id uuid;

-- 2. Daily metric rollups (structure for future cron; not populated in v1) --

create table if not exists public.platform_metric_daily_rollups (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  metric_key text not null,
  scope_type text not null default 'global'
    check (scope_type in ('global', 'plan', 'workspace', 'provider', 'model', 'user')),
  scope_id text,
  value numeric(20, 6) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists platform_metric_daily_rollups_unique
  on public.platform_metric_daily_rollups (date, metric_key, scope_type, coalesce(scope_id, ''));

create index if not exists idx_platform_metric_daily_rollups_date
  on public.platform_metric_daily_rollups (date desc, metric_key);

alter table public.platform_metric_daily_rollups enable row level security;

-- 3. Workspace admin metadata for filtering internal/test/demo ---------------

alter table public.workspaces
  add column if not exists is_internal boolean not null default false,
  add column if not exists is_test boolean not null default false;

comment on column public.workspaces.is_internal is
  'AdeHQ operator/internal workspace — excluded from customer metrics by default.';
comment on column public.workspaces.is_test is
  'Test workspace — excluded from customer metrics by default.';
