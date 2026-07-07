-- Provider Credential Management V1
-- AdeHQ-owned credential registry + workspace allocations + audited events.
-- Secrets are encrypted server-side; this migration stores only encrypted refs,
-- last4, and non-reversible fingerprints.

create table if not exists public.platform_provider_credentials (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in (
    'siliconflow', 'vercel_gateway', 'tavily', 'browserbase',
    'revolut', 'stripe', 'vercel_control', 'internal'
  )),
  label text not null,
  scope text not null default 'global_pool' check (scope in (
    'global_pool', 'platform_singleton', 'dedicated_workspace',
    'enterprise', 'byok', 'test'
  )),
  secret_ref text not null,
  key_last4 text not null,
  key_fingerprint_sha256 text not null,
  encryption_key_version int not null default 1,
  status text not null default 'untested' check (status in (
    'untested', 'active', 'disabled', 'revoked', 'rotating', 'failed'
  )),
  replacement_credential_id uuid null references public.platform_provider_credentials(id) on delete set null,
  daily_limit_usd numeric(14,4) null,
  daily_limit_requests int null,
  monthly_limit_usd numeric(14,4) null,
  monthly_limit_requests int null,
  last_success_at timestamptz null,
  last_failure_at timestamptz null,
  last_tested_at timestamptz null,
  created_by uuid null,
  rotated_at timestamptz null,
  last_used_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_platform_provider_credentials_fingerprint_active
  on public.platform_provider_credentials (provider, key_fingerprint_sha256)
  where status != 'revoked';

create index if not exists idx_platform_provider_credentials_provider_status
  on public.platform_provider_credentials (provider, status);

drop trigger if exists set_platform_provider_credentials_updated_at on public.platform_provider_credentials;
create trigger set_platform_provider_credentials_updated_at
before update on public.platform_provider_credentials
for each row execute function public.set_updated_at();

create table if not exists public.workspace_provider_allocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('siliconflow', 'vercel_gateway', 'tavily', 'browserbase')),
  credential_id uuid null references public.platform_provider_credentials(id) on delete set null,
  allocation_type text not null default 'shared_pool' check (allocation_type in (
    'shared_pool', 'dedicated_key', 'provider_project', 'byok'
  )),
  provider_project_id text null,
  status text not null default 'active' check (status in ('active', 'paused', 'revoked', 'failed')),
  paused_reason text null,
  paused_by uuid null,
  paused_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create index if not exists idx_workspace_provider_allocations_workspace_provider
  on public.workspace_provider_allocations (workspace_id, provider);
create index if not exists idx_workspace_provider_allocations_credential
  on public.workspace_provider_allocations (credential_id)
  where credential_id is not null;

drop trigger if exists set_workspace_provider_allocations_updated_at on public.workspace_provider_allocations;
create trigger set_workspace_provider_allocations_updated_at
before update on public.workspace_provider_allocations
for each row execute function public.set_updated_at();

create table if not exists public.platform_provider_credential_events (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid null references public.platform_provider_credentials(id) on delete set null,
  workspace_id uuid null references public.workspaces(id) on delete cascade,
  provider text not null,
  event_type text not null check (event_type in (
    'created', 'assigned', 'used', 'rotated', 'revoked', 'disabled',
    'failed', 'fallback_used', 'tested', 'updated', 'budget_exceeded', 'health_skipped'
  )),
  reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_provider_credential_events_credential_created
  on public.platform_provider_credential_events (credential_id, created_at desc)
  where credential_id is not null;
create index if not exists idx_platform_provider_credential_events_workspace_provider
  on public.platform_provider_credential_events (workspace_id, provider, created_at desc)
  where workspace_id is not null;

alter table public.ai_cost_ledger_entries
  add column if not exists provider_credential_id uuid null references public.platform_provider_credentials(id) on delete set null,
  add column if not exists provider_allocation_id uuid null references public.workspace_provider_allocations(id) on delete set null,
  add column if not exists provider_project_id text null;

create index if not exists idx_ai_cost_ledger_provider_credential
  on public.ai_cost_ledger_entries (provider_credential_id, created_at desc)
  where provider_credential_id is not null;

alter table public.platform_provider_credentials enable row level security;
alter table public.workspace_provider_allocations enable row level security;
alter table public.platform_provider_credential_events enable row level security;

-- No RLS policies: platform/service-role only. Customer-facing APIs never expose
-- these tables directly.
