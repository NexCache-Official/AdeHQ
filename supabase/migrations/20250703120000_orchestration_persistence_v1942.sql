-- V19.4.2: Durable orchestration employee statuses + completion work log guard

alter table public.conversation_orchestrations
  add column if not exists employee_statuses jsonb not null default '[]'::jsonb,
  add column if not exists completion_work_log_at timestamptz;

comment on column public.conversation_orchestrations.employee_statuses is
  'Per-employee orchestration phases: planned, reading, replying, waiting, completed, failed';

comment on column public.conversation_orchestrations.completion_work_log_at is
  'Set once when panel/collaboration/handoff completion work log is written';
