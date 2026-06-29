-- Ensure every workspace has AI settings so admin RLS is not required for reads.
insert into public.workspace_ai_settings (
  workspace_id,
  ai_enabled,
  default_provider,
  daily_token_limit,
  daily_cost_limit_usd,
  employee_daily_token_limit,
  max_parallel_runs,
  max_output_tokens,
  max_tool_runs_per_task,
  max_handoff_depth
)
select
  w.id,
  true,
  'siliconflow',
  500000,
  5,
  100000,
  3,
  4096,
  10,
  1
from public.workspaces w
where not exists (
  select 1 from public.workspace_ai_settings s where s.workspace_id = w.id
);
