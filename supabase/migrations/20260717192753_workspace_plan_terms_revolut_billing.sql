-- Workspace plan terms, AI offline status, Revolut-only billing column cleanup.

-- ---------------------------------------------------------------------------
-- Plan terms on workspaces
-- ---------------------------------------------------------------------------
alter table public.workspaces
  add column if not exists plan_slug text,
  add column if not exists free_plan_started_at timestamptz,
  add column if not exists current_plan_started_at timestamptz;

update public.workspaces
set plan_slug = case
  when lower(coalesce(plan_slug, plan, '')) in ('founder', 'free', '') then 'free'
  else lower(coalesce(plan_slug, plan, 'free'))
end
where plan_slug is null
   or lower(coalesce(plan_slug, '')) in ('founder', '');

update public.workspaces
set plan = coalesce(plan_slug, 'free')
where lower(coalesce(plan, '')) in ('founder', '');

update public.workspaces
set free_plan_started_at = coalesce(free_plan_started_at, created_at, now())
where free_plan_started_at is null;

update public.workspaces w
set current_plan_started_at = coalesce(
  w.current_plan_started_at,
  (
    select s.current_period_start
    from public.billing_subscriptions s
    where s.workspace_id = w.id
      and s.status in ('trialing', 'active', 'manual', 'comped', 'enterprise')
    order by s.created_at desc
    limit 1
  ),
  w.created_at,
  now()
)
where w.current_plan_started_at is null;

alter table public.workspaces
  alter column plan_slug set default 'free',
  alter column free_plan_started_at set default now(),
  alter column current_plan_started_at set default now();

alter table public.workspaces
  alter column plan_slug set not null,
  alter column free_plan_started_at set not null,
  alter column current_plan_started_at set not null;

-- Append-only plan term audit
create table if not exists public.workspace_plan_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  from_plan_slug text,
  to_plan_slug text not null,
  source text not null check (
    source in ('signup', 'checkout', 'promo', 'override', 'admin')
  ),
  actor_user_id uuid references auth.users(id) on delete set null,
  reason text,
  started_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists workspace_plan_events_workspace_created_idx
  on public.workspace_plan_events (workspace_id, created_at desc);

alter table public.workspace_plan_events enable row level security;

drop policy if exists workspace_plan_events_select_members on public.workspace_plan_events;
create policy workspace_plan_events_select_members
  on public.workspace_plan_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workspace_members m
      where m.workspace_id = workspace_plan_events.workspace_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

revoke insert, update, delete on public.workspace_plan_events from authenticated, anon;

-- ---------------------------------------------------------------------------
-- AI employee offline status (no prior check constraint in production)
-- ---------------------------------------------------------------------------
comment on column public.ai_employees.status is
  'online | idle | working | waiting_approval | on_call | blocked | offline';

-- ---------------------------------------------------------------------------
-- Revolut-only billing: rename legacy stripe_* → external_*
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'billing_customers'
      and column_name = 'stripe_customer_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'billing_customers'
      and column_name = 'external_customer_id'
  ) then
    alter table public.billing_customers rename column stripe_customer_id to external_customer_id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'billing_subscriptions'
      and column_name = 'stripe_subscription_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'billing_subscriptions'
      and column_name = 'external_subscription_id'
  ) then
    alter table public.billing_subscriptions rename column stripe_subscription_id to external_subscription_id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'billing_invoices'
      and column_name = 'stripe_invoice_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'billing_invoices'
      and column_name = 'external_payment_id'
  ) then
    alter table public.billing_invoices rename column stripe_invoice_id to external_payment_id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'billing_events'
      and column_name = 'stripe_event_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'billing_events'
      and column_name = 'external_event_id'
  ) then
    alter table public.billing_events rename column stripe_event_id to external_event_id;
  end if;
end $$;

alter table public.billing_subscriptions
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Checkout intents: revolut is the only payment provider
alter table public.billing_checkout_intents
  alter column provider set default 'revolut';
