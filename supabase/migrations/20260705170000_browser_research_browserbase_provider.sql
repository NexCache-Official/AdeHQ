-- V20.0.2 — Browser Research Browserbase live provider (additive)
-- Extends provider values to mock | tavily | browserbase.

alter table public.browser_research_runs
  drop constraint if exists browser_research_runs_provider_check;

alter table public.browser_research_runs
  add constraint browser_research_runs_provider_check
  check (provider in ('mock', 'tavily', 'browserbase'));

comment on column public.browser_research_runs.provider is
  'Research provider: mock (simulated), tavily (search snippets), or browserbase (live browse when enabled).';
