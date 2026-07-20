-- PR-18.1 Realtime Brain Calls V1.
-- Existing demo call rows remain readable; new live sessions use the expanded
-- generic conversation envelope and durable turn/usage tables.

alter table public.calls
  add column if not exists conversation_type text not null default 'human_ai_dm',
  add column if not exists conversation_id text,
  add column if not exists initiator_user_id uuid references auth.users(id) on delete set null,
  add column if not exists primary_employee_id text,
  add column if not exists participant_ids jsonb not null default '[]'::jsonb,
  add column if not exists permission_version integer not null default 1,
  add column if not exists stt_mode text not null default 'fast_turn',
  add column if not exists voice_route_policy text not null default 'standard',
  add column if not exists session_state text not null default 'ended',
  add column if not exists estimated_wh numeric(14,6) not null default 0,
  add column if not exists settled_wh numeric(14,6) not null default 0,
  add column if not exists last_activity_at timestamptz not null default now(),
  add column if not exists reconnect_expires_at timestamptz,
  add column if not exists recording_consent_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.calls
set conversation_id = room_id
where conversation_id is null;

alter table public.calls
  alter column conversation_id set not null;

alter table public.calls drop constraint if exists calls_conversation_type_check;
alter table public.calls add constraint calls_conversation_type_check
  check (conversation_type in ('human_ai_dm', 'room', 'topic'));
alter table public.calls drop constraint if exists calls_stt_mode_check;
alter table public.calls add constraint calls_stt_mode_check
  check (stt_mode in ('fast_turn', 'live_streaming'));
alter table public.calls drop constraint if exists calls_session_state_check;
alter table public.calls add constraint calls_session_state_check
  check (session_state in ('connecting', 'active', 'reconnecting', 'ending', 'ended', 'failed'));

create table if not exists public.call_turns (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  call_id text not null,
  sequence integer not null check (sequence >= 0),
  idempotency_key text not null,
  state text not null default 'listening'
    check (state in (
      'listening','transcribing','thinking','using_tools','synthesizing',
      'speaking','interrupted','completed','failed'
    )),
  human_transcript text not null default '',
  employee_transcript text not null default '',
  spoken_text text not null default '',
  unspoken_text text not null default '',
  interrupted boolean not null default false,
  interrupted_at_character integer,
  stt_route_id text,
  tts_route_id text,
  agent_run_id text,
  brain_run_id uuid,
  stt_wh numeric(14,6) not null default 0,
  brain_wh numeric(14,6) not null default 0,
  tts_wh numeric(14,6) not null default 0,
  estimated_wh numeric(14,6) not null default 0,
  reserved_wh numeric(14,6) not null default 0,
  settled_wh numeric(14,6) not null default 0,
  human_started_at timestamptz,
  human_ended_at timestamptz,
  first_transcript_at timestamptz,
  brain_started_at timestamptz,
  first_text_token_at timestamptz,
  first_audio_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, call_id, sequence),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, call_id)
    references public.calls(workspace_id, id) on delete cascade
);

create table if not exists public.call_usage_settlements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  call_id text not null,
  turn_id text not null,
  component text not null check (component in ('stt','brain','tts')),
  idempotency_key text not null,
  route_id text,
  estimated_wh numeric(14,6) not null default 0,
  reserved_wh numeric(14,6) not null default 0,
  actual_wh numeric(14,6) not null default 0,
  customer_charged_wh numeric(14,6) not null default 0,
  outcome text not null check (outcome in (
    'success','partial','failed_provider_billed','failed_unbilled','cancelled'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  settled_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, call_id)
    references public.calls(workspace_id, id) on delete cascade,
  foreign key (workspace_id, turn_id)
    references public.call_turns(workspace_id, id) on delete cascade
);

create index if not exists idx_calls_workspace_state_activity
  on public.calls(workspace_id, session_state, last_activity_at desc);
create index if not exists idx_calls_initiator_active
  on public.calls(workspace_id, initiator_user_id, session_state);
create index if not exists idx_call_turns_call_sequence
  on public.call_turns(workspace_id, call_id, sequence);
create index if not exists idx_call_usage_turn
  on public.call_usage_settlements(workspace_id, turn_id, component);

alter table public.call_turns enable row level security;
alter table public.call_usage_settlements enable row level security;

drop policy if exists "calls_all_member" on public.calls;
create policy "calls_scoped_member"
on public.calls for all
using (public.can_access_room_row(workspace_id, room_id))
with check (public.can_access_room_row(workspace_id, room_id));

drop policy if exists "call_transcripts_all_member" on public.call_transcripts;
create policy "call_transcripts_scoped_member"
on public.call_transcripts for all
using (
  exists (
    select 1 from public.calls c
    where c.workspace_id = call_transcripts.workspace_id
      and c.id = call_transcripts.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  )
)
with check (
  exists (
    select 1 from public.calls c
    where c.workspace_id = call_transcripts.workspace_id
      and c.id = call_transcripts.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  )
);

create policy "call_turns_scoped_member"
on public.call_turns for all
using (
  exists (
    select 1 from public.calls c
    where c.workspace_id = call_turns.workspace_id
      and c.id = call_turns.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  )
)
with check (
  exists (
    select 1 from public.calls c
    where c.workspace_id = call_turns.workspace_id
      and c.id = call_turns.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  )
);

create policy "call_usage_scoped_member"
on public.call_usage_settlements for select
using (
  exists (
    select 1 from public.calls c
    where c.workspace_id = call_usage_settlements.workspace_id
      and c.id = call_usage_settlements.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  )
);

revoke insert, update, delete on public.call_usage_settlements from anon, authenticated;
