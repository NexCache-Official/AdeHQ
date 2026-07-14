-- Multi-party task book: capacity, work class, human/AI assignees, leftover sweep links.

alter table public.tasks
  add column if not exists created_by_type text,
  add column if not exists created_by_id text,
  add column if not exists source_message_id text,
  add column if not exists agent_run_id text,
  add column if not exists integration_job_id text,
  add column if not exists work_class text,
  add column if not exists queue_position integer,
  add column if not exists blocked_reason text,
  add column if not exists transferred_from_employee_id text,
  add column if not exists transferred_to_employee_id text;

comment on column public.tasks.created_by_type is 'human | ai_employee | steward';
comment on column public.tasks.work_class is 'interactive | light_parallel | heavy_artifact';
comment on column public.tasks.blocked_reason is 'needs_human_input | capacity | depends_on_task';

create index if not exists tasks_assignee_status_idx
  on public.tasks (workspace_id, assignee_type, assignee_id, status);

create index if not exists tasks_topic_open_idx
  on public.tasks (workspace_id, topic_id, status)
  where status in ('open', 'in_progress', 'waiting_on_human', 'blocked', 'waiting_approval');
