-- V19.6.9: Canonical hiring session architecture — scoped sessions, role snapshots

-- Extend status values (migrate legacy rows first)
update public.hiring_sessions set status = 'cancelled' where status = 'abandoned';
update public.hiring_sessions set status = 'active' where status = 'hiring';

alter table public.hiring_sessions drop constraint if exists hiring_sessions_status_check;
alter table public.hiring_sessions
  add constraint hiring_sessions_status_check
  check (status in (
    'proposed',
    'active',
    'candidates_ready',
    'hired',
    'cancelled',
    'archived'
  ));

alter table public.hiring_sessions
  add column if not exists source text,
  add column if not exists role_title text,
  add column if not exists role_key text,
  add column if not exists department text,
  add column if not exists readiness_score real,
  add column if not exists required_questions_answered int not null default 0,
  add column if not exists selected_candidate_id text,
  add column if not exists created_from_message_id text,
  add column if not exists last_user_message_id text;

-- Drop legacy one-session-per-room index (caused cross-topic state leaks)
drop index if exists public.hiring_sessions_active_uidx;

-- One active hiring session per dedicated hiring topic
create unique index if not exists hiring_sessions_active_topic_uidx
  on public.hiring_sessions (workspace_id, user_id, maya_topic_id)
  where maya_topic_id is not null
    and status in ('proposed', 'active', 'candidates_ready');

-- One active direct-chat hiring session per Maya DM room (no dedicated topic)
create unique index if not exists hiring_sessions_active_direct_chat_uidx
  on public.hiring_sessions (workspace_id, user_id, maya_room_id)
  where maya_topic_id is null
    and source = 'maya_direct_chat'
    and status in ('proposed', 'active', 'candidates_ready');

-- One active /hire-route session per user (onboarding + top nav share hire_route source)
create unique index if not exists hiring_sessions_active_hire_route_uidx
  on public.hiring_sessions (workspace_id, user_id)
  where maya_topic_id is null
    and source in ('hire_route', 'onboarding', 'top_nav_hire_button')
    and status in ('proposed', 'active', 'candidates_ready');

-- Candidate role snapshots — never reuse candidates across roles/sessions
alter table public.hiring_candidates
  add column if not exists role_key text,
  add column if not exists role_title text;

create index if not exists hiring_candidates_session_role_idx
  on public.hiring_candidates (hiring_session_id, role_key);
