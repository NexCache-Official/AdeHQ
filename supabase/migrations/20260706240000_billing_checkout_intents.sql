-- Commercial Usage System — Phase 6: billing checkout intents.
-- Internal bridge between the pricing/billing UI and the payment provider (Revolut, Phase 10).
-- An intent is created when an owner/admin starts an upgrade, before any external redirect.

create table if not exists public.billing_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  plan_slug text not null references public.platform_plan_configs(plan_slug),
  interval text not null default 'monthly' check (interval in ('monthly', 'annual')),
  promo_code_id uuid null,
  status text not null default 'pending'
    check (status in ('pending', 'started', 'completed', 'cancelled', 'failed')),
  provider text not null default 'revolut',
  external_order_id text null,
  amount_cents integer null,
  currency text not null default 'USD',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_checkout_intents_workspace
  on public.billing_checkout_intents (workspace_id, created_at desc);
create index if not exists idx_billing_checkout_intents_external
  on public.billing_checkout_intents (external_order_id)
  where external_order_id is not null;

drop trigger if exists set_billing_checkout_intents_updated_at on public.billing_checkout_intents;
create trigger set_billing_checkout_intents_updated_at
  before update on public.billing_checkout_intents
  for each row execute function public.set_updated_at();

alter table public.billing_checkout_intents enable row level security;
