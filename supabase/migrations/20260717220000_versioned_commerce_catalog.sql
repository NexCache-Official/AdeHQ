-- PR-20B–D foundation: versioned billing catalog, dual-clock usage, ledger,
-- reservations, promotions, top-ups, provider sync outbox, commerce RBAC.

-- ---------------------------------------------------------------------------
-- Stable plan identity
-- ---------------------------------------------------------------------------
create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('free', 'pro', 'team', 'business', 'enterprise')),
  internal_name text not null,
  status text not null default 'active' check (status in ('active', 'retired')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Immutable plan versions
-- ---------------------------------------------------------------------------
create table if not exists public.billing_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.billing_plans(id) on delete restrict,
  version integer not null,
  public_name text not null,
  eyebrow text not null default '',
  description text not null default '',
  feature_bullets jsonb not null default '[]'::jsonb,
  weekly_included_wh numeric(12, 4) not null,
  usage_period_hours integer not null default 168 check (usage_period_hours = 168),
  entitlements jsonb not null default '{}'::jsonb,
  visibility text not null default 'public'
    check (visibility in ('public', 'invite_only', 'workspace_specific', 'enterprise_contract')),
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'published', 'retired',
                      'validation_passed', 'provider_sync_pending', 'provider_synced',
                      'provider_sync_failed', 'publication_failed', 'verification_failed')),
  available_from timestamptz,
  available_until timestamptz,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  migration_policy text
    check (migration_policy is null or migration_policy in (
      'new_customers_only', 'migrate_at_renewal', 'immediate_benefits_only', 'scheduled_migration'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, version)
);

create index if not exists billing_plan_versions_plan_status_idx
  on public.billing_plan_versions (plan_id, status);

-- ---------------------------------------------------------------------------
-- Prices + provider mapping
-- ---------------------------------------------------------------------------
create table if not exists public.billing_prices (
  id uuid primary key default gen_random_uuid(),
  plan_version_id uuid not null references public.billing_plan_versions(id) on delete restrict,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  cadence text not null check (cadence in ('monthly', 'annual')),
  amount_minor integer not null check (amount_minor >= 0),
  provider_ref text,
  revolut_plan_id text,
  revolut_variation_id text,
  sync_status text not null default 'draft'
    check (sync_status in (
      'draft', 'validation_passed', 'provider_sync_pending', 'provider_synced',
      'scheduled', 'published', 'retired',
      'provider_sync_failed', 'publication_failed', 'verification_failed'
    )),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_version_id, currency, cadence)
);

create index if not exists billing_prices_selectable_idx
  on public.billing_prices (status, sync_status)
  where status = 'active' and sync_status = 'published';

-- ---------------------------------------------------------------------------
-- Checkout snapshots (accepted terms)
-- ---------------------------------------------------------------------------
create table if not exists public.billing_checkout_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_version_id uuid not null references public.billing_plan_versions(id) on delete restrict,
  price_id uuid not null references public.billing_prices(id) on delete restrict,
  promotion_id uuid,
  terms_template text not null default 'b2b_workspace'
    check (terms_template in ('b2b_workspace', 'consumer_individual', 'enterprise_negotiated')),
  snapshot jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Provider sync outbox
-- ---------------------------------------------------------------------------
create table if not exists public.billing_provider_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  price_id uuid not null references public.billing_prices(id) on delete cascade,
  provider_ref text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed')),
  attempts integer not null default 0,
  last_error text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_provider_sync_jobs_status_idx
  on public.billing_provider_sync_jobs (status, created_at);

-- ---------------------------------------------------------------------------
-- Workspace usage clock
-- ---------------------------------------------------------------------------
alter table public.workspaces
  add column if not exists usage_anchor_at timestamptz,
  add column if not exists usage_clock_kind text
    check (usage_clock_kind is null or usage_clock_kind in ('free', 'paid')),
  add column if not exists plan_version_id uuid references public.billing_plan_versions(id) on delete set null,
  add column if not exists free_wh_eligible boolean not null default true;

update public.workspaces
set
  usage_anchor_at = date_trunc('hour', coalesce(free_plan_started_at, created_at, now())),
  usage_clock_kind = case
    when lower(coalesce(plan_slug, plan, 'free')) in ('free', 'founder', '') then 'free'
    else 'paid'
  end
where usage_anchor_at is null;

-- ---------------------------------------------------------------------------
-- Extend billing_subscriptions for provider/service access split
-- ---------------------------------------------------------------------------
alter table public.billing_subscriptions
  add column if not exists plan_version_id uuid references public.billing_plan_versions(id) on delete set null,
  add column if not exists price_id uuid references public.billing_prices(id) on delete set null,
  add column if not exists checkout_snapshot_id uuid references public.billing_checkout_snapshots(id) on delete set null,
  add column if not exists billing_cadence text check (billing_cadence is null or billing_cadence in ('monthly', 'annual')),
  add column if not exists currency text,
  add column if not exists provider text not null default 'revolut',
  add column if not exists provider_status text
    check (provider_status is null or provider_status in (
      'pending', 'active', 'overdue', 'paused', 'cancelled', 'finished'
    )),
  add column if not exists service_access_status text not null default 'free'
    check (service_access_status in (
      'active', 'grace', 'scheduled_to_end', 'read_only', 'free'
    )),
  add column if not exists service_access_ends_at timestamptz,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists grace_ends_at timestamptz,
  add column if not exists pending_commercial_plan_version_id uuid references public.billing_plan_versions(id) on delete set null,
  add column if not exists commercial_change_effective_at timestamptz,
  add column if not exists pending_usage_plan_version_id uuid references public.billing_plan_versions(id) on delete set null,
  add column if not exists usage_change_effective_period_start timestamptz,
  add column if not exists pending_price_id uuid references public.billing_prices(id) on delete set null,
  add column if not exists legacy_manual_renew boolean not null default false,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Mark existing subs without Revolut subscription id as legacy
update public.billing_subscriptions
set legacy_manual_renew = true
where coalesce(external_subscription_id, '') = ''
  and legacy_manual_renew = false;

update public.billing_subscriptions
set
  provider_status = case
    when status in ('active', 'trialing', 'manual', 'comped', 'enterprise') then 'active'
    when status = 'past_due' then 'overdue'
    when status in ('cancelled', 'expired') then 'cancelled'
    else coalesce(provider_status, 'pending')
  end,
  service_access_status = case
    when status in ('active', 'trialing', 'manual', 'comped', 'enterprise') then 'active'
    when status = 'past_due' then 'grace'
    when cancel_at_period_end = true and current_period_end is not null and current_period_end > now()
      then 'scheduled_to_end'
    else 'free'
  end,
  service_access_ends_at = case
    when cancel_at_period_end = true then current_period_end
    else service_access_ends_at
  end
where provider_status is null
   or service_access_status = 'free' and status in ('active', 'trialing', 'manual', 'comped', 'enterprise');

-- ---------------------------------------------------------------------------
-- Usage periods: add commerce columns (keep existing table)
-- ---------------------------------------------------------------------------
alter table public.workspace_usage_periods
  add column if not exists plan_version_id uuid references public.billing_plan_versions(id) on delete set null,
  add column if not exists period_key text,
  add column if not exists base_wh_granted numeric(12, 4) not null default 0,
  add column if not exists promotional_wh_granted numeric(12, 4) not null default 0,
  add column if not exists base_wh_used numeric(12, 4) not null default 0,
  add column if not exists promotional_wh_used numeric(12, 4) not null default 0,
  add column if not exists entitlement_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists period_status text not null default 'active'
    check (period_status in ('active', 'closed', 'expired'));

create unique index if not exists workspace_usage_periods_period_key_uidx
  on public.workspace_usage_periods (workspace_id, period_key)
  where period_key is not null;

-- ---------------------------------------------------------------------------
-- Credit lots + ledger + reservations
-- ---------------------------------------------------------------------------
create table if not exists public.wh_credit_lots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lot_type text not null check (lot_type in (
    'purchased', 'one_time_promo', 'weekly_promo', 'goodwill', 'past_due_grace'
  )),
  amount_wh numeric(12, 4) not null check (amount_wh > 0),
  remaining_wh numeric(12, 4) not null check (remaining_wh >= 0),
  expires_at timestamptz,
  promotion_id uuid,
  topup_product_id uuid,
  purchase_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wh_credit_lots_workspace_expiry_idx
  on public.wh_credit_lots (workspace_id, expires_at nulls last);

create table if not exists public.wh_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entry_type text not null check (entry_type in (
    'weekly_base_grant', 'weekly_promo_grant', 'purchased_grant', 'goodwill_grant',
    'upgrade_allowance_adjustment', 'usage_debit', 'reservation_hold', 'reservation_release',
    'expiration', 'refund_compensation', 'manual_adjustment', 'past_due_grace_grant'
  )),
  amount_wh numeric(12, 4) not null,
  balance_after numeric(12, 4),
  usage_period_id uuid references public.workspace_usage_periods(id) on delete set null,
  brain_run_id text,
  promotion_id uuid,
  purchase_id text,
  lot_id uuid references public.wh_credit_lots(id) on delete set null,
  reservation_id uuid,
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (idempotency_key)
);

create index if not exists wh_ledger_entries_workspace_created_idx
  on public.wh_ledger_entries (workspace_id, created_at desc);

create table if not exists public.wh_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  brain_run_id text not null,
  estimated_wh numeric(12, 4) not null check (estimated_wh >= 0),
  reserved_wh numeric(12, 4) not null check (reserved_wh >= 0),
  settled_wh numeric(12, 4),
  status text not null default 'reserved'
    check (status in ('reserved', 'partially_settled', 'settled', 'released', 'expired')),
  idempotency_key text not null unique,
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wh_reservations_workspace_active_idx
  on public.wh_reservations (workspace_id, status)
  where status in ('reserved', 'partially_settled');

-- ---------------------------------------------------------------------------
-- Top-up products
-- ---------------------------------------------------------------------------
create table if not exists public.wh_topup_products (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version integer not null,
  wh_amount numeric(12, 4) not null check (wh_amount > 0),
  price_minor integer not null check (price_minor > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  eligible_plan_codes text[] not null default array['pro', 'team', 'business']::text[],
  expires_after_days integer not null default 365,
  maximum_purchases_per_day integer,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  revolut_order_product_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code, version)
);

-- ---------------------------------------------------------------------------
-- Promotions
-- ---------------------------------------------------------------------------
create table if not exists public.billing_promotions (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  activation text not null check (activation in ('code', 'automatic', 'referral', 'admin_grant')),
  enforcement text not null default 'adehq_ledger'
    check (enforcement in ('adehq_ledger', 'revolut_price', 'revolut_phase', 'hybrid')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  eligible_plan_codes text[] not null default '{}'::text[],
  eligible_cadences text[] ,
  eligible_currencies text[],
  new_customers_only boolean not null default false,
  first_paid_subscription_only boolean not null default false,
  max_redemptions integer,
  max_per_customer integer not null default 1,
  stackable boolean not null default false,
  rewards jsonb not null default '[]'::jsonb,
  customer_terms text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'active', 'paused', 'ended', 'exhausted')),
  revolut_price_id uuid references public.billing_prices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.billing_promotions(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  billing_customer_id uuid references public.billing_customers(id) on delete set null,
  subscription_id uuid references public.billing_subscriptions(id) on delete set null,
  terms_snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

-- Allow checkout snapshots to reference promotions
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'billing_checkout_snapshots_promotion_id_fkey'
  ) then
    alter table public.billing_checkout_snapshots
      add constraint billing_checkout_snapshots_promotion_id_fkey
      foreign key (promotion_id) references public.billing_promotions(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Commerce RBAC
-- ---------------------------------------------------------------------------
create table if not exists public.platform_admin_commerce_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  roles text[] not null default array['platform_owner']::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  reason text,
  ticket_ref text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists commerce_audit_events_created_idx
  on public.commerce_audit_events (created_at desc);

-- ---------------------------------------------------------------------------
-- Seed plans + v1 versions + USD prices + entitlements + top-ups
-- ---------------------------------------------------------------------------
insert into public.billing_plans (code, internal_name, status, sort_order)
values
  ('free', 'Free', 'active', 10),
  ('pro', 'Pro', 'active', 20),
  ('team', 'Team', 'active', 30),
  ('business', 'Business', 'active', 40),
  ('enterprise', 'Enterprise', 'active', 50)
on conflict (code) do update set
  internal_name = excluded.internal_name,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Free v1
insert into public.billing_plan_versions (
  plan_id, version, public_name, eyebrow, description, weekly_included_wh, entitlements,
  visibility, status, published_at, available_from
)
select p.id, 1, 'Free', 'Try AdeHQ', 'For individuals exploring AdeHQ.', 10,
  '{
    "weeklyWh": 10,
    "searchEnabled": true,
    "browserEnabled": true,
    "voiceEnabled": true,
    "imageEnabled": true,
    "videoEnabled": false,
    "videoRequiresApproval": false,
    "maxConcurrentRuns": 1,
    "maxStewardCollaborators": 0,
    "maxStewardSteps": 0,
    "maxAutomaticRunWh": 5,
    "sharedMemoryEnabled": true,
    "memoryRetentionDays": 14,
    "artifactStorageBytes": 1073741824,
    "usageDashboardLevel": "basic",
    "adminControlsLevel": "basic",
    "supportLevel": "standard",
    "intelligencePolicy": "standard",
    "humanMembersUnlimited": true,
    "aiEmployeesUnlimited": true
  }'::jsonb,
  'public', 'published', now(), now()
from public.billing_plans p where p.code = 'free'
on conflict (plan_id, version) do nothing;

-- Pro v1
insert into public.billing_plan_versions (
  plan_id, version, public_name, eyebrow, description, weekly_included_wh, entitlements,
  visibility, status, published_at, available_from
)
select p.id, 1, 'Pro', 'Founders and operators', 'For solo operators shipping with AI employees.', 125,
  '{
    "weeklyWh": 125,
    "searchEnabled": true,
    "browserEnabled": true,
    "voiceEnabled": true,
    "imageEnabled": true,
    "videoEnabled": true,
    "videoRequiresApproval": true,
    "maxConcurrentRuns": 3,
    "maxStewardCollaborators": 2,
    "maxStewardSteps": 12,
    "maxAutomaticRunWh": 40,
    "sharedMemoryEnabled": true,
    "memoryRetentionDays": 90,
    "artifactStorageBytes": 26843545600,
    "usageDashboardLevel": "team",
    "adminControlsLevel": "basic",
    "supportLevel": "standard",
    "intelligencePolicy": "balanced",
    "humanMembersUnlimited": true,
    "aiEmployeesUnlimited": true
  }'::jsonb,
  'public', 'published', now(), now()
from public.billing_plans p where p.code = 'pro'
on conflict (plan_id, version) do nothing;

-- Team v1
insert into public.billing_plan_versions (
  plan_id, version, public_name, eyebrow, description, weekly_included_wh, entitlements,
  visibility, status, published_at, available_from
)
select p.id, 1, 'Team', 'Small teams', 'Shared workspace capacity for growing teams.', 250,
  '{
    "weeklyWh": 250,
    "searchEnabled": true,
    "browserEnabled": true,
    "voiceEnabled": true,
    "imageEnabled": true,
    "videoEnabled": true,
    "videoRequiresApproval": true,
    "maxConcurrentRuns": 5,
    "maxStewardCollaborators": 4,
    "maxStewardSteps": 20,
    "maxAutomaticRunWh": 80,
    "sharedMemoryEnabled": true,
    "memoryRetentionDays": 180,
    "artifactStorageBytes": 107374182400,
    "usageDashboardLevel": "team",
    "adminControlsLevel": "standard",
    "supportLevel": "priority",
    "intelligencePolicy": "advanced",
    "humanMembersUnlimited": true,
    "aiEmployeesUnlimited": true
  }'::jsonb,
  'public', 'published', now(), now()
from public.billing_plans p where p.code = 'team'
on conflict (plan_id, version) do nothing;

-- Business v1
insert into public.billing_plan_versions (
  plan_id, version, public_name, eyebrow, description, weekly_included_wh, entitlements,
  visibility, status, published_at, available_from
)
select p.id, 1, 'Business', 'Growing companies', 'Higher capacity and advanced controls.', 650,
  '{
    "weeklyWh": 650,
    "searchEnabled": true,
    "browserEnabled": true,
    "voiceEnabled": true,
    "imageEnabled": true,
    "videoEnabled": true,
    "videoRequiresApproval": false,
    "maxConcurrentRuns": 10,
    "maxStewardCollaborators": 8,
    "maxStewardSteps": 40,
    "maxAutomaticRunWh": 200,
    "sharedMemoryEnabled": true,
    "memoryRetentionDays": 365,
    "artifactStorageBytes": 536870912000,
    "usageDashboardLevel": "advanced",
    "adminControlsLevel": "advanced",
    "supportLevel": "priority",
    "intelligencePolicy": "advanced",
    "humanMembersUnlimited": true,
    "aiEmployeesUnlimited": true
  }'::jsonb,
  'public', 'published', now(), now()
from public.billing_plans p where p.code = 'business'
on conflict (plan_id, version) do nothing;

-- Enterprise v1 (custom / not self-serve priced)
insert into public.billing_plan_versions (
  plan_id, version, public_name, eyebrow, description, weekly_included_wh, entitlements,
  visibility, status, published_at, available_from
)
select p.id, 1, 'Enterprise', 'Larger organisations', 'Contracted capacity and terms.', 0,
  '{
    "weeklyWh": 0,
    "searchEnabled": true,
    "browserEnabled": true,
    "voiceEnabled": true,
    "imageEnabled": true,
    "videoEnabled": true,
    "videoRequiresApproval": false,
    "maxConcurrentRuns": 25,
    "maxStewardCollaborators": 16,
    "maxStewardSteps": 80,
    "maxAutomaticRunWh": 1000,
    "sharedMemoryEnabled": true,
    "memoryRetentionDays": null,
    "artifactStorageBytes": 1099511627776,
    "usageDashboardLevel": "advanced",
    "adminControlsLevel": "advanced",
    "supportLevel": "dedicated",
    "intelligencePolicy": "custom",
    "humanMembersUnlimited": true,
    "aiEmployeesUnlimited": true,
    "unlimited_work_hours": true
  }'::jsonb,
  'enterprise_contract', 'published', now(), now()
from public.billing_plans p where p.code = 'enterprise'
on conflict (plan_id, version) do nothing;

-- Free $0 monthly (no Revolut mapping required)
insert into public.billing_prices (plan_version_id, currency, cadence, amount_minor, provider_ref, sync_status, status, verified_at)
select v.id, 'USD', 'monthly', 0, 'adehq:production:free:v1:USD:monthly', 'published', 'active', now()
from public.billing_plan_versions v
join public.billing_plans p on p.id = v.plan_id
where p.code = 'free' and v.version = 1
on conflict (plan_version_id, currency, cadence) do nothing;

-- Paid prices (sync_status published for local catalog; Revolut IDs filled by sync job)
insert into public.billing_prices (plan_version_id, currency, cadence, amount_minor, provider_ref, sync_status, status, verified_at)
select v.id, 'USD', 'monthly', 1900, 'adehq:production:pro:v1:USD:monthly', 'published', 'active', now()
from public.billing_plan_versions v
join public.billing_plans p on p.id = v.plan_id
where p.code = 'pro' and v.version = 1
on conflict (plan_version_id, currency, cadence) do nothing;

insert into public.billing_prices (plan_version_id, currency, cadence, amount_minor, provider_ref, sync_status, status, verified_at)
select v.id, 'USD', 'annual', 19900, 'adehq:production:pro:v1:USD:annual', 'published', 'active', now()
from public.billing_plan_versions v
join public.billing_plans p on p.id = v.plan_id
where p.code = 'pro' and v.version = 1
on conflict (plan_version_id, currency, cadence) do nothing;

insert into public.billing_prices (plan_version_id, currency, cadence, amount_minor, provider_ref, sync_status, status, verified_at)
select v.id, 'USD', 'monthly', 3900, 'adehq:production:team:v1:USD:monthly', 'published', 'active', now()
from public.billing_plan_versions v
join public.billing_plans p on p.id = v.plan_id
where p.code = 'team' and v.version = 1
on conflict (plan_version_id, currency, cadence) do nothing;

insert into public.billing_prices (plan_version_id, currency, cadence, amount_minor, provider_ref, sync_status, status, verified_at)
select v.id, 'USD', 'annual', 39900, 'adehq:production:team:v1:USD:annual', 'published', 'active', now()
from public.billing_plan_versions v
join public.billing_plans p on p.id = v.plan_id
where p.code = 'team' and v.version = 1
on conflict (plan_version_id, currency, cadence) do nothing;

insert into public.billing_prices (plan_version_id, currency, cadence, amount_minor, provider_ref, sync_status, status, verified_at)
select v.id, 'USD', 'monthly', 9900, 'adehq:production:business:v1:USD:monthly', 'published', 'active', now()
from public.billing_plan_versions v
join public.billing_plans p on p.id = v.plan_id
where p.code = 'business' and v.version = 1
on conflict (plan_version_id, currency, cadence) do nothing;

insert into public.billing_prices (plan_version_id, currency, cadence, amount_minor, provider_ref, sync_status, status, verified_at)
select v.id, 'USD', 'annual', 99900, 'adehq:production:business:v1:USD:annual', 'published', 'active', now()
from public.billing_plan_versions v
join public.billing_plans p on p.id = v.plan_id
where p.code = 'business' and v.version = 1
on conflict (plan_version_id, currency, cadence) do nothing;

-- Align platform_plan_configs Team price to $39 (projection)
update public.platform_plan_configs
set monthly_price_cents = 3900,
    annual_price_cents = 39900,
    weekly_work_hours = 250
where plan_slug = 'team';

update public.platform_plan_configs
set monthly_price_cents = 1900, annual_price_cents = 19900, weekly_work_hours = 125
where plan_slug = 'pro';

update public.platform_plan_configs
set monthly_price_cents = 9900, annual_price_cents = 99900, weekly_work_hours = 650
where plan_slug = 'business';

update public.platform_plan_configs
set weekly_work_hours = 10
where plan_slug = 'free';

-- Pin workspaces to published v1 plan versions
update public.workspaces w
set plan_version_id = v.id
from public.billing_plans p
join public.billing_plan_versions v on v.plan_id = p.id and v.version = 1 and v.status = 'published'
where p.code = lower(coalesce(w.plan_slug, w.plan, 'free'))
  and w.plan_version_id is null;

update public.billing_subscriptions s
set plan_version_id = v.id
from public.billing_plans p
join public.billing_plan_versions v on v.plan_id = p.id and v.version = 1 and v.status = 'published'
where p.code = lower(s.plan_slug)
  and s.plan_version_id is null;

-- Top-up packs
insert into public.wh_topup_products (code, version, wh_amount, price_minor, currency, status)
values
  ('wh_100', 1, 100, 1000, 'USD', 'active'),
  ('wh_500', 1, 500, 4500, 'USD', 'active'),
  ('wh_1500', 1, 1500, 12000, 'USD', 'active')
on conflict (code, version) do nothing;

-- ---------------------------------------------------------------------------
-- RLS: service-role writes; authenticated members can read own workspace rows
-- ---------------------------------------------------------------------------
alter table public.billing_plans enable row level security;
alter table public.billing_plan_versions enable row level security;
alter table public.billing_prices enable row level security;
alter table public.billing_checkout_snapshots enable row level security;
alter table public.billing_provider_sync_jobs enable row level security;
alter table public.wh_credit_lots enable row level security;
alter table public.wh_ledger_entries enable row level security;
alter table public.wh_reservations enable row level security;
alter table public.wh_topup_products enable row level security;
alter table public.billing_promotions enable row level security;
alter table public.billing_promotion_redemptions enable row level security;
alter table public.platform_admin_commerce_roles enable row level security;
alter table public.commerce_audit_events enable row level security;

-- Public catalog read for authenticated
drop policy if exists billing_plans_select_auth on public.billing_plans;
create policy billing_plans_select_auth on public.billing_plans
  for select to authenticated using (true);

drop policy if exists billing_plan_versions_select_public on public.billing_plan_versions;
create policy billing_plan_versions_select_public on public.billing_plan_versions
  for select to authenticated
  using (status = 'published' and visibility = 'public');

drop policy if exists billing_prices_select_active on public.billing_prices;
create policy billing_prices_select_active on public.billing_prices
  for select to authenticated
  using (status = 'active' and sync_status = 'published');

drop policy if exists wh_topup_products_select_active on public.wh_topup_products;
create policy wh_topup_products_select_active on public.wh_topup_products
  for select to authenticated using (status = 'active');

drop policy if exists billing_promotions_select_active on public.billing_promotions;
create policy billing_promotions_select_active on public.billing_promotions
  for select to authenticated using (status = 'active');

revoke insert, update, delete on public.billing_plans from authenticated, anon;
revoke insert, update, delete on public.billing_plan_versions from authenticated, anon;
revoke insert, update, delete on public.billing_prices from authenticated, anon;
revoke insert, update, delete on public.billing_provider_sync_jobs from authenticated, anon;
revoke insert, update, delete on public.wh_topup_products from authenticated, anon;
revoke insert, update, delete on public.billing_promotions from authenticated, anon;
revoke insert, update, delete on public.platform_admin_commerce_roles from authenticated, anon;
revoke insert, update, delete on public.commerce_audit_events from authenticated, anon;

comment on table public.billing_plan_versions is
  'Immutable once published. Never UPDATE weekly_included_wh or entitlements on published rows.';
