-- AdeHQ Brain PR-3: run / decision attempt / capability step / packet audit persistence.

create table if not exists public.brain_runs (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id text null,
  room_id text null,
  topic_id text null,
  trigger_message_id text null,
  intensity text not null,
  packet_version text not null,
  decision_version text not null,
  router_version text not null,
  catalog_version text not null,
  status text not null default 'running',
  final_accepted_decision_id text null,
  route_affinity jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint brain_runs_intensity_check
    check (intensity in ('fast', 'standard', 'deep', 'research')),
  constraint brain_runs_status_check
    check (status in ('running', 'completed', 'failed', 'cancelled', 'blocked'))
);

create index if not exists idx_brain_runs_workspace_created
  on public.brain_runs (workspace_id, created_at desc);

create table if not exists public.brain_decision_attempts (
  id text primary key,
  brain_run_id text not null references public.brain_runs(id) on delete cascade,
  attempt_number integer not null,
  reason text not null,
  capability text not null,
  intensity text not null,
  route_id text not null,
  eligibility_rejections jsonb not null default '[]'::jsonb,
  score_factors jsonb null,
  status text not null default 'running',
  created_at timestamptz not null default now(),
  unique (brain_run_id, attempt_number),
  constraint brain_decision_attempts_status_check
    check (status in ('running', 'accepted', 'failed', 'superseded'))
);

create index if not exists idx_brain_decision_attempts_run
  on public.brain_decision_attempts (brain_run_id, attempt_number);

create table if not exists public.brain_capability_steps (
  id text primary key,
  brain_run_id text not null references public.brain_runs(id) on delete cascade,
  decision_attempt_id text not null references public.brain_decision_attempts(id) on delete cascade,
  capability text not null,
  route_id text not null,
  dependencies text[] not null default '{}',
  input_artifact_ids text[] not null default '{}',
  output_contract jsonb not null,
  estimated_min_cost_usd numeric(14,8) not null default 0,
  estimated_likely_cost_usd numeric(14,8) not null default 0,
  estimated_max_cost_usd numeric(14,8) not null default 0,
  max_cost_usd numeric(14,8) not null,
  approval_required boolean not null default false,
  route_affinity_key text null,
  route_stickiness text not null default 'task',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint brain_capability_steps_stickiness_check
    check (route_stickiness in ('none', 'task', 'artifact', 'conversation'))
);

create index if not exists idx_brain_capability_steps_run
  on public.brain_capability_steps (brain_run_id);

create table if not exists public.brain_packet_audits (
  id text primary key,
  brain_run_id text not null references public.brain_runs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pricing_snapshot_id text null,
  source_ids jsonb not null default '[]'::jsonb,
  content_hashes jsonb not null default '[]'::jsonb,
  excerpt_refs jsonb not null default '[]'::jsonb,
  decision_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_brain_packet_audits_run
  on public.brain_packet_audits (brain_run_id);

alter table public.brain_runs enable row level security;
alter table public.brain_decision_attempts enable row level security;
alter table public.brain_capability_steps enable row level security;
alter table public.brain_packet_audits enable row level security;

-- Members can read their workspace brain diagnostics; writes are service-role.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'brain_runs'
      and policyname = 'brain_runs_select_member'
  ) then
    create policy brain_runs_select_member on public.brain_runs
      for select to authenticated
      using (
        exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = brain_runs.workspace_id
            and wm.user_id = auth.uid()
            and wm.status = 'active'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'brain_decision_attempts'
      and policyname = 'brain_decision_attempts_select_member'
  ) then
    create policy brain_decision_attempts_select_member on public.brain_decision_attempts
      for select to authenticated
      using (
        exists (
          select 1 from public.brain_runs br
          join public.workspace_members wm on wm.workspace_id = br.workspace_id
          where br.id = brain_decision_attempts.brain_run_id
            and wm.user_id = auth.uid()
            and wm.status = 'active'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'brain_capability_steps'
      and policyname = 'brain_capability_steps_select_member'
  ) then
    create policy brain_capability_steps_select_member on public.brain_capability_steps
      for select to authenticated
      using (
        exists (
          select 1 from public.brain_runs br
          join public.workspace_members wm on wm.workspace_id = br.workspace_id
          where br.id = brain_capability_steps.brain_run_id
            and wm.user_id = auth.uid()
            and wm.status = 'active'
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'brain_packet_audits'
      and policyname = 'brain_packet_audits_select_member'
  ) then
    create policy brain_packet_audits_select_member on public.brain_packet_audits
      for select to authenticated
      using (
        exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = brain_packet_audits.workspace_id
            and wm.user_id = auth.uid()
            and wm.status = 'active'
        )
      );
  end if;
end $$;

revoke insert, update, delete on public.brain_runs from authenticated, anon;
revoke insert, update, delete on public.brain_decision_attempts from authenticated, anon;
revoke insert, update, delete on public.brain_capability_steps from authenticated, anon;
revoke insert, update, delete on public.brain_packet_audits from authenticated, anon;
grant select on public.brain_runs, public.brain_decision_attempts, public.brain_capability_steps, public.brain_packet_audits to authenticated;
grant all on public.brain_runs, public.brain_decision_attempts, public.brain_capability_steps, public.brain_packet_audits to service_role;
