-- V19.6.9 — memory archive / soft-delete support
alter table public.memory_entries
  add column if not exists deleted_at timestamptz;

create index if not exists memory_entries_active_idx
  on public.memory_entries (workspace_id, created_at desc)
  where deleted_at is null and status not in ('archived', 'superseded');
