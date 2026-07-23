-- PR-25 — Playbook, Procedure, and Artifact Runtime (additive)
-- Extends existing artifacts / brain_shared_findings; adds playbook + procedure tables.
-- All customer features remain gated by platform/env flags (default OFF).

-- ---------------------------------------------------------------------------
-- Platform feature flags (default OFF)
-- ---------------------------------------------------------------------------
insert into public.platform_feature_flags (key, value, flag_type, description)
select v.key, v.value::jsonb, v.flag_type, v.description
from (values
  ('adehq_playbook_runtime_v1', 'false', 'boolean', 'PR-25 Playbook runtime (server)'),
  ('adehq_artifact_runtime_v1', 'false', 'boolean', 'PR-25 Artifact runtime (server)'),
  ('adehq_procedure_runtime_v1', 'false', 'boolean', 'PR-25 Procedure backpack (server)'),
  ('adehq_artifact_export_v1', 'false', 'boolean', 'PR-25 Artifact export jobs'),
  ('adehq_custom_playbooks_v1', 'false', 'boolean', 'PR-25 Maya custom Playbook builder'),
  ('adehq_artifact_visual_qa_v1', 'false', 'boolean', 'PR-25 vision-based artifact QA')
) as v(key, value, flag_type, description)
where not exists (
  select 1 from public.platform_feature_flags f
  where f.key = v.key and f.scope = 'global' and f.scope_id is null
);

-- ---------------------------------------------------------------------------
-- Extend artifacts (identity stays; structured runtime columns are additive)
-- ---------------------------------------------------------------------------
alter table public.artifacts
  add column if not exists kind text,
  add column if not exists current_version_id uuid,
  add column if not exists work_item_id text;

alter table public.artifacts drop constraint if exists artifacts_kind_check;
alter table public.artifacts
  add constraint artifacts_kind_check
  check (kind is null or kind in (
    'document', 'presentation', 'workbook', 'report', 'checklist', 'dataset'
  ));

-- Widen artifact_type for PR-25 customer-facing kinds (keep existing values).
alter table public.artifacts drop constraint if exists artifacts_artifact_type_check;
alter table public.artifacts
  add constraint artifacts_artifact_type_check
  check (artifact_type in (
    'prd', 'report', 'brief', 'research_summary', 'meeting_notes',
    'strategy_memo', 'email_draft', 'proposal', 'checklist', 'decision', 'note', 'other',
    'team_charter', 'role_scorecard', 'workforce_blueprint_summary',
    'document', 'presentation', 'workbook', 'dataset',
    'image', 'video', 'audio'
  ));

alter table public.artifacts drop constraint if exists artifacts_status_check;
alter table public.artifacts
  add constraint artifacts_status_check
  check (status in (
    'draft', 'saved', 'archived',
    'in_review', 'approved', 'published', 'superseded'
  ));

-- ---------------------------------------------------------------------------
-- Extend artifact_versions
-- ---------------------------------------------------------------------------
alter table public.artifact_versions
  add column if not exists schema_key text,
  add column if not exists schema_version integer,
  add column if not exists canonical_content jsonb,
  add column if not exists content_hash text,
  add column if not exists template_version_id uuid,
  add column if not exists brand_kit_version_id uuid,
  add column if not exists brain_run_id text,
  add column if not exists playbook_run_id uuid,
  add column if not exists origin text,
  add column if not exists status text not null default 'draft';

alter table public.artifact_versions drop constraint if exists artifact_versions_status_check;
alter table public.artifact_versions
  add constraint artifact_versions_status_check
  check (status in ('draft', 'in_review', 'approved', 'published', 'superseded'));

alter table public.artifact_versions drop constraint if exists artifact_versions_origin_check;
alter table public.artifact_versions
  add constraint artifact_versions_origin_check
  check (origin is null or origin in (
    'playbook', 'manual', 'import', 'procedure', 'conversion', 'system'
  ));

create unique index if not exists idx_artifact_versions_content_hash
  on public.artifact_versions (artifact_id, content_hash)
  where content_hash is not null;

-- ---------------------------------------------------------------------------
-- Extend brain_shared_findings for playbook collaboration
-- ---------------------------------------------------------------------------
alter table public.brain_shared_findings
  add column if not exists playbook_run_id uuid,
  add column if not exists playbook_run_step_id uuid,
  add column if not exists artifact_id uuid,
  add column if not exists artifact_section_key text,
  add column if not exists finding_type text,
  add column if not exists source_refs jsonb not null default '[]'::jsonb;

create index if not exists idx_brain_shared_findings_playbook_run
  on public.brain_shared_findings (workspace_id, playbook_run_id)
  where playbook_run_id is not null;

-- ---------------------------------------------------------------------------
-- Playbooks
-- ---------------------------------------------------------------------------
create table if not exists public.playbooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  category text not null default 'general'
    check (category in (
      'research', 'product', 'engineering', 'sales', 'marketing',
      'operations', 'customer_success', 'general'
    )),
  industry_tags text[] not null default '{}'::text[],
  visibility text not null default 'platform'
    check (visibility in ('platform', 'workspace', 'private')),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'deprecated', 'archived')),
  current_version_id uuid,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint playbooks_platform_or_workspace check (
    (visibility = 'platform' and workspace_id is null)
    or (visibility in ('workspace', 'private') and workspace_id is not null)
  )
);

create unique index if not exists idx_playbooks_platform_key
  on public.playbooks (key)
  where workspace_id is null;

create unique index if not exists idx_playbooks_workspace_key
  on public.playbooks (workspace_id, key)
  where workspace_id is not null;

create index if not exists idx_playbooks_workspace_status
  on public.playbooks (workspace_id, status, updated_at desc);

create table if not exists public.playbook_versions (
  id uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references public.playbooks(id) on delete cascade,
  version integer not null,
  definition jsonb not null,
  schema_version integer not null default 1,
  checksum text not null,
  estimated_wh_min numeric,
  estimated_wh_max numeric,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  unique (playbook_id, version),
  unique (playbook_id, checksum)
);

alter table public.playbooks
  drop constraint if exists playbooks_current_version_fk;
alter table public.playbooks
  add constraint playbooks_current_version_fk
  foreign key (current_version_id) references public.playbook_versions(id);

create table if not exists public.playbook_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  playbook_id uuid not null references public.playbooks(id),
  playbook_version_id uuid not null references public.playbook_versions(id),
  brain_run_id text,
  room_id text,
  topic_id text,
  work_item_id text,
  initiated_by_user_id uuid not null,
  status text not null default 'draft'
    check (status in (
      'draft', 'awaiting_input', 'estimating', 'awaiting_approval',
      'queued', 'running', 'blocked', 'reviewing', 'rendering',
      'completed', 'failed', 'cancelled'
    )),
  input_payload jsonb not null default '{}'::jsonb,
  output_summary jsonb,
  estimated_wh_min numeric,
  estimated_wh_max numeric,
  hard_wh_limit numeric,
  actual_wh numeric not null default 0,
  selected_employee_ids uuid[] not null default '{}'::uuid[],
  plan_snapshot jsonb,
  approval_id uuid,
  idempotency_key text not null,
  error_code text,
  safe_error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id) on delete set null
);

create index if not exists idx_playbook_runs_workspace_status
  on public.playbook_runs (workspace_id, status, created_at desc);
create index if not exists idx_playbook_runs_brain
  on public.playbook_runs (workspace_id, brain_run_id)
  where brain_run_id is not null;

create table if not exists public.playbook_run_steps (
  id uuid primary key default gen_random_uuid(),
  playbook_run_id uuid not null references public.playbook_runs(id) on delete cascade,
  step_key text not null,
  brain_step_id text,
  status text not null default 'pending'
    check (status in (
      'pending', 'ready', 'leased', 'running', 'awaiting_approval',
      'completed', 'failed', 'cancelled', 'skipped'
    )),
  assigned_employee_id uuid,
  depends_on text[] not null default '{}'::text[],
  input_snapshot jsonb,
  output_payload jsonb,
  output_artifact_id uuid references public.artifacts(id) on delete set null,
  attempt_count integer not null default 0,
  estimated_wh numeric,
  actual_wh numeric not null default 0,
  lease_owner text,
  lease_expires_at timestamptz,
  error_code text,
  safe_error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (playbook_run_id, step_key)
);

create index if not exists idx_playbook_run_steps_status
  on public.playbook_run_steps (playbook_run_id, status);

-- ---------------------------------------------------------------------------
-- Procedure registry
-- ---------------------------------------------------------------------------
create table if not exists public.procedure_registry (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  category text not null default 'general',
  status text not null default 'published'
    check (status in ('draft', 'published', 'deprecated', 'disabled')),
  current_version integer not null default 1,
  trust_level text not null default 'core'
    check (trust_level in ('core', 'verified', 'workspace', 'generated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.procedure_versions (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.procedure_registry(id) on delete cascade,
  version integer not null,
  executor_key text not null,
  runtime text not null default 'node'
    check (runtime in ('node', 'worker')),
  manifest jsonb not null,
  input_schema jsonb not null default '{}'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  checksum text not null,
  created_at timestamptz not null default now(),
  unique (procedure_id, version),
  unique (procedure_id, checksum)
);

create table if not exists public.procedure_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  procedure_version_id uuid not null references public.procedure_versions(id),
  brain_run_id text,
  brain_step_id text,
  playbook_run_id uuid references public.playbook_runs(id) on delete set null,
  playbook_run_step_id uuid references public.playbook_run_steps(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  input_hash text not null,
  output_payload jsonb,
  output_file_ids uuid[] not null default '{}'::uuid[],
  duration_ms integer,
  compute_units numeric,
  cost_usd numeric,
  work_hours numeric,
  idempotency_key text not null,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, idempotency_key)
);

create index if not exists idx_procedure_executions_workspace
  on public.procedure_executions (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Artifact exports / provenance / reviews
-- ---------------------------------------------------------------------------
create table if not exists public.artifact_exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  artifact_version_id uuid not null references public.artifact_versions(id) on delete cascade,
  format text not null
    check (format in ('docx', 'pptx', 'xlsx', 'pdf', 'html', 'markdown', 'csv')),
  mime_type text,
  storage_path text,
  preview_storage_path text,
  thumbnail_storage_paths text[] not null default '{}'::text[],
  renderer_key text not null,
  renderer_version text not null,
  template_version_id uuid,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  file_size_bytes bigint,
  checksum text,
  page_or_slide_count integer,
  validation_results jsonb,
  duration_ms integer,
  compute_cost_usd numeric,
  work_hours numeric,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, idempotency_key)
);

create index if not exists idx_artifact_exports_artifact
  on public.artifact_exports (artifact_id, created_at desc);

create table if not exists public.artifact_provenance (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  artifact_version_id uuid not null references public.artifact_versions(id) on delete cascade,
  artifact_path text not null,
  source_type text not null,
  source_id text not null,
  source_locator text,
  claim_key text,
  excerpt_hash text,
  confidence numeric(4,3),
  created_at timestamptz not null default now()
);

create index if not exists idx_artifact_provenance_version
  on public.artifact_provenance (artifact_version_id);

create table if not exists public.artifact_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  artifact_version_id uuid not null references public.artifact_versions(id) on delete cascade,
  reviewer_type text not null check (reviewer_type in ('human', 'ai', 'system')),
  reviewer_user_id uuid,
  reviewer_employee_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'changes_requested', 'passed', 'approved', 'rejected')),
  findings jsonb not null default '[]'::jsonb,
  score_breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_artifact_reviews_artifact
  on public.artifact_reviews (artifact_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Brand kits
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_brand_kits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_workspace_brand_kits_default
  on public.workspace_brand_kits (workspace_id)
  where is_default;

create table if not exists public.workspace_brand_kit_versions (
  id uuid primary key default gen_random_uuid(),
  brand_kit_id uuid not null references public.workspace_brand_kits(id) on delete cascade,
  version integer not null,
  logo_file_id uuid references public.workspace_files(id) on delete set null,
  color_tokens jsonb not null default '{}'::jsonb,
  typography_tokens jsonb not null default '{}'::jsonb,
  footer_text text,
  document_tokens jsonb not null default '{}'::jsonb,
  presentation_tokens jsonb not null default '{}'::jsonb,
  spreadsheet_tokens jsonb not null default '{}'::jsonb,
  checksum text not null,
  created_at timestamptz not null default now(),
  unique (brand_kit_id, version)
);

alter table public.workspace_brand_kits
  drop constraint if exists workspace_brand_kits_current_version_fk;
alter table public.workspace_brand_kits
  add constraint workspace_brand_kits_current_version_fk
  foreign key (current_version_id) references public.workspace_brand_kit_versions(id);

-- Link artifact current_version after artifact_versions exists
alter table public.artifacts
  drop constraint if exists artifacts_current_version_fk;
alter table public.artifacts
  add constraint artifacts_current_version_fk
  foreign key (current_version_id) references public.artifact_versions(id);

-- Cross-links from playbook_run_steps / findings now that playbook tables exist
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'brain_shared_findings_playbook_run_fk'
  ) then
    alter table public.brain_shared_findings
      add constraint brain_shared_findings_playbook_run_fk
      foreign key (playbook_run_id) references public.playbook_runs(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'brain_shared_findings_playbook_run_step_fk'
  ) then
    alter table public.brain_shared_findings
      add constraint brain_shared_findings_playbook_run_step_fk
      foreign key (playbook_run_step_id) references public.playbook_run_steps(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'artifact_versions_playbook_run_fk'
  ) then
    alter table public.artifact_versions
      add constraint artifact_versions_playbook_run_fk
      foreign key (playbook_run_id) references public.playbook_runs(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Updated_at triggers
-- ---------------------------------------------------------------------------
drop trigger if exists set_playbooks_updated_at on public.playbooks;
create trigger set_playbooks_updated_at
before update on public.playbooks
for each row execute function public.set_updated_at();

drop trigger if exists set_playbook_runs_updated_at on public.playbook_runs;
create trigger set_playbook_runs_updated_at
before update on public.playbook_runs
for each row execute function public.set_updated_at();

drop trigger if exists set_playbook_run_steps_updated_at on public.playbook_run_steps;
create trigger set_playbook_run_steps_updated_at
before update on public.playbook_run_steps
for each row execute function public.set_updated_at();

drop trigger if exists set_procedure_registry_updated_at on public.procedure_registry;
create trigger set_procedure_registry_updated_at
before update on public.procedure_registry
for each row execute function public.set_updated_at();

drop trigger if exists set_workspace_brand_kits_updated_at on public.workspace_brand_kits;
create trigger set_workspace_brand_kits_updated_at
before update on public.workspace_brand_kits
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.playbooks enable row level security;
alter table public.playbook_versions enable row level security;
alter table public.playbook_runs enable row level security;
alter table public.playbook_run_steps enable row level security;
alter table public.procedure_registry enable row level security;
alter table public.procedure_versions enable row level security;
alter table public.procedure_executions enable row level security;
alter table public.artifact_exports enable row level security;
alter table public.artifact_provenance enable row level security;
alter table public.artifact_reviews enable row level security;
alter table public.workspace_brand_kits enable row level security;
alter table public.workspace_brand_kit_versions enable row level security;

-- Playbooks: published platform readable by all authenticated; workspace by members
drop policy if exists playbooks_select on public.playbooks;
create policy playbooks_select on public.playbooks
for select to authenticated
using (
  (visibility = 'platform' and status = 'published')
  or (
    workspace_id is not null
    and public.is_workspace_member(workspace_id)
    and (
      status = 'published'
      or public.is_workspace_admin(workspace_id)
      or created_by_user_id = auth.uid()
    )
  )
);

drop policy if exists playbooks_write_admin on public.playbooks;
create policy playbooks_write_admin on public.playbooks
for all to authenticated
using (
  workspace_id is not null
  and public.is_workspace_admin(workspace_id)
)
with check (
  workspace_id is not null
  and public.is_workspace_admin(workspace_id)
);

drop policy if exists playbook_versions_select on public.playbook_versions;
create policy playbook_versions_select on public.playbook_versions
for select to authenticated
using (
  exists (
    select 1 from public.playbooks p
    where p.id = playbook_id
      and (
        (p.visibility = 'platform' and p.status in ('published', 'deprecated'))
        or (p.workspace_id is not null and public.is_workspace_member(p.workspace_id))
      )
  )
);

drop policy if exists playbook_versions_write_admin on public.playbook_versions;
create policy playbook_versions_write_admin on public.playbook_versions
for insert to authenticated
with check (
  exists (
    select 1 from public.playbooks p
    where p.id = playbook_id
      and p.workspace_id is not null
      and public.is_workspace_admin(p.workspace_id)
  )
);

-- Runs: initiator, room access, or admin of non-DM workspace runs
drop policy if exists playbook_runs_select on public.playbook_runs;
create policy playbook_runs_select on public.playbook_runs
for select to authenticated
using (
  public.is_workspace_member(workspace_id)
  and (
    initiated_by_user_id = auth.uid()
    or (
      room_id is not null
      and public.can_access_room_row(workspace_id, room_id)
    )
  )
);

drop policy if exists playbook_runs_insert on public.playbook_runs;
create policy playbook_runs_insert on public.playbook_runs
for insert to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and initiated_by_user_id = auth.uid()
  and (
    room_id is null
    or public.can_access_room_row(workspace_id, room_id)
  )
);

drop policy if exists playbook_runs_update on public.playbook_runs;
create policy playbook_runs_update on public.playbook_runs
for update to authenticated
using (
  public.is_workspace_member(workspace_id)
  and (
    initiated_by_user_id = auth.uid()
    or public.is_workspace_admin(workspace_id)
  )
)
with check (
  public.is_workspace_member(workspace_id)
);

drop policy if exists playbook_run_steps_select on public.playbook_run_steps;
create policy playbook_run_steps_select on public.playbook_run_steps
for select to authenticated
using (
  exists (
    select 1 from public.playbook_runs r
    where r.id = playbook_run_id
      and public.is_workspace_member(r.workspace_id)
      and (
        r.initiated_by_user_id = auth.uid()
        or (r.room_id is not null and public.can_access_room_row(r.workspace_id, r.room_id))
      )
  )
);

-- Procedure registry: readable by authenticated; writes are service-role only
drop policy if exists procedure_registry_select on public.procedure_registry;
create policy procedure_registry_select on public.procedure_registry
for select to authenticated
using (status in ('published', 'deprecated'));

drop policy if exists procedure_versions_select on public.procedure_versions;
create policy procedure_versions_select on public.procedure_versions
for select to authenticated
using (
  exists (
    select 1 from public.procedure_registry p
    where p.id = procedure_id and p.status in ('published', 'deprecated')
  )
);

drop policy if exists procedure_executions_select on public.procedure_executions;
create policy procedure_executions_select on public.procedure_executions
for select to authenticated
using (
  public.is_workspace_member(workspace_id)
  and (
    public.is_workspace_admin(workspace_id)
    or exists (
      select 1 from public.playbook_runs r
      where r.id = playbook_run_id
        and r.initiated_by_user_id = auth.uid()
    )
  )
);

-- Artifact exports / provenance / reviews inherit workspace membership + room via artifact
drop policy if exists artifact_exports_select on public.artifact_exports;
create policy artifact_exports_select on public.artifact_exports
for select to authenticated
using (
  public.is_workspace_member(workspace_id)
  and exists (
    select 1 from public.artifacts a
    where a.id = artifact_id
      and a.workspace_id = workspace_id
      and (
        a.room_id is null
        or public.can_access_room_row(a.workspace_id, a.room_id)
      )
  )
);

drop policy if exists artifact_provenance_select on public.artifact_provenance;
create policy artifact_provenance_select on public.artifact_provenance
for select to authenticated
using (
  public.is_workspace_member(workspace_id)
  and exists (
    select 1
    from public.artifact_versions av
    join public.artifacts a on a.id = av.artifact_id
    where av.id = artifact_version_id
      and a.workspace_id = workspace_id
      and (
        a.room_id is null
        or public.can_access_room_row(a.workspace_id, a.room_id)
      )
  )
);

drop policy if exists artifact_reviews_select on public.artifact_reviews;
create policy artifact_reviews_select on public.artifact_reviews
for select to authenticated
using (
  public.is_workspace_member(workspace_id)
  and exists (
    select 1 from public.artifacts a
    where a.id = artifact_id
      and a.workspace_id = workspace_id
      and (
        a.room_id is null
        or public.can_access_room_row(a.workspace_id, a.room_id)
      )
  )
);

drop policy if exists workspace_brand_kits_select on public.workspace_brand_kits;
create policy workspace_brand_kits_select on public.workspace_brand_kits
for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_brand_kits_write on public.workspace_brand_kits;
create policy workspace_brand_kits_write on public.workspace_brand_kits
for all to authenticated
using (public.is_workspace_admin(workspace_id))
with check (public.is_workspace_admin(workspace_id));

drop policy if exists workspace_brand_kit_versions_select on public.workspace_brand_kit_versions;
create policy workspace_brand_kit_versions_select on public.workspace_brand_kit_versions
for select to authenticated
using (
  exists (
    select 1 from public.workspace_brand_kits k
    where k.id = brand_kit_id and public.is_workspace_member(k.workspace_id)
  )
);

drop policy if exists workspace_brand_kit_versions_write on public.workspace_brand_kit_versions;
create policy workspace_brand_kit_versions_write on public.workspace_brand_kit_versions
for insert to authenticated
with check (
  exists (
    select 1 from public.workspace_brand_kits k
    where k.id = brand_kit_id and public.is_workspace_admin(k.workspace_id)
  )
);

comment on table public.playbooks is
  'PR-25 reusable business playbooks. platform rows have workspace_id null.';
comment on table public.playbook_runs is
  'PR-25 business wrapper around one brain_run. Private DM room scope is enforced via can_access_room_row.';
comment on table public.procedure_registry is
  'PR-25 trusted procedure backpack. Customers never invoke arbitrary executors.';
comment on table public.artifact_exports is
  'PR-25 deterministic export jobs for canonical artifact versions.';
