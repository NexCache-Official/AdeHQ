-- Production used *_all_member / *_write_member names (not insert/update_member).
-- Drop client write access; keep select for realtime/UI.

drop policy if exists "agent_runs_all_member" on public.agent_runs;
drop policy if exists "agent_runs_insert_member" on public.agent_runs;
drop policy if exists "agent_runs_update_member" on public.agent_runs;

drop policy if exists "agent_run_steps_all_member" on public.agent_run_steps;
drop policy if exists "agent_run_steps_insert_member" on public.agent_run_steps;
drop policy if exists "agent_run_steps_update_member" on public.agent_run_steps;

drop policy if exists "agent_runs_select_member" on public.agent_runs;
create policy "agent_runs_select_member"
on public.agent_runs for select
using (public.is_workspace_member(workspace_id));

drop policy if exists "agent_run_steps_select_member" on public.agent_run_steps;
create policy "agent_run_steps_select_member"
on public.agent_run_steps for select
using (public.is_workspace_member(workspace_id));

drop policy if exists "ai_usage_events_write_member" on public.ai_usage_events;
drop policy if exists "ai_usage_events_insert_member" on public.ai_usage_events;
drop policy if exists "ai_usage_events_update_member" on public.ai_usage_events;
