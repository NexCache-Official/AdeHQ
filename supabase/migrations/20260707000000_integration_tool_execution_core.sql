-- Integration Layer Phase 1 — Tool Execution Core.
-- Auditable tool runs, async jobs, approval action payloads, and the minimal
-- CRM tables backing the Sales vertical slice (contact → deal → draft → task).

-- ---------------------------------------------------------------------------
-- integration_tool_runs — every preview/execute tool call, with cost metadata
-- ---------------------------------------------------------------------------

create table if not exists public.integration_tool_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id text not null,
  requested_by_user_id uuid null,

  room_id text null,
  topic_id text null,
  agent_run_id text null,

  capability_domain text not null,
  tool_name text not null,
  provider text not null default 'adehq',
  connection_id uuid null,
  approval_id text null,
  job_id uuid null,

  mode text not null check (mode in ('preview', 'execute')),
  idempotency_key text null,

  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb null,
  preview_snapshot jsonb null,

  status text not null default 'pending'
    check (status in ('pending', 'running', 'success', 'failed', 'blocked')),
  external_object_id text null,
  external_url text null,

  cost_usd numeric(12,6) not null default 0,
  work_minutes numeric(12,4) not null default 0,

  error_message text null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists idx_integration_tool_runs_workspace_created
  on public.integration_tool_runs (workspace_id, created_at desc);
create index if not exists idx_integration_tool_runs_employee
  on public.integration_tool_runs (workspace_id, employee_id, created_at desc);
create index if not exists idx_integration_tool_runs_approval
  on public.integration_tool_runs (workspace_id, approval_id)
  where approval_id is not null;
create index if not exists idx_integration_tool_runs_tool
  on public.integration_tool_runs (workspace_id, tool_name, created_at desc);

-- Idempotency: at most one successful run per key. Failed runs may be retried.
create unique index if not exists uq_integration_tool_runs_idempotency_success
  on public.integration_tool_runs (workspace_id, idempotency_key)
  where idempotency_key is not null and status = 'success';

-- ---------------------------------------------------------------------------
-- integration_jobs — async work (artifact generation, imports, syncs, retries)
-- ---------------------------------------------------------------------------

create table if not exists public.integration_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_id text null,
  job_type text not null,
  tool_run_id uuid null references public.integration_tool_runs(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'success', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb null,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_integration_jobs_workspace_status
  on public.integration_jobs (workspace_id, status, scheduled_at);
create index if not exists idx_integration_jobs_tool_run
  on public.integration_jobs (tool_run_id)
  where tool_run_id is not null;

drop trigger if exists set_integration_jobs_updated_at on public.integration_jobs;
create trigger set_integration_jobs_updated_at
before update on public.integration_jobs
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- approvals — action payloads so approving actually executes
-- ---------------------------------------------------------------------------

alter table public.approvals add column if not exists action_payload jsonb;
alter table public.approvals add column if not exists preview_snapshot jsonb;
alter table public.approvals add column if not exists revision_count integer not null default 0;
alter table public.approvals add column if not exists resolved_by uuid null;
alter table public.approvals add column if not exists resolution_note text null;
alter table public.approvals add column if not exists executed_tool_run_id uuid null;

-- ---------------------------------------------------------------------------
-- CRM Lite tables — minimal schema for the Sales vertical slice
-- ---------------------------------------------------------------------------

create table if not exists public.crm_companies (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  name text not null,
  domain text null,
  industry text null,
  notes text null,
  source text null,
  created_by_type text not null default 'ai' check (created_by_type in ('human', 'ai', 'system')),
  created_by_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists public.crm_contacts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  first_name text not null,
  last_name text null,
  full_name text not null,
  email text null,
  phone text null,
  title text null,
  company_id text null,
  company_name text null,
  notes text null,
  source text null,
  owner_employee_id text null,
  created_by_type text not null default 'ai' check (created_by_type in ('human', 'ai', 'system')),
  created_by_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, company_id)
    references public.crm_companies(workspace_id, id)
    on delete set null
);

create table if not exists public.crm_pipeline_stages (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  name text not null,
  sort_order integer not null default 0,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, name)
);

create table if not exists public.crm_deals (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  name text not null,
  amount numeric(14,2) null,
  currency text not null default 'USD',
  stage_id text null,
  stage_name text not null default 'Lead',
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  contact_id text null,
  company_id text null,
  expected_close_date date null,
  notes text null,
  owner_employee_id text null,
  created_by_type text not null default 'ai' check (created_by_type in ('human', 'ai', 'system')),
  created_by_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, stage_id)
    references public.crm_pipeline_stages(workspace_id, id)
    on delete set null,
  foreign key (workspace_id, contact_id)
    references public.crm_contacts(workspace_id, id)
    on delete set null,
  foreign key (workspace_id, company_id)
    references public.crm_companies(workspace_id, id)
    on delete set null
);

create table if not exists public.crm_tasks (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  title text not null,
  description text null,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  due_date timestamptz null,
  contact_id text null,
  company_id text null,
  deal_id text null,
  assignee_employee_id text null,
  created_by_type text not null default 'ai' check (created_by_type in ('human', 'ai', 'system')),
  created_by_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, contact_id)
    references public.crm_contacts(workspace_id, id)
    on delete set null,
  foreign key (workspace_id, company_id)
    references public.crm_companies(workspace_id, id)
    on delete set null,
  foreign key (workspace_id, deal_id)
    references public.crm_deals(workspace_id, id)
    on delete set null
);

create index if not exists idx_crm_contacts_workspace_created
  on public.crm_contacts (workspace_id, created_at desc);
create index if not exists idx_crm_contacts_email
  on public.crm_contacts (workspace_id, lower(email))
  where email is not null;
create index if not exists idx_crm_deals_workspace_created
  on public.crm_deals (workspace_id, created_at desc);
create index if not exists idx_crm_deals_stage
  on public.crm_deals (workspace_id, stage_name);
create index if not exists idx_crm_tasks_workspace
  on public.crm_tasks (workspace_id, status, due_date);

drop trigger if exists set_crm_companies_updated_at on public.crm_companies;
create trigger set_crm_companies_updated_at
before update on public.crm_companies
for each row execute function public.set_updated_at();

drop trigger if exists set_crm_contacts_updated_at on public.crm_contacts;
create trigger set_crm_contacts_updated_at
before update on public.crm_contacts
for each row execute function public.set_updated_at();

drop trigger if exists set_crm_deals_updated_at on public.crm_deals;
create trigger set_crm_deals_updated_at
before update on public.crm_deals
for each row execute function public.set_updated_at();

drop trigger if exists set_crm_tasks_updated_at on public.crm_tasks;
create trigger set_crm_tasks_updated_at
before update on public.crm_tasks
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.integration_tool_runs enable row level security;
alter table public.integration_jobs enable row level security;
alter table public.crm_companies enable row level security;
alter table public.crm_contacts enable row level security;
alter table public.crm_pipeline_stages enable row level security;
alter table public.crm_deals enable row level security;
alter table public.crm_tasks enable row level security;

drop policy if exists "integration_tool_runs_select_member" on public.integration_tool_runs;
create policy "integration_tool_runs_select_member"
on public.integration_tool_runs for select
using (public.is_workspace_member(workspace_id));

drop policy if exists "integration_tool_runs_insert_member" on public.integration_tool_runs;
create policy "integration_tool_runs_insert_member"
on public.integration_tool_runs for insert
with check (public.is_workspace_member(workspace_id));

drop policy if exists "integration_tool_runs_update_member" on public.integration_tool_runs;
create policy "integration_tool_runs_update_member"
on public.integration_tool_runs for update
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "integration_jobs_all_member" on public.integration_jobs;
create policy "integration_jobs_all_member"
on public.integration_jobs for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "crm_companies_all_member" on public.crm_companies;
create policy "crm_companies_all_member"
on public.crm_companies for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "crm_contacts_all_member" on public.crm_contacts;
create policy "crm_contacts_all_member"
on public.crm_contacts for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "crm_pipeline_stages_all_member" on public.crm_pipeline_stages;
create policy "crm_pipeline_stages_all_member"
on public.crm_pipeline_stages for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "crm_deals_all_member" on public.crm_deals;
create policy "crm_deals_all_member"
on public.crm_deals for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "crm_tasks_all_member" on public.crm_tasks;
create policy "crm_tasks_all_member"
on public.crm_tasks for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Internal AdeHQ capability tools — catalog rows for employee grants.
-- These are always-available internal providers (no OAuth needed).
-- ---------------------------------------------------------------------------

insert into public.tools (id, name, category, description, status)
values
  ('adehq-crm', 'AdeHQ CRM', 'Business', 'Create and manage contacts, companies, and deals inside AdeHQ.', 'connected'),
  ('adehq-email', 'AdeHQ Email Drafts', 'Communication', 'Draft outreach and follow-up emails as reviewable artifacts.', 'connected'),
  ('adehq-tasks', 'AdeHQ Tasks', 'Productivity', 'Create and manage follow-up tasks inside AdeHQ.', 'connected'),
  ('adehq-drive', 'AdeHQ Drive', 'Storage', 'Save generated files and artifacts to workspace Drive.', 'connected')
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  status = excluded.status;
