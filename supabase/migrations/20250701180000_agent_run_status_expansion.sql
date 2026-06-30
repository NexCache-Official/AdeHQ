-- Expand agent_runs.status for orchestration (waiting, cancelled)

alter table public.agent_runs drop constraint if exists agent_runs_status_check;

alter table public.agent_runs
  add constraint agent_runs_status_check check (
    status in (
      'queued',
      'waiting',
      'running',
      'waiting_approval',
      'completed',
      'failed',
      'blocked',
      'cancelled'
    )
  );

notify pgrst, 'reload schema';
