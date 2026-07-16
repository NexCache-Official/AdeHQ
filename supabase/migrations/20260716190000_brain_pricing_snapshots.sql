-- AdeHQ Brain PR-1: billing-authority pricing snapshots (immutable).
-- ai_model_price_snapshots remains the provider sync cache; this table is what charges reference.

create table if not exists public.brain_pricing_snapshots (
  id text primary key,
  route_id text not null,
  currency text not null default 'USD',
  effective_from timestamptz not null,
  effective_to timestamptz null,
  input_per_million numeric(14,8) null,
  output_per_million numeric(14,8) null,
  cached_input_per_million numeric(14,8) null,
  per_image numeric(14,8) null,
  per_video numeric(14,8) null,
  per_thousand_utf8_bytes numeric(14,8) null,
  per_search_request numeric(14,8) null,
  per_browser_second numeric(14,8) null,
  source text not null,
  created_at timestamptz not null default now(),
  constraint brain_pricing_snapshots_source_check
    check (source in ('manual', 'vercel_sync', 'siliconflow_sync', 'seed'))
);

create unique index if not exists uq_brain_pricing_snapshots_live_route
  on public.brain_pricing_snapshots (route_id)
  where effective_to is null;

create index if not exists idx_brain_pricing_snapshots_route_effective
  on public.brain_pricing_snapshots (route_id, effective_from desc);

alter table public.brain_pricing_snapshots enable row level security;

-- Workspace members may read live/historical rates for receipts; writes are service-role only.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'brain_pricing_snapshots'
      and policyname = 'brain_pricing_snapshots_select_member'
  ) then
    create policy brain_pricing_snapshots_select_member
      on public.brain_pricing_snapshots
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.workspace_members wm
          where wm.user_id = auth.uid()
            and wm.status = 'active'
        )
      );
  end if;
end $$;

revoke insert, update, delete on public.brain_pricing_snapshots from authenticated, anon;
grant select on public.brain_pricing_snapshots to authenticated;
grant all on public.brain_pricing_snapshots to service_role;
