-- Maya Workforce Studio (PR-21A): schema/rule/simulation versioning, draft +
-- append-only revision history, draft locking, template governance,
-- provenance columns, and the Company Operating Profile.
--
-- Access model follows the rest of AdeHQ: service-role only from the server
-- (see AGENTS.md "Prefer service-role only on the server"). RLS below is a
-- defense-in-depth backstop scoped to workspace admins, matching
-- is_workspace_admin() used across hiring/admin tables.

-- ===========================================================================
-- Company Operating Profile — persistent, versioned company context that
-- grounds every Workforce Studio decision (Maya reads it, never guesses).
-- ===========================================================================
create table if not exists public.company_operating_profiles (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  revision integer not null default 1,
  payload jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_operating_profile_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  revision integer not null,
  payload jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, revision)
);

-- ===========================================================================
-- Workforce Blueprints — the durable, versioned artifact behind a designed
-- team. draft_payload is the live editable state; approved_payload is an
-- immutable snapshot frozen at approval time and used for provisioning.
-- ===========================================================================
create table if not exists public.workforce_blueprints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null default 'Untitled team',
  template_key text not null,
  template_version text not null default '1.0.0',
  blueprint_mode text not null default 'new_team'
    check (blueprint_mode in ('new_team')),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'provisioning', 'active', 'superseded', 'archived')),

  -- Engine versions captured at last edit — every revision is reproducible
  -- against the exact rule/simulation logic that produced it.
  schema_version integer not null default 1,
  template_engine_version text not null default '1.0.0',
  composition_rules_version text not null default '1.0.0',
  simulation_engine_version text not null default '1.0.0',

  revision integer not null default 1,
  draft_payload jsonb not null default '{}'::jsonb,

  approved_revision integer,
  approved_payload jsonb,
  approval_hash text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,

  -- Draft locking + optimistic concurrency (single active editor at a time).
  lock_token uuid,
  locked_by_user_id uuid references auth.users(id) on delete set null,
  lock_acquired_at timestamptz,
  lock_expires_at timestamptz,

  simulation_report jsonb,
  simulated_at timestamptz,

  superseded_by_blueprint_id uuid references public.workforce_blueprints(id) on delete set null,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_workforce_blueprints_workspace
  on public.workforce_blueprints(workspace_id, status, updated_at desc);

-- Append-only revision history for audit + reproducibility. Never updated or
-- deleted once written.
create table if not exists public.workforce_blueprint_revisions (
  id uuid primary key default gen_random_uuid(),
  blueprint_id uuid not null references public.workforce_blueprints(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  revision integer not null,
  payload jsonb not null,
  change_summary text not null default '',
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (blueprint_id, revision)
);

create index if not exists idx_workforce_blueprint_revisions_blueprint
  on public.workforce_blueprint_revisions(blueprint_id, revision desc);

-- ===========================================================================
-- Template governance — published, versioned template manifests. Source of
-- truth for manifests is code (src/lib/hiring/workforce-studio/templates),
-- this table tracks publish state / rollout so we never silently change the
-- behavior of an already-approved blueprint.
-- ===========================================================================
create table if not exists public.workforce_studio_templates (
  template_key text not null,
  version text not null,
  name text not null,
  status text not null default 'published'
    check (status in ('draft', 'published', 'deprecated')),
  manifest_checksum text not null,
  published_at timestamptz not null default now(),
  deprecated_at timestamptz,
  primary key (template_key, version)
);

-- ===========================================================================
-- Team Hire Plans — one durable, idempotent provisioning saga per approved
-- blueprint revision. Steps are batched and individually checkpointed so
-- provisioning survives serverless function timeouts and retries safely.
-- ===========================================================================
create table if not exists public.team_hire_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  blueprint_id uuid not null references public.workforce_blueprints(id) on delete cascade,
  blueprint_revision integer not null,
  approval_hash text not null,
  idempotency_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'cancelled', 'compensating', 'compensated')),
  total_steps integer not null default 0,
  completed_steps integer not null default 0,
  error jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, idempotency_key)
);

create index if not exists idx_team_hire_plans_blueprint
  on public.team_hire_plans(blueprint_id, created_at desc);

create table if not exists public.team_hire_plan_steps (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.team_hire_plans(id) on delete cascade,
  step_index integer not null,
  step_type text not null
    check (step_type in (
      'create_room', 'create_employee', 'grant_tools', 'add_room_member',
      'create_collaboration_edge', 'create_outcome_task', 'create_artifact',
      'first_mission_task', 'first_mission_message'
    )),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'compensated', 'skipped')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  provenance jsonb not null default '{}'::jsonb,
  depends_on_step_indexes integer[] not null default '{}'::integer[],

  -- Exclusive ownership for the batched executor (atomic conditional claim).
  owner_token uuid,
  owner_acquired_at timestamptz,

  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, step_index)
);

create index if not exists idx_team_hire_plan_steps_plan_status
  on public.team_hire_plan_steps(plan_id, status, step_index);

-- ===========================================================================
-- Workforce Studio events — composer-specific analytics, additive to the
-- existing recordAiRuntime hooks (which cover AI usage, not composer UX).
-- ===========================================================================
create table if not exists public.workforce_studio_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  blueprint_id uuid references public.workforce_blueprints(id) on delete set null,
  plan_id uuid references public.team_hire_plans(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_workforce_studio_events_workspace
  on public.workforce_studio_events(workspace_id, created_at desc);

-- ===========================================================================
-- Provenance columns — link objects created by a hire plan back to the exact
-- blueprint revision + plan that produced them (for audit + compensation).
-- ===========================================================================
alter table public.ai_employees
  add column if not exists created_by_blueprint_id uuid references public.workforce_blueprints(id) on delete set null,
  add column if not exists created_by_blueprint_revision integer,
  add column if not exists created_by_plan_id uuid references public.team_hire_plans(id) on delete set null;

alter table public.rooms
  add column if not exists created_by_blueprint_id uuid references public.workforce_blueprints(id) on delete set null,
  add column if not exists created_by_blueprint_revision integer,
  add column if not exists created_by_plan_id uuid references public.team_hire_plans(id) on delete set null;

alter table public.employee_tools
  add column if not exists created_by_plan_id uuid references public.team_hire_plans(id) on delete set null;

alter table public.artifacts
  add column if not exists created_by_blueprint_id uuid references public.workforce_blueprints(id) on delete set null,
  add column if not exists created_by_blueprint_revision integer,
  add column if not exists created_by_plan_id uuid references public.team_hire_plans(id) on delete set null;

alter table public.tasks
  add column if not exists created_by_blueprint_id uuid references public.workforce_blueprints(id) on delete set null,
  add column if not exists created_by_blueprint_revision integer,
  add column if not exists created_by_plan_id uuid references public.team_hire_plans(id) on delete set null;

alter table public.work_graph_edges
  add column if not exists created_by_blueprint_id uuid references public.workforce_blueprints(id) on delete set null,
  add column if not exists created_by_plan_id uuid references public.team_hire_plans(id) on delete set null;

-- Extend artifact_type for Workforce Studio generated artifacts (additive —
-- existing values are unaffected).
alter table public.artifacts drop constraint if exists artifacts_artifact_type_check;
alter table public.artifacts
  add constraint artifacts_artifact_type_check
  check (artifact_type in (
    'prd', 'report', 'brief', 'research_summary', 'meeting_notes',
    'strategy_memo', 'email_draft', 'proposal', 'checklist', 'decision', 'note', 'other',
    'team_charter', 'role_scorecard', 'workforce_blueprint_summary'
  ));

-- ===========================================================================
-- Triggers
-- ===========================================================================
drop trigger if exists set_company_operating_profiles_updated_at on public.company_operating_profiles;
create trigger set_company_operating_profiles_updated_at
before update on public.company_operating_profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_workforce_blueprints_updated_at on public.workforce_blueprints;
create trigger set_workforce_blueprints_updated_at
before update on public.workforce_blueprints
for each row execute function public.set_updated_at();

drop trigger if exists set_team_hire_plans_updated_at on public.team_hire_plans;
create trigger set_team_hire_plans_updated_at
before update on public.team_hire_plans
for each row execute function public.set_updated_at();

drop trigger if exists set_team_hire_plan_steps_updated_at on public.team_hire_plan_steps;
create trigger set_team_hire_plan_steps_updated_at
before update on public.team_hire_plan_steps
for each row execute function public.set_updated_at();

-- ===========================================================================
-- RLS — admin-only, workspace-scoped. Server routes use the service-role
-- client (bypasses RLS) after requireHireAdmin(); this is a backstop.
-- ===========================================================================
alter table public.company_operating_profiles enable row level security;
alter table public.company_operating_profile_revisions enable row level security;
alter table public.workforce_blueprints enable row level security;
alter table public.workforce_blueprint_revisions enable row level security;
alter table public.workforce_studio_templates enable row level security;
alter table public.team_hire_plans enable row level security;
alter table public.team_hire_plan_steps enable row level security;
alter table public.workforce_studio_events enable row level security;

drop policy if exists "cop_admin_all" on public.company_operating_profiles;
create policy "cop_admin_all"
on public.company_operating_profiles for all
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

drop policy if exists "cop_revisions_admin_select" on public.company_operating_profile_revisions;
create policy "cop_revisions_admin_select"
on public.company_operating_profile_revisions for select
using (public.is_workspace_admin(workspace_id));

drop policy if exists "wf_blueprints_admin_all" on public.workforce_blueprints;
create policy "wf_blueprints_admin_all"
on public.workforce_blueprints for all
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

drop policy if exists "wf_blueprint_revisions_admin_select" on public.workforce_blueprint_revisions;
create policy "wf_blueprint_revisions_admin_select"
on public.workforce_blueprint_revisions for select
using (public.is_workspace_admin(workspace_id));

drop policy if exists "wf_templates_member_select" on public.workforce_studio_templates;
create policy "wf_templates_member_select"
on public.workforce_studio_templates for select
using (true);

drop policy if exists "team_hire_plans_admin_all" on public.team_hire_plans;
create policy "team_hire_plans_admin_all"
on public.team_hire_plans for all
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

drop policy if exists "team_hire_plan_steps_admin_select" on public.team_hire_plan_steps;
create policy "team_hire_plan_steps_admin_select"
on public.team_hire_plan_steps for select
using (
  exists (
    select 1 from public.team_hire_plans p
    where p.id = team_hire_plan_steps.plan_id
      and public.is_workspace_admin(p.workspace_id)
  )
);

drop policy if exists "workforce_studio_events_admin_all" on public.workforce_studio_events;
create policy "workforce_studio_events_admin_all"
on public.workforce_studio_events for all
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));
