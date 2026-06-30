-- V19.1: Maya system recruiting manager employee

alter table public.ai_employees
  add column if not exists is_system_employee boolean not null default false,
  add column if not exists system_employee_key text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists ai_employees_workspace_system_key_uidx
  on public.ai_employees (workspace_id, system_employee_key)
  where system_employee_key is not null;

insert into public.ai_employees (
  workspace_id,
  id,
  name,
  role,
  role_key,
  provider,
  model,
  model_mode,
  seniority,
  status,
  instructions,
  communication_style,
  success_criteria,
  permissions,
  accent,
  is_system_employee,
  system_employee_key,
  metadata
)
select
  w.id,
  'emp-maya',
  'Maya',
  'AI Recruiting Manager',
  'recruiting_manager',
  'siliconflow',
  'deepseek-ai/DeepSeek-V4-Flash',
  'balanced',
  'Manager',
  'idle',
  'You are Maya, AdeHQ''s AI Recruiting Manager. Help users hire, refine, and manage AI employees.',
  'Warm, sharp, practical, and efficient',
  'Help users hire and improve AI employees quickly',
  '{"readMemory":true,"writeDraftMemory":true,"pinMemory":false,"createTasks":true,"assignTasks":false,"messageEmployees":true,"startCalls":false,"requestApproval":true,"approvalBeforeExternal":true,"approvalBeforeEmails":true,"approvalBeforeCode":false,"approvalBeforeBilling":true}'::jsonb,
  '#0ea5e9',
  true,
  'maya_recruiting_manager',
  '{"dmOnly":true,"canBeArchived":false,"canBeAssignedToChannels":false,"purpose":"hire_and_manage_ai_employees"}'::jsonb
from public.workspaces w
where not exists (
  select 1
  from public.ai_employees e
  where e.workspace_id = w.id
    and e.system_employee_key = 'maya_recruiting_manager'
);
