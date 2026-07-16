-- PR-17: video artifacts + cancellable async jobs.

alter table public.artifacts
  drop constraint if exists artifacts_artifact_type_check;

alter table public.artifacts
  add constraint artifacts_artifact_type_check
  check (artifact_type in (
    'prd', 'report', 'brief', 'research_summary', 'meeting_notes',
    'strategy_memo', 'email_draft', 'proposal', 'checklist', 'decision',
    'note', 'other', 'image', 'video'
  ));

alter table public.integration_jobs
  drop constraint if exists integration_jobs_status_check;

alter table public.integration_jobs
  add constraint integration_jobs_status_check
  check (status in ('queued', 'running', 'success', 'failed', 'cancelled'));
