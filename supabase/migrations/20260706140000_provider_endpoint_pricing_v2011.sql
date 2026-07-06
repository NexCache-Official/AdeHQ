-- V20.1.1 — Provider endpoint pricing accuracy (additive)

-- ---------------------------------------------------------------------------
-- Extend ai_model_catalog for endpoint-level pricing
-- ---------------------------------------------------------------------------
alter table public.ai_model_catalog
  add column if not exists gateway_provider_slug text,
  add column if not exists endpoint_key text,
  add column if not exists provider_display_name text,
  add column if not exists pricing_unit text not null default 'per_million_tokens',
  add column if not exists cached_input_cost_per_million numeric(14, 8),
  add column if not exists max_output_tokens integer,
  add column if not exists throughput_tps numeric(10, 2),
  add column if not exists latency_seconds numeric(10, 2),
  add column if not exists pricing_discount_active boolean not null default false,
  add column if not exists original_input_cost_per_million numeric(14, 8),
  add column if not exists original_output_cost_per_million numeric(14, 8),
  add column if not exists pricing_notes text;

-- Backfill gateway slug + endpoint_key for existing rows
update public.ai_model_catalog
set gateway_provider_slug = coalesce(gateway_provider_slug, 'default')
where gateway_provider_slug is null;

update public.ai_model_catalog
set endpoint_key = provider_route || ':' || model_id || ':' || coalesce(gateway_provider_slug, 'default')
where endpoint_key is null;

alter table public.ai_model_catalog
  alter column endpoint_key set not null;

-- Drop old uniqueness so multiple Vercel endpoints per model can coexist
alter table public.ai_model_catalog
  drop constraint if exists ai_model_catalog_provider_route_model_id_key;

create unique index if not exists ai_model_catalog_endpoint_key_unique
  on public.ai_model_catalog (endpoint_key);

-- Correct stale SiliconFlow seed prices
update public.ai_model_catalog
set
  input_cost_per_million = 1.60,
  output_cost_per_million = 3.135,
  cached_input_cost_per_million = 0.135,
  cache_read_cost_per_million = 0.135,
  context_window = 1049000,
  max_output_tokens = 393000,
  normalized_model_family = 'deepseek-v4-pro',
  updated_at = now()
where provider_route = 'siliconflow_direct'
  and model_id = 'deepseek-ai/DeepSeek-V4-Pro';

update public.ai_model_catalog
set
  input_cost_per_million = 0.30,
  output_cost_per_million = 1.20,
  cached_input_cost_per_million = 0.03,
  cache_read_cost_per_million = 0.03,
  context_window = 197000,
  max_output_tokens = 131000,
  supports_long_context = true,
  normalized_model_family = 'minimax-m2-5',
  updated_at = now()
where provider_route = 'siliconflow_direct'
  and model_id = 'MiniMaxAI/MiniMax-M2.5';

-- Re-backfill endpoint_key after slug assignment
update public.ai_model_catalog
set endpoint_key = provider_route || ':' || model_id || ':' || coalesce(gateway_provider_slug, 'default')
where endpoint_key is not null;

-- Vercel provider endpoint rows (curated from official pages)
insert into public.ai_model_catalog (
  provider_route, provider_name, model_id, display_name, normalized_model_family,
  gateway_provider_slug, endpoint_key, provider_display_name,
  model_type, capabilities, runtime_modes, context_window, max_output_tokens,
  input_cost_per_million, output_cost_per_million,
  original_input_cost_per_million, original_output_cost_per_million,
  pricing_discount_active, pricing_notes, source,
  supports_json, supports_tools, supports_long_context,
  quality_score, reliability_score, metadata
)
values
  (
    'vercel_gateway', 'vercel', 'deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro (DeepSeek)',
    'deepseek-v4-pro', 'deepseek',
    'vercel_gateway:deepseek/deepseek-v4-pro:deepseek', 'DeepSeek',
    'language',
    '["deep_reasoning","artifact_generation","research_planning"]'::jsonb,
    '["strong","research"]'::jsonb,
    1000000, 393000,
    0.43, 0.87, 1.74, 3.48, true,
    'Discounted DeepSeek provider route',
    'manual_override',
    true, true, true, 9.0, 9.0,
    '{"priceSource":"vercel_page_manual","verifiedAt":"2026-07-06","verifiedBy":"manual_page_check","notes":"Vercel DeepSeek V4 Pro provider table","sourceUrl":"https://vercel.com/ai-gateway/models/deepseek-v4-pro"}'::jsonb
  ),
  (
    'vercel_gateway', 'vercel', 'minimax/minimax-m2.5', 'MiniMax M2.5 (MiniMax native)',
    'minimax-m2-5', 'minimax',
    'vercel_gateway:minimax/minimax-m2.5:minimax', 'MiniMax',
    'language',
    '["long_context","research_planning","browser_research"]'::jsonb,
    '["long_context","research"]'::jsonb,
    205000, 131000,
    0.30, 1.20, null, null, false,
    'Native MiniMax provider — 205K context',
    'manual_override',
    true, true, true, 8.0, 8.5,
    '{"priceSource":"vercel_page_manual","verifiedAt":"2026-07-06","verifiedBy":"manual_page_check","notes":"Vercel MiniMax M2.5 native provider","sourceUrl":"https://vercel.com/ai-gateway/models/minimax-m2.5/providers"}'::jsonb
  ),
  (
    'vercel_gateway', 'vercel', 'minimax/minimax-m2.5', 'MiniMax M2.5 (DeepInfra)',
    'minimax-m2-5', 'deepinfra',
    'vercel_gateway:minimax/minimax-m2.5:deepinfra', 'DeepInfra',
    'language',
    '["long_context","research_planning","browser_research"]'::jsonb,
    '["long_context","research"]'::jsonb,
    197000, 131000,
    0.27, 0.95, null, null, false,
    'DeepInfra provider — 197K context',
    'manual_override',
    true, true, true, 7.8, 8.0,
    '{"priceSource":"vercel_page_manual","verifiedAt":"2026-07-06","verifiedBy":"manual_page_check","notes":"Vercel MiniMax via DeepInfra","sourceUrl":"https://vercel.com/ai-gateway/models/minimax-m2.5/providers"}'::jsonb
  ),
  (
    'vercel_gateway', 'vercel', 'minimax/minimax-m2.5', 'MiniMax M2.5 (Blackbox)',
    'minimax-m2-5', 'blackbox',
    'vercel_gateway:minimax/minimax-m2.5:blackbox', 'Blackbox',
    'language',
    '["long_context","research_planning"]'::jsonb,
    '["long_context"]'::jsonb,
    128000, 65536,
    0.07, 0.57, null, null, false,
    'Blackbox provider — 128K context cap only',
    'manual_override',
    true, false, true, 7.0, 7.5,
    '{"priceSource":"vercel_page_manual","verifiedAt":"2026-07-06","verifiedBy":"manual_page_check","notes":"Cheapest but 128K context only","sourceUrl":"https://vercel.com/ai-gateway/models/minimax-m2.5/providers"}'::jsonb
  )
on conflict (endpoint_key) do update set
  display_name = excluded.display_name,
  provider_display_name = excluded.provider_display_name,
  input_cost_per_million = excluded.input_cost_per_million,
  output_cost_per_million = excluded.output_cost_per_million,
  original_input_cost_per_million = excluded.original_input_cost_per_million,
  original_output_cost_per_million = excluded.original_output_cost_per_million,
  pricing_discount_active = excluded.pricing_discount_active,
  context_window = excluded.context_window,
  max_output_tokens = excluded.max_output_tokens,
  pricing_notes = excluded.pricing_notes,
  metadata = excluded.metadata,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Extend ai_model_route_health for endpoint_key
-- ---------------------------------------------------------------------------
alter table public.ai_model_route_health
  add column if not exists gateway_provider_slug text,
  add column if not exists endpoint_key text;

update public.ai_model_route_health
set
  gateway_provider_slug = coalesce(gateway_provider_slug, 'default'),
  endpoint_key = provider_route || ':' || model_id || ':' || coalesce(gateway_provider_slug, 'default')
where endpoint_key is null;

alter table public.ai_model_route_health
  alter column endpoint_key set not null;

alter table public.ai_model_route_health
  drop constraint if exists ai_model_route_health_provider_route_model_id_key;

create unique index if not exists ai_model_route_health_endpoint_key_unique
  on public.ai_model_route_health (endpoint_key);
