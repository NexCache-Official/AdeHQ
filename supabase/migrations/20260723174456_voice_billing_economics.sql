-- PR-18.2E — provider-neutral voice billing, monthly call allowances, and
-- AdeHQ Control economics. All billing tables are service-role only.

create table if not exists public.live_call_usage_periods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_slug text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  allowance_minutes numeric(14, 4),
  used_minutes numeric(14, 4) not null default 0 check (used_minutes >= 0),
  call_count integer not null default 0 check (call_count >= 0),
  entitlement_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, period_start, period_end),
  check (period_end > period_start),
  check (allowance_minutes is null or allowance_minutes >= 0)
);

create index if not exists live_call_usage_periods_workspace_period_idx
  on public.live_call_usage_periods (workspace_id, period_start desc);

drop trigger if exists set_live_call_usage_periods_updated_at
  on public.live_call_usage_periods;
create trigger set_live_call_usage_periods_updated_at
  before update on public.live_call_usage_periods
  for each row execute function public.set_updated_at();

create table if not exists public.voice_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  usage_period_id uuid references public.live_call_usage_periods(id) on delete set null,
  call_id text,
  call_source text not null check (call_source in ('brain_live', 'human_live')),
  plan_slug text not null,
  capability text not null check (capability in (
    'live_call_minutes', 'speech_to_text', 'standard_tts', 'premium_tts'
  )),
  treatment text not null check (treatment in (
    'internal_only', 'platform_absorbed', 'customer_charged'
  )),
  quantity numeric(16, 6) not null default 0 check (quantity >= 0),
  unit text not null check (unit in ('minutes', 'seconds', 'calls', 'characters')),
  internal_cost_usd numeric(16, 8) not null default 0 check (internal_cost_usd >= 0),
  platform_absorbed_usd numeric(16, 8) not null default 0
    check (platform_absorbed_usd >= 0),
  customer_charged_usd numeric(16, 8) not null default 0
    check (customer_charged_usd >= 0),
  customer_charged_wh numeric(14, 6) not null default 0
    check (customer_charged_wh >= 0),
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (platform_absorbed_usd <= internal_cost_usd),
  check (
    treatment <> 'platform_absorbed'
    or customer_charged_usd = 0
  )
);

create index if not exists voice_usage_ledger_workspace_created_idx
  on public.voice_usage_ledger (workspace_id, occurred_at desc);
create index if not exists voice_usage_ledger_capability_created_idx
  on public.voice_usage_ledger (capability, occurred_at desc);
create index if not exists voice_usage_ledger_plan_created_idx
  on public.voice_usage_ledger (plan_slug, occurred_at desc);

alter table public.calls
  add column if not exists duration_seconds integer
    check (duration_seconds is null or duration_seconds >= 0),
  add column if not exists live_call_minutes numeric(14, 4) not null default 0,
  add column if not exists billing_settled_at timestamptz;

alter table public.call_sessions
  add column if not exists duration_seconds integer
    check (duration_seconds is null or duration_seconds >= 0),
  add column if not exists live_call_minutes numeric(14, 4) not null default 0,
  add column if not exists settled_ai_work_hours numeric(14, 6) not null default 0,
  add column if not exists billing_settled_at timestamptz;

-- Launch allowances are calendar-month minutes. Enterprise null means the
-- contracted allowance is uncapped until a workspace-specific contract lands.
update public.platform_plan_configs
set entitlements = jsonb_set(
  coalesce(entitlements, '{}'::jsonb),
  '{voice}',
  coalesce(entitlements->'voice', '{}'::jsonb) ||
    jsonb_build_object(
      'monthly_live_call_minutes',
      case plan_slug
        when 'free' then to_jsonb(0)
        when 'pro' then to_jsonb(120)
        when 'team' then to_jsonb(500)
        when 'business' then to_jsonb(2000)
        when 'enterprise' then 'null'::jsonb
        else coalesce(entitlements#>'{voice,monthly_live_call_minutes}', to_jsonb(0))
      end,
      'standard_tts_internal_usd_per_call', 0.02,
      'standard_tts_customer_wh_per_call', 0,
      'standard_tts_treatment', 'platform_absorbed',
      'premium_tts_treatment', 'customer_charged',
      'stt_treatment', 'platform_absorbed',
      'transcript_included', true,
      'captions_included', true
    ),
  true
);

-- Atomically creates the monthly bucket and burns one call's duration exactly
-- once. Call minutes are per session, never multiplied by participant/AI count.
create or replace function public.burn_live_call_minutes(
  p_workspace_id uuid,
  p_plan_slug text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_allowance_minutes numeric,
  p_minutes numeric,
  p_call_id text,
  p_call_source text,
  p_duration_seconds integer,
  p_idempotency_key text,
  p_entitlement_snapshot jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period public.live_call_usage_periods%rowtype;
  v_inserted integer := 0;
begin
  if p_minutes < 0 or p_duration_seconds < 0 then
    raise exception 'Voice usage cannot be negative';
  end if;
  if p_call_source not in ('brain_live', 'human_live') then
    raise exception 'Invalid call source';
  end if;

  insert into public.live_call_usage_periods (
    workspace_id, plan_slug, period_start, period_end, allowance_minutes,
    entitlement_snapshot
  ) values (
    p_workspace_id, p_plan_slug, p_period_start, p_period_end,
    p_allowance_minutes, coalesce(p_entitlement_snapshot, '{}'::jsonb)
  )
  on conflict (workspace_id, period_start, period_end) do update
    set plan_slug = excluded.plan_slug,
        allowance_minutes = excluded.allowance_minutes,
        entitlement_snapshot = excluded.entitlement_snapshot
  returning * into v_period;

  insert into public.voice_usage_ledger (
    workspace_id, usage_period_id, call_id, call_source, plan_slug,
    capability, treatment, quantity, unit, idempotency_key, metadata
  ) values (
    p_workspace_id, v_period.id, p_call_id, p_call_source, p_plan_slug,
    'live_call_minutes', 'internal_only', p_minutes, 'minutes',
    p_idempotency_key,
    jsonb_build_object('duration_seconds', p_duration_seconds)
  )
  on conflict (idempotency_key) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update public.live_call_usage_periods
    set used_minutes = used_minutes + p_minutes,
        call_count = call_count + 1
    where id = v_period.id
    returning * into v_period;
  else
    select * into v_period
    from public.live_call_usage_periods
    where id = v_period.id;
  end if;

  return jsonb_build_object(
    'periodId', v_period.id,
    'planSlug', v_period.plan_slug,
    'periodStart', v_period.period_start,
    'periodEnd', v_period.period_end,
    'allowanceMinutes', v_period.allowance_minutes,
    'usedMinutes', v_period.used_minutes,
    'remainingMinutes', case
      when v_period.allowance_minutes is null then null
      else greatest(v_period.allowance_minutes - v_period.used_minutes, 0)
    end,
    'callCount', v_period.call_count,
    'burnApplied', v_inserted = 1
  );
end;
$$;

alter table public.live_call_usage_periods enable row level security;
alter table public.voice_usage_ledger enable row level security;

revoke all on table public.live_call_usage_periods from anon, authenticated;
revoke all on table public.voice_usage_ledger from anon, authenticated;
revoke execute on function public.burn_live_call_minutes(
  uuid, text, timestamptz, timestamptz, numeric, numeric, text, text,
  integer, text, jsonb
) from public, anon, authenticated;
grant execute on function public.burn_live_call_minutes(
  uuid, text, timestamptz, timestamptz, numeric, numeric, text, text,
  integer, text, jsonb
) to service_role;

comment on table public.live_call_usage_periods is
  'Service-only monthly live-call minute buckets. Null allowance is contracted/unlimited.';
comment on table public.voice_usage_ledger is
  'Service-only voice economics ledger separating internal COGS, platform subsidy, and customer charge.';
comment on function public.burn_live_call_minutes is
  'Service-only idempotent monthly call-minute settlement; one burn per call session.';
