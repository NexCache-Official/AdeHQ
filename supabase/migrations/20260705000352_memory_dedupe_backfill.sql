-- Backfill null dedupe_key on active memory rows so dedupe lookups can succeed.
-- Legacy rows get a stable id-based key; new saves use content-based keys from the app.
update public.memory_entries
set dedupe_key = workspace_id || '|legacy|' || id
where dedupe_key is null
  and deleted_at is null;
