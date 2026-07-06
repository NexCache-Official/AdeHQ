-- AdeHQ Control — Stage 3 billing skeleton (tables only; Stripe webhooks later)

create table if not exists public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stripe_customer_id text unique,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  billing_customer_id uuid references public.billing_customers(id) on delete set null,
  stripe_subscription_id text unique,
  plan_slug text not null references public.platform_plan_configs(plan_slug),
  status text not null default 'trialing',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stripe_invoice_id text unique,
  amount_cents integer not null default 0,
  currency text not null default 'usd',
  status text not null default 'draft',
  hosted_invoice_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text unique,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_credit_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  credit_type text not null default 'work_hours',
  amount numeric(12, 4) not null,
  reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_plan_overrides (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  plan_slug text not null references public.platform_plan_configs(plan_slug),
  reason text,
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.billing_customers enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_events enable row level security;
alter table public.usage_credit_grants enable row level security;
alter table public.workspace_plan_overrides enable row level security;
