-- AdeHQ Brain PR-7: optional message metadata for WH receipts (and other Brain stamps).

alter table public.messages
  add column if not exists metadata jsonb not null default '{}'::jsonb;
