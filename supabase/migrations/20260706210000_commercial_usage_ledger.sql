-- Commercial Usage System — Phase 2: billable AI cost ledger.
-- Single source of truth for every billable (and platform-overhead) AI cost event.
-- Service-role write only; workspace-facing reads go through aggregated server APIs.

create table if not exists public.ai_cost_ledger_entries (
  id uuid primary key default gen_random_uuid(),

  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid null,
  employee_id text null,
  work_unit_id text null,

  room_id text null,
  topic_id text null,
  message_id text null,

  source_type text not null,
  -- llm | search | browser | embedding | file_analysis | artifact | system | manual_adjustment

  provider_route text null,
  provider_name text null,
  model_id text null,
  endpoint_key text null,

  runtime_mode text null,
  capability text null,
  work_type text null,

  input_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,

  search_requests integer not null default 0,
  search_credits numeric(12,4) not null default 0,
  browser_session_seconds integer not null default 0,
  browser_pages_opened integer not null default 0,
  browser_screenshots integer not null default 0,

  unit_cost_usd numeric(14,8) null,
  estimated_cost_usd numeric(14,8) not null default 0,
  actual_cost_usd numeric(14,8) not null default 0,
  cost_source text not null default 'estimated',
  -- provider_usage | provider_invoice | estimated | manual

  billable_to_workspace boolean not null default true,
  platform_overhead boolean not null default false,

  work_hour_usd_rate numeric(14,8) not null default 0.01,
  work_hours_charged numeric(14,4) not null default 0,

  status text not null default 'succeeded',
  error_code text null,
  error_message text null,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_ai_cost_ledger_workspace_created
  on public.ai_cost_ledger_entries (workspace_id, created_at desc);
create index if not exists idx_ai_cost_ledger_employee_created
  on public.ai_cost_ledger_entries (employee_id, created_at desc)
  where employee_id is not null;
create index if not exists idx_ai_cost_ledger_provider_model
  on public.ai_cost_ledger_entries (provider_route, model_id);
create index if not exists idx_ai_cost_ledger_work_unit
  on public.ai_cost_ledger_entries (work_unit_id)
  where work_unit_id is not null;

-- Dedup guard: one ledger row per (work_unit_id, source_type) when work unit is present.
create unique index if not exists uq_ai_cost_ledger_work_unit_source
  on public.ai_cost_ledger_entries (work_unit_id, source_type)
  where work_unit_id is not null;

alter table public.ai_cost_ledger_entries enable row level security;
