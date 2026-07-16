-- PR-16: image artifacts (Drive-backed generation / edit workflows).

alter table public.artifacts
  drop constraint if exists artifacts_artifact_type_check;

alter table public.artifacts
  add constraint artifacts_artifact_type_check
  check (artifact_type in (
    'prd', 'report', 'brief', 'research_summary', 'meeting_notes',
    'strategy_memo', 'email_draft', 'proposal', 'checklist', 'decision',
    'note', 'other', 'image'
  ));
