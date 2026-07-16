-- AdeHQ Brain PR-2: extend commercial ledger for multi-step metering + snapshots.

alter table public.ai_cost_ledger_entries
  add column if not exists pricing_snapshot_id text null,
  add column if not exists idempotency_key text null,
  add column if not exists image_count integer not null default 0,
  add column if not exists video_count integer not null default 0,
  add column if not exists tts_utf8_bytes integer not null default 0,
  add column if not exists brain_run_id text null,
  add column if not exists decision_attempt_id text null,
  add column if not exists packet_version text null,
  add column if not exists decision_version text null,
  add column if not exists router_version text null,
  add column if not exists catalog_version text null;

-- Allow cost_source = token_rates (computed from real units × snapshot rates).
alter table public.ai_cost_ledger_entries
  drop constraint if exists ai_cost_ledger_entries_cost_source_check;

-- No check constraint historically — document allowed values in app types.
-- Unique idempotency for multi-step runs (defect A).
create unique index if not exists uq_ledger_idempotency
  on public.ai_cost_ledger_entries (idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_ai_cost_ledger_brain_run
  on public.ai_cost_ledger_entries (brain_run_id)
  where brain_run_id is not null;

create index if not exists idx_ai_cost_ledger_pricing_snapshot
  on public.ai_cost_ledger_entries (pricing_snapshot_id)
  where pricing_snapshot_id is not null;

-- Tag legacy rows so queries never special-case NULL snapshot.
update public.ai_cost_ledger_entries
set pricing_snapshot_id = 'ps_legacy_unknown'
where pricing_snapshot_id is null;
