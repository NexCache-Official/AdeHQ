-- PR-18.2A-G: canonical human/hybrid call domain.
-- Existing `calls` and `call_turns` remain the AI voice compatibility model.

create table if not exists public.call_sessions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  room_id text not null,
  kind text not null check (kind in ('human_human','human_ai','group','hybrid')),
  status text not null default 'ringing'
    check (status in ('ringing','connecting','active','reconnecting','declined','missed','cancelled','ended','failed')),
  privacy_mode text not null default 'human_private'
    check (privacy_mode in ('human_private','ai_assisted','recorded_work_session')),
  title text not null default 'Call',
  created_by uuid references auth.users(id) on delete set null,
  idempotency_key text not null,
  audio_enabled boolean not null default true,
  video_enabled boolean not null default false,
  screen_share_enabled boolean not null default false,
  participant_limit integer not null default 2 check (participant_limit between 2 and 100),
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  last_activity_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id) on delete cascade
);

create table if not exists public.call_participants (
  workspace_id uuid not null,
  id text not null,
  call_id text not null,
  participant_type text not null check (participant_type in ('human','ai_employee')),
  user_id uuid references auth.users(id) on delete cascade,
  employee_id text,
  role text not null default 'participant' check (role in ('host','participant','observer')),
  participation_mode text check (participation_mode in ('silent_observer','on_request','advisor','facilitator','active')),
  state text not null default 'invited'
    check (state in ('invited','ringing','accepted','joining','joined','left','declined','missed','removed')),
  device_id text,
  joined_at timestamptz,
  left_at timestamptz,
  mute_state boolean not null default false,
  camera_state boolean not null default false,
  provider_session_id text,
  published_tracks jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, call_id)
    references public.call_sessions(workspace_id, id) on delete cascade,
  check (
    (participant_type = 'human' and user_id is not null and employee_id is null)
    or (participant_type = 'ai_employee' and employee_id is not null and user_id is null)
  )
);

create unique index if not exists idx_call_participants_human
  on public.call_participants(workspace_id, call_id, user_id)
  where user_id is not null;
create unique index if not exists idx_call_participants_ai
  on public.call_participants(workspace_id, call_id, employee_id)
  where employee_id is not null;

create table if not exists public.call_invitations (
  workspace_id uuid not null,
  id text not null,
  call_id text not null,
  inviter_user_id uuid references auth.users(id) on delete set null,
  invitee_user_id uuid references auth.users(id) on delete cascade,
  invitee_employee_id text,
  status text not null default 'pending'
    check (status in ('pending','accepted','declined','missed','cancelled','answered_elsewhere','expired')),
  accepted_device_id text,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, call_id)
    references public.call_sessions(workspace_id, id) on delete cascade,
  check (
    (invitee_user_id is not null and invitee_employee_id is null)
    or (invitee_user_id is null and invitee_employee_id is not null)
  )
);

create unique index if not exists idx_call_invitation_human
  on public.call_invitations(workspace_id, call_id, invitee_user_id)
  where invitee_user_id is not null;
create unique index if not exists idx_call_invitation_ai
  on public.call_invitations(workspace_id, call_id, invitee_employee_id)
  where invitee_employee_id is not null;

create table if not exists public.call_participant_leases (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  call_id text not null,
  participant_id text not null,
  device_id text not null,
  heartbeat_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  foreign key (workspace_id, call_id)
    references public.call_sessions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, participant_id)
    references public.call_participants(workspace_id, id) on delete cascade
);

create table if not exists public.call_media_sessions (
  workspace_id uuid not null,
  id text not null,
  call_id text not null,
  participant_id text,
  topology text not null check (topology in ('p2p','sfu')),
  backend text not null check (backend in ('cloudflare_sfu','cloudflare_realtimekit','custom_webrtc','brain_voice')),
  relay_policy text not null default 'automatic' check (relay_policy in ('automatic','force_relay')),
  provider_session_id text,
  published_tracks jsonb not null default '[]'::jsonb,
  transition_reason text check (transition_reason in ('group_join','ai_join','recording','network_failure')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  primary key (workspace_id, id),
  foreign key (workspace_id, call_id)
    references public.call_sessions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, participant_id)
    references public.call_participants(workspace_id, id) on delete set null
);

create table if not exists public.call_events (
  workspace_id uuid not null,
  id text not null,
  call_id text not null,
  event_type text not null,
  actor_type text not null default 'system' check (actor_type in ('human','ai_employee','system')),
  actor_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, call_id)
    references public.call_sessions(workspace_id, id) on delete cascade
);

create table if not exists public.call_consents (
  workspace_id uuid not null,
  id text not null,
  call_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null check (consent_type in ('ai_listening','transcription','recording')),
  granted boolean not null,
  retention_policy text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (workspace_id, id),
  unique (workspace_id, call_id, user_id, consent_type),
  foreign key (workspace_id, call_id)
    references public.call_sessions(workspace_id, id) on delete cascade
);

create table if not exists public.call_artifacts (
  workspace_id uuid not null,
  id text not null,
  call_id text not null,
  room_id text not null,
  artifact_type text not null check (artifact_type in ('decision','task','question','risk','approval','artifact','memory','summary','note')),
  visibility text not null default 'shared' check (visibility in ('private','shared')),
  title text not null,
  content text not null default '',
  owner_id text,
  due_at timestamptz,
  source_employee_id text,
  graph_entity_type text,
  graph_entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, call_id)
    references public.call_sessions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, room_id)
    references public.rooms(workspace_id, id) on delete cascade
);

create table if not exists public.call_ai_turns (
  workspace_id uuid not null,
  id text not null,
  call_id text not null,
  employee_id text not null,
  mode text not null default 'on_request'
    check (mode in ('silent_observer','on_request','advisor','facilitator','active')),
  state text not null default 'queued'
    check (state in ('queued','listening','thinking','speaking','completed','interrupted','failed')),
  source_turn_id text,
  transcript text not null default '',
  response text not null default '',
  estimated_wh numeric(14,6) not null default 0,
  settled_wh numeric(14,6) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (workspace_id, id),
  foreign key (workspace_id, call_id)
    references public.call_sessions(workspace_id, id) on delete cascade
);

create table if not exists public.push_subscriptions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled boolean not null default true,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, endpoint)
);

create index if not exists idx_call_sessions_room_created
  on public.call_sessions(workspace_id, room_id, created_at desc);
create index if not exists idx_call_sessions_status_activity
  on public.call_sessions(workspace_id, status, last_activity_at desc);
create index if not exists idx_call_participants_user_state
  on public.call_participants(workspace_id, user_id, state);
create index if not exists idx_call_invitations_user_status
  on public.call_invitations(workspace_id, invitee_user_id, status, expires_at);
create index if not exists idx_call_events_call_created
  on public.call_events(workspace_id, call_id, created_at);
create index if not exists idx_call_artifacts_call_created
  on public.call_artifacts(workspace_id, call_id, created_at);

alter table public.call_sessions enable row level security;
alter table public.call_participants enable row level security;
alter table public.call_invitations enable row level security;
alter table public.call_participant_leases enable row level security;
alter table public.call_media_sessions enable row level security;
alter table public.call_events enable row level security;
alter table public.call_consents enable row level security;
alter table public.call_artifacts enable row level security;
alter table public.call_ai_turns enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "call_sessions_scoped_select" on public.call_sessions for select
  using (public.can_access_room_row(workspace_id, room_id));
create policy "call_participants_scoped_select" on public.call_participants for select
  using (exists (
    select 1 from public.call_sessions c
    where c.workspace_id = call_participants.workspace_id
      and c.id = call_participants.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  ));
create policy "call_invitations_scoped_select" on public.call_invitations for select
  using (exists (
    select 1 from public.call_sessions c
    where c.workspace_id = call_invitations.workspace_id
      and c.id = call_invitations.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  ));
create policy "call_media_sessions_scoped_select" on public.call_media_sessions for select
  using (exists (
    select 1 from public.call_sessions c
    where c.workspace_id = call_media_sessions.workspace_id
      and c.id = call_media_sessions.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  ));
create policy "call_events_scoped_select" on public.call_events for select
  using (exists (
    select 1 from public.call_sessions c
    where c.workspace_id = call_events.workspace_id
      and c.id = call_events.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  ));
create policy "call_consents_scoped_select" on public.call_consents for select
  using (exists (
    select 1 from public.call_sessions c
    where c.workspace_id = call_consents.workspace_id
      and c.id = call_consents.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  ));
create policy "call_artifacts_scoped_select" on public.call_artifacts for select
  using (exists (
    select 1 from public.call_sessions c
    where c.workspace_id = call_artifacts.workspace_id
      and c.id = call_artifacts.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  ));
create policy "call_ai_turns_scoped_select" on public.call_ai_turns for select
  using (exists (
    select 1 from public.call_sessions c
    where c.workspace_id = call_ai_turns.workspace_id
      and c.id = call_ai_turns.call_id
      and public.can_access_room_row(c.workspace_id, c.room_id)
  ));
create policy "own_push_subscriptions_select" on public.push_subscriptions for select
  using (user_id = auth.uid());

revoke insert, update, delete on public.call_sessions from anon, authenticated;
revoke insert, update, delete on public.call_participants from anon, authenticated;
revoke insert, update, delete on public.call_invitations from anon, authenticated;
revoke all on public.call_participant_leases from anon, authenticated;
revoke insert, update, delete on public.call_media_sessions from anon, authenticated;
revoke insert, update, delete on public.call_events from anon, authenticated;
revoke insert, update, delete on public.call_consents from anon, authenticated;
revoke insert, update, delete on public.call_artifacts from anon, authenticated;
revoke insert, update, delete on public.call_ai_turns from anon, authenticated;
revoke insert, update, delete on public.push_subscriptions from anon, authenticated;

-- Backfill an immutable canonical envelope for existing AI calls.
insert into public.call_sessions (
  workspace_id, id, room_id, kind, status, privacy_mode, title, created_by,
  idempotency_key, audio_enabled, video_enabled, started_at, answered_at,
  ended_at, last_activity_at, metadata, created_at, updated_at
)
select
  c.workspace_id, c.id, c.room_id, 'human_ai',
  case c.session_state
    when 'connecting' then 'connecting'
    when 'active' then 'active'
    when 'reconnecting' then 'reconnecting'
    when 'failed' then 'failed'
    else 'ended'
  end,
  case when c.recording_consent_at is null then 'ai_assisted' else 'recorded_work_session' end,
  coalesce(c.title, 'AI call'), c.initiator_user_id, 'legacy:' || c.id,
  true, false, c.started_at, c.started_at, c.ended_at,
  coalesce(c.last_activity_at, c.started_at, now()),
  jsonb_build_object('legacyCallId', c.id), coalesce(c.started_at, now()), coalesce(c.ended_at, c.started_at, now())
from public.calls c
on conflict (workspace_id, id) do nothing;

insert into public.call_participants (
  workspace_id, id, call_id, participant_type, user_id, role, state,
  joined_at, left_at, created_at, updated_at, metadata
)
select
  c.workspace_id, 'legacy_human_' || c.id, c.id, 'human', c.initiator_user_id,
  'host', 'left', c.started_at, c.ended_at, c.started_at,
  coalesce(c.ended_at, c.updated_at, c.started_at),
  jsonb_build_object('legacyCallId', c.id)
from public.calls c
where c.initiator_user_id is not null
on conflict do nothing;

insert into public.call_participants (
  workspace_id, id, call_id, participant_type, employee_id, role,
  participation_mode, state, joined_at, left_at, created_at, updated_at, metadata
)
select
  c.workspace_id, 'legacy_ai_' || c.id, c.id, 'ai_employee', c.primary_employee_id,
  'participant', 'active', 'left', c.started_at, c.ended_at, c.started_at,
  coalesce(c.ended_at, c.updated_at, c.started_at),
  jsonb_build_object('legacyCallId', c.id)
from public.calls c
where c.primary_employee_id is not null
on conflict do nothing;

insert into public.call_ai_turns (
  workspace_id, id, call_id, employee_id, mode, state, source_turn_id,
  transcript, response, estimated_wh, settled_wh, metadata, created_at, completed_at
)
select
  t.workspace_id, t.id, t.call_id, coalesce(c.primary_employee_id, 'unknown'),
  'active',
  case
    when t.state = 'completed' then 'completed'
    when t.state = 'failed' then 'failed'
    when t.state = 'interrupted' then 'interrupted'
    when t.state = 'speaking' then 'speaking'
    when t.state in ('thinking','using_tools','synthesizing') then 'thinking'
    else 'listening'
  end,
  t.id, t.human_transcript, coalesce(nullif(t.employee_transcript, ''), t.spoken_text),
  t.estimated_wh, t.settled_wh,
  t.metadata || jsonb_build_object('legacyTurnId', t.id),
  t.created_at, t.completed_at
from public.call_turns t
join public.calls c
  on c.workspace_id = t.workspace_id and c.id = t.call_id
on conflict do nothing;

-- PostgreSQL functions give service-side APIs atomic multi-device acceptance.
create or replace function public.accept_call_invitation(
  p_workspace_id uuid,
  p_invitation_id text,
  p_user_id uuid,
  p_device_id text,
  p_lease_seconds integer default 45
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.call_invitations%rowtype;
  v_part public.call_participants%rowtype;
begin
  select * into v_inv
  from public.call_invitations
  where workspace_id = p_workspace_id and id = p_invitation_id
  for update;

  if not found or v_inv.invitee_user_id is distinct from p_user_id then
    raise exception 'Invitation not found';
  end if;
  if v_inv.status <> 'pending' then
    return jsonb_build_object('won', false, 'status', v_inv.status, 'callId', v_inv.call_id);
  end if;
  if v_inv.expires_at <= now() then
    update public.call_invitations set status = 'expired', responded_at = now(), updated_at = now()
      where workspace_id = p_workspace_id and id = p_invitation_id;
    return jsonb_build_object('won', false, 'status', 'expired', 'callId', v_inv.call_id);
  end if;

  select * into v_part from public.call_participants
  where workspace_id = p_workspace_id and call_id = v_inv.call_id and user_id = p_user_id
  for update;

  delete from public.call_participant_leases
  where workspace_id = p_workspace_id and user_id = p_user_id and lease_expires_at <= now();

  if exists (
    select 1 from public.call_participant_leases
    where workspace_id = p_workspace_id and user_id = p_user_id and call_id <> v_inv.call_id
  ) then
    raise exception 'User is already active in another call';
  end if;

  update public.call_invitations
    set status = 'accepted', accepted_device_id = p_device_id,
        accepted_at = now(), responded_at = now(), updated_at = now()
    where workspace_id = p_workspace_id and id = p_invitation_id;
  update public.call_participants
    set state = 'accepted', device_id = p_device_id, updated_at = now()
    where workspace_id = p_workspace_id and id = v_part.id;
  insert into public.call_participant_leases (
    workspace_id, user_id, call_id, participant_id, device_id, heartbeat_at, lease_expires_at
  ) values (
    p_workspace_id, p_user_id, v_inv.call_id, v_part.id, p_device_id, now(),
    now() + make_interval(secs => greatest(15, least(p_lease_seconds, 120)))
  )
  on conflict (workspace_id, user_id) do update
    set call_id = excluded.call_id, participant_id = excluded.participant_id,
        device_id = excluded.device_id, heartbeat_at = excluded.heartbeat_at,
        lease_expires_at = excluded.lease_expires_at;
  update public.call_sessions
    set status = 'connecting', answered_at = coalesce(answered_at, now()),
        last_activity_at = now(), updated_at = now()
    where workspace_id = p_workspace_id and id = v_inv.call_id;

  return jsonb_build_object('won', true, 'status', 'accepted', 'callId', v_inv.call_id, 'participantId', v_part.id);
end;
$$;

revoke all on function public.accept_call_invitation(uuid,text,uuid,text,integer) from public, anon, authenticated;
grant execute on function public.accept_call_invitation(uuid,text,uuid,text,integer) to service_role;
