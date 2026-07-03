-- V19.6.8: persist memory suggestion lifecycle (saved/dismissed) per topic summary
alter table public.topic_summaries
  add column if not exists memory_suggestion_lifecycle jsonb not null default '{}'::jsonb;
