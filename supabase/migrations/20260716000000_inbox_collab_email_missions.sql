-- Slice F: inbound AI wake, collaborative email missions, unified status.

alter table public.email_threads
  add column if not exists mission_status text not null default 'idle',
  add column if not exists mission_owner_employee_id text,
  add column if not exists last_inbound_at timestamptz,
  add column if not exists last_wake_at timestamptz,
  add column if not exists origin_room_id text,
  add column if not exists origin_topic_id text;

alter table public.email_threads
  drop constraint if exists email_threads_mission_status_check;

alter table public.email_threads
  add constraint email_threads_mission_status_check check (
    mission_status in (
      'idle',
      'triaging',
      'assigned',
      'awaiting_human',
      'brainstorming',
      'drafting',
      'pending_send',
      'queued',
      'sent',
      'waiting_reply',
      'discarded'
    )
  );

create index if not exists idx_email_threads_mission_attention
  on public.email_threads (workspace_id, mission_status, updated_at desc)
  where mission_status in ('awaiting_human', 'brainstorming', 'pending_send');

create index if not exists idx_email_threads_mission_owner
  on public.email_threads (workspace_id, mission_owner_employee_id, updated_at desc)
  where mission_owner_employee_id is not null;

alter table public.email_jobs
  drop constraint if exists email_jobs_job_type_check;

alter table public.email_jobs
  add constraint email_jobs_job_type_check check (
    job_type in ('triage', 'draft', 'rewrite', 'inbound_wake')
  );

comment on column public.email_threads.mission_status is
  'Canonical cross-surface email mission state for Inbox, chat, and Approvals.';
comment on column public.email_threads.mission_owner_employee_id is
  'AI employee accountable for the current email mission.';
