-- V19.6.7: enriched memory model for categorization, attribution, and source linking
alter table public.memory_entries
  add column if not exists category text,
  add column if not exists scope text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists source_type text,
  add column if not exists source_message_id text,
  add column if not exists source_employee_id text,
  add column if not exists suggested_by_type text,
  add column if not exists suggested_by_id text,
  add column if not exists saved_by_user_id text,
  add column if not exists confidence real;

create index if not exists memory_entries_category_idx
  on public.memory_entries (workspace_id, category)
  where category is not null;

create index if not exists memory_entries_scope_idx
  on public.memory_entries (workspace_id, scope)
  where scope is not null;
