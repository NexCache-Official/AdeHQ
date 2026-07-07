-- Phase 2.5 — AdeHQ Artifact Engine metadata.
-- Keeps generated files auditable from tool run -> async job -> artifact -> Drive export.

alter table public.integration_tool_runs
  add column if not exists trigger_message_id text;

create index if not exists idx_integration_tool_runs_trigger_message
  on public.integration_tool_runs (workspace_id, trigger_message_id)
  where trigger_message_id is not null;

create table if not exists public.artifact_templates (
  id text primary key,
  name text not null,
  artifact_kind text not null,
  description text null,
  schema_json jsonb not null default '{}'::jsonb,
  engine text not null default 'adehq',
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.artifact_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  integration_tool_run_id uuid null references public.integration_tool_runs(id) on delete set null,
  integration_job_id uuid null references public.integration_jobs(id) on delete set null,
  artifact_id text null,
  drive_export_id uuid null references public.drive_exports(id) on delete set null,
  tool_name text not null,
  template_id text null references public.artifact_templates(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'success', 'failed')),
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb null,
  error_message text null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists idx_artifact_runs_workspace_created
  on public.artifact_runs (workspace_id, created_at desc);

create index if not exists idx_artifact_runs_tool_run
  on public.artifact_runs (integration_tool_run_id)
  where integration_tool_run_id is not null;

create index if not exists idx_artifact_runs_artifact
  on public.artifact_runs (workspace_id, artifact_id)
  where artifact_id is not null;

drop trigger if exists set_artifact_templates_updated_at on public.artifact_templates;
create trigger set_artifact_templates_updated_at
before update on public.artifact_templates
for each row execute function public.set_updated_at();

alter table public.artifact_templates enable row level security;
alter table public.artifact_runs enable row level security;

drop policy if exists "artifact_templates_member_read" on public.artifact_templates;
create policy "artifact_templates_member_read"
on public.artifact_templates for select
using (true);

drop policy if exists "artifact_runs_member" on public.artifact_runs;
create policy "artifact_runs_member"
on public.artifact_runs for all
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

insert into public.artifact_templates (id, name, artifact_kind, description, schema_json, engine)
values
  ('sales_pipeline', 'Sales Pipeline Workbook', 'spreadsheet', 'CRM pipeline workbook with frozen headers and metadata.', '{"columns":["Company","Contact","Stage","Amount","Currency","Expected Close","Notes"]}'::jsonb, 'exceljs'),
  ('investor_target', 'Investor Target Workbook', 'spreadsheet', 'Investor target list and scoring workbook.', '{"columns":["Firm","Contact","Stage","Fit Score","Target Amount","Currency","Next Follow-up","Notes"]}'::jsonb, 'exceljs'),
  ('content_calendar', 'Content Calendar Workbook', 'spreadsheet', 'Campaign and post schedule workbook.', '{"columns":["Title","Platform","Status","Scheduled At","Campaign","Body Preview"]}'::jsonb, 'exceljs'),
  ('market_research', 'Market Research Workbook', 'spreadsheet', 'Research comparison workbook.', '{"columns":["Option","Category","Strengths","Weaknesses","Price","Source","Notes"]}'::jsonb, 'exceljs'),
  ('campaign_brief', 'Campaign Brief PDF', 'pdf', 'Marketing campaign brief rendered with HTML/PDF.', '{}'::jsonb, 'playwright'),
  ('investor_brief', 'Investor Brief PDF', 'pdf', 'Fundraising brief rendered with HTML/PDF.', '{}'::jsonb, 'playwright'),
  ('market_research_report', 'Market Research Report PDF', 'pdf', 'Research report rendered with HTML/PDF.', '{}'::jsonb, 'playwright'),
  ('sales_outreach_brief', 'Sales Outreach Brief', 'document', 'Sales outreach brief for PDF/DOCX generation.', '{}'::jsonb, 'docx')
on conflict (id) do update set
  name = excluded.name,
  artifact_kind = excluded.artifact_kind,
  description = excluded.description,
  schema_json = excluded.schema_json,
  engine = excluded.engine,
  status = 'active',
  updated_at = now();
