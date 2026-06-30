-- V16.9: Conversation orchestrator — run dependencies

alter table public.agent_runs
  add column if not exists depends_on_run_id text;

create index if not exists idx_agent_runs_depends_on
  on public.agent_runs(depends_on_run_id)
  where depends_on_run_id is not null;

create index if not exists idx_agent_runs_collab_lookup
  on public.agent_runs(workspace_id, root_trigger_message_id, status);
