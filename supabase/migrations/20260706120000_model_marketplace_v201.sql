-- V20.1.0 — Runtime Model Marketplace + Route Optimizer (additive)

-- ---------------------------------------------------------------------------
-- Extend ai_model_catalog
-- ---------------------------------------------------------------------------
alter table public.ai_model_catalog
  add column if not exists normalized_model_family text,
  add column if not exists model_type text not null default 'language',
  add column if not exists supports_json boolean not null default true,
  add column if not exists supports_tools boolean not null default false,
  add column if not exists supports_embeddings boolean not null default false,
  add column if not exists supports_long_context boolean not null default false,
  add column if not exists supports_json_verified_at timestamptz,
  add column if not exists supports_tools_verified_at timestamptz,
  add column if not exists supports_embeddings_verified_at timestamptz,
  add column if not exists price_fetched_at timestamptz;

alter table public.ai_model_catalog
  drop constraint if exists ai_model_catalog_model_type_check;

alter table public.ai_model_catalog
  add constraint ai_model_catalog_model_type_check
  check (model_type in ('language', 'embedding', 'reranker'));

-- Backfill model families for existing seed rows
update public.ai_model_catalog set normalized_model_family = 'mock-efficient', model_type = 'language'
  where provider_route = 'mock' and model_id = 'mock-efficient';
update public.ai_model_catalog set normalized_model_family = 'mock-balanced', model_type = 'language'
  where provider_route = 'mock' and model_id = 'mock-balanced';
update public.ai_model_catalog set normalized_model_family = 'deepseek-v3', model_type = 'language', supports_json = true
  where model_id = 'deepseek-ai/DeepSeek-V3';
update public.ai_model_catalog set normalized_model_family = 'deepseek-v4-flash', model_type = 'language', supports_json = true
  where model_id = 'deepseek-ai/DeepSeek-V4-Flash';
update public.ai_model_catalog set normalized_model_family = 'deepseek-v4-pro', model_type = 'language', supports_json = true
  where model_id = 'deepseek-ai/DeepSeek-V4-Pro';
update public.ai_model_catalog set normalized_model_family = 'minimax-m2-5', model_type = 'language', supports_long_context = true, supports_json = true
  where model_id = 'MiniMaxAI/MiniMax-M2.5';
update public.ai_model_catalog set normalized_model_family = 'qwen3-coder-30b-a3b', model_type = 'language', supports_json = true
  where model_id = 'Qwen/Qwen3-Coder-30B-A3B-Instruct';
update public.ai_model_catalog set normalized_model_family = 'bge-large-en-v1-5', model_type = 'embedding', supports_embeddings = true, supports_json = false
  where model_id = 'BAAI/bge-large-en-v1.5';

-- Vercel gateway seed rows (matches STATIC_MODEL_CATALOG)
insert into public.ai_model_catalog (
  provider_route, provider_name, model_id, display_name, normalized_model_family,
  model_type, capabilities, runtime_modes, context_window,
  input_cost_per_million, output_cost_per_million, source,
  supports_json, supports_tools, supports_embeddings, supports_long_context,
  quality_score, reliability_score
)
values
  (
    'vercel_gateway', 'vercel', 'openai/gpt-4o-mini', 'GPT-4o Mini',
    'gpt-4o-mini', 'language',
    '["quick_reply","classification","memory_curation","summarization","structured_chat","artifact_generation","reasoning"]'::jsonb,
    '["efficient","balanced","coding"]'::jsonb, 128000, 0.15, 0.6, 'manual_seed',
    true, true, false, false, 7.5, 8.5
  ),
  (
    'vercel_gateway', 'vercel', 'anthropic/claude-sonnet-4', 'Claude Sonnet 4 (Strong)',
    'claude-sonnet-4', 'language',
    '["deep_reasoning","artifact_generation","research_planning"]'::jsonb,
    '["strong","research"]'::jsonb, 128000, 3.0, 15.0, 'manual_seed',
    true, true, false, false, 9.0, 9.0
  ),
  (
    'vercel_gateway', 'vercel', 'google/gemini-2.5-flash', 'Gemini 2.5 Flash (Long Context)',
    'gemini-2-5-flash', 'language',
    '["long_context","research_planning"]'::jsonb,
    '["long_context","research"]'::jsonb, 1000000, 0.15, 0.6, 'manual_seed',
    true, true, false, true, 8.0, 8.5
  ),
  (
    'vercel_gateway', 'vercel', 'openai/text-embedding-3-small', 'Text Embedding 3 Small',
    'text-embedding-3-small', 'embedding',
    '["embedding"]'::jsonb,
    '["embedding"]'::jsonb, 8192, 0.02, 0.02, 'manual_seed',
    false, false, true, false, 8.0, 9.0
  )
on conflict (provider_route, model_id) do update set
  display_name = excluded.display_name,
  normalized_model_family = excluded.normalized_model_family,
  capabilities = excluded.capabilities,
  runtime_modes = excluded.runtime_modes,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- ai_model_price_snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.ai_model_price_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider_route text not null,
  model_id text not null,
  input_cost_per_million numeric(14, 8),
  output_cost_per_million numeric(14, 8),
  cached_input_cost_per_million numeric(14, 8),
  cache_write_cost_per_million numeric(14, 8),
  source text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists idx_ai_model_price_snapshots_lookup
  on public.ai_model_price_snapshots (provider_route, model_id, fetched_at desc);

-- ---------------------------------------------------------------------------
-- ai_model_sync_runs
-- ---------------------------------------------------------------------------
create table if not exists public.ai_model_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  status text not null check (status in ('started', 'success', 'skipped', 'failed')),
  offers_added integer not null default 0,
  offers_updated integer not null default 0,
  offers_disabled integer not null default 0,
  error text,
  dry_run boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_ai_model_sync_runs_provider_started
  on public.ai_model_sync_runs (provider, started_at desc);

-- ---------------------------------------------------------------------------
-- ai_model_route_health
-- ---------------------------------------------------------------------------
create table if not exists public.ai_model_route_health (
  id uuid primary key default gen_random_uuid(),
  provider_route text not null,
  model_id text not null,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  fallback_count integer not null default 0,
  timeout_count integer not null default 0,
  json_failure_count integer not null default 0,
  avg_latency_ms numeric(12, 2),
  p95_latency_ms integer,
  avg_cost_usd numeric(14, 8),
  avg_cost_error_ratio numeric(8, 4),
  window_hours integer not null default 168,
  computed_at timestamptz not null default now(),
  unique (provider_route, model_id)
);

create index if not exists idx_ai_model_route_health_provider
  on public.ai_model_route_health (provider_route);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.ai_model_price_snapshots enable row level security;
alter table public.ai_model_sync_runs enable row level security;
alter table public.ai_model_route_health enable row level security;

drop policy if exists "ai_model_price_snapshots_select_authenticated" on public.ai_model_price_snapshots;
create policy "ai_model_price_snapshots_select_authenticated"
on public.ai_model_price_snapshots for select
to authenticated
using (true);

drop policy if exists "ai_model_sync_runs_select_authenticated" on public.ai_model_sync_runs;
create policy "ai_model_sync_runs_select_authenticated"
on public.ai_model_sync_runs for select
to authenticated
using (true);

drop policy if exists "ai_model_route_health_select_authenticated" on public.ai_model_route_health;
create policy "ai_model_route_health_select_authenticated"
on public.ai_model_route_health for select
to authenticated
using (true);

-- Service role bypasses RLS for sync writes (no insert policies for authenticated)
