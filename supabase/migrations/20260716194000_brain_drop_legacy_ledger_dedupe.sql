-- AdeHQ Brain PR-10: writers use idempotency_key; drop legacy (work_unit_id, source_type) unique index.

drop index if exists public.uq_ai_cost_ledger_work_unit_source;
