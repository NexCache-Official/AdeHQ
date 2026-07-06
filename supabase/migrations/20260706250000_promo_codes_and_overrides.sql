-- Commercial Usage System — Phase 9: promo codes, redemptions, and override finalization.

create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text null,
  active boolean not null default true,

  discount_type text not null,
  -- percent_off | amount_off | free_trial_days | free_months | extra_work_hours | plan_override

  percent_off numeric(5,2) null,
  amount_off_cents integer null,
  currency text not null default 'USD',

  free_trial_days integer null,
  free_months integer null,
  extra_work_hours_per_week numeric(14,4) null,

  applies_to_plan text null,
  duration_type text not null default 'once',
  -- once | repeating_months | forever

  duration_months integer null,
  max_redemptions integer null,
  max_redemptions_per_user integer not null default 1,

  starts_at timestamptz null,
  expires_at timestamptz null,

  metadata jsonb not null default '{}'::jsonb,

  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.promo_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references public.promo_codes(id) on delete cascade,
  user_id uuid not null,
  workspace_id uuid null references public.workspaces(id) on delete set null,
  billing_subscription_id uuid null,
  redeemed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_promo_code_redemptions_code
  on public.promo_code_redemptions (promo_code_id);
create index if not exists idx_promo_code_redemptions_workspace
  on public.promo_code_redemptions (workspace_id)
  where workspace_id is not null;

-- Finalize workspace_plan_overrides: work-hours override + start window (read by the resolver).
alter table public.workspace_plan_overrides
  add column if not exists weekly_ai_work_hours_override numeric(14,4) null;
alter table public.workspace_plan_overrides
  add column if not exists starts_at timestamptz null;

alter table public.promo_codes enable row level security;
alter table public.promo_code_redemptions enable row level security;
