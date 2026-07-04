-- V20.0.1 — Browser Research Tavily provider (additive)
-- Extends provider values to mock | tavily. No live browser browsing.

alter table public.browser_research_runs
  drop constraint if exists browser_research_runs_provider_check;

alter table public.browser_research_runs
  add constraint browser_research_runs_provider_check
  check (provider in ('mock', 'tavily'));

comment on column public.browser_research_runs.provider is
  'Research provider: mock (simulated) or tavily (real web search snippets). Live page browsing is V20.0.2+.';
