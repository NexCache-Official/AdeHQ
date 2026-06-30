-- V16.8: Channel AI orchestration governance

alter table public.agent_runs
  add column if not exists response_reason text,
  add column if not exists root_trigger_message_id text,
  add column if not exists run_metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_agent_runs_root_trigger
  on public.agent_runs(workspace_id, root_trigger_message_id)
  where root_trigger_message_id is not null;

create index if not exists idx_agent_runs_topic_status
  on public.agent_runs(workspace_id, topic_id, status, started_at desc);

alter table public.ai_employees
  add column if not exists participation_style text not null default 'balanced_teammate';

-- General topics: smart_assist_lite default for new installs; upgrade existing General rows
update public.room_topics rt
set metadata = coalesce(rt.metadata, '{}'::jsonb) || '{"aiParticipationMode":"smart_assist_lite"}'::jsonb
where (rt.metadata->>'isMainChat')::boolean = true
   or lower(rt.title) = 'general';
