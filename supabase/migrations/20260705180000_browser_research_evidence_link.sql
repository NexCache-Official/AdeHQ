-- V20.0.3 — Link browser_evidence to browser_research_runs (additive)

alter table public.browser_evidence
  add column if not exists browser_research_run_id text null;

create index if not exists idx_browser_evidence_research_run
  on public.browser_evidence (browser_research_run_id)
  where browser_research_run_id is not null;

comment on column public.browser_evidence.browser_research_run_id is
  'Optional link to the browser_research_runs row that captured this evidence (V20.0.3+).';
