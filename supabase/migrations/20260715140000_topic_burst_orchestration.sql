-- Burst orchestration lock + consumed human message ids (typing pause / multi-human batch)

alter table public.topic_orchestration_state
  add column if not exists burst_consumed_message_ids text[] not null default '{}',
  add column if not exists burst_lock_token text,
  add column if not exists burst_lock_until timestamptz;

comment on column public.topic_orchestration_state.burst_consumed_message_ids is
  'Human message ids already included in a flushed orchestration burst.';
comment on column public.topic_orchestration_state.burst_lock_token is
  'Ephemeral lock token so only one client flush orchestrates a burst.';
comment on column public.topic_orchestration_state.burst_lock_until is
  'When the burst lock expires if the holder crashes.';
