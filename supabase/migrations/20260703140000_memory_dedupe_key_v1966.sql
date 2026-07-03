-- V19.6.6: deterministic memory deduplication key
alter table public.memory_entries
  add column if not exists dedupe_key text;

create unique index if not exists memory_entries_workspace_dedupe_key_uidx
  on public.memory_entries (workspace_id, dedupe_key)
  where dedupe_key is not null;
