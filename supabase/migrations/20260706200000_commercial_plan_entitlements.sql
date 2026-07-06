-- Commercial Usage System — Phase 1: plan entitlements + unlimited seats + plan_slug unification
-- Reprices plans to the commercial V1 structure, makes human members and AI employees
-- unlimited on every plan, and unifies workspace plan assignment via workspaces.plan_slug.

-- 1. Unlimited seats + nullable seat caps ------------------------------------

alter table public.platform_plan_configs
  add column if not exists human_members_unlimited boolean not null default true;
alter table public.platform_plan_configs
  add column if not exists ai_employees_unlimited boolean not null default true;

alter table public.platform_plan_configs alter column max_ai_employees drop not null;
alter table public.platform_plan_configs alter column max_members drop not null;

-- NULL seat caps are treated as unlimited by the app.
update public.platform_plan_configs set max_ai_employees = null, max_members = null;

-- 2. Reseed commercial plans -------------------------------------------------
-- monthly/annual in cents; weekly_work_hours per commercial spec.
-- entitlements jsonb carries customer-facing tier labels (no internal pricing).

insert into public.platform_plan_configs (
  plan_slug, display_name, monthly_price_cents, annual_price_cents, trial_days, is_active,
  weekly_work_hours, max_ai_employees, max_members, max_workspaces,
  max_rooms, max_topics, max_storage_bytes, max_browser_runs_per_week, max_file_upload_mb,
  allowed_intelligence_tiers, browser_research_enabled, gateway_search_enabled,
  custom_ai_employees_enabled, team_features_enabled, admin_controls_enabled, priority_support,
  human_members_unlimited, ai_employees_unlimited, entitlements
) values
  ('free', 'Free', 0, 0, 0, true,
    10, null, null, 1,
    5, 25, 1073741824, 2, 10,
    '["cheap","balanced"]'::jsonb, false, true,
    true, false, false, false,
    true, true,
    '{"web_search":"limited","browser_research":"preview_limited","intelligence_tier":"efficient","storage_tier":"low","support_tier":"basic"}'::jsonb),
  ('pro', 'Pro', 1900, 19900, 7, true,
    125, null, null, 3,
    50, 250, 10737418240, 25, 25,
    '["cheap","balanced","strong","coding"]'::jsonb, true, true,
    true, false, false, false,
    true, true,
    '{"web_search":"included_usage_based","browser_research":"included_usage_based","intelligence_tier":"balanced","storage_tier":"standard","support_tier":"email"}'::jsonb),
  ('team', 'Team', 3800, 39900, 14, true,
    250, null, null, 10,
    150, 750, 53687091200, 60, 50,
    '["cheap","balanced","strong","long_context","coding"]'::jsonb, true, true,
    true, true, true, false,
    true, true,
    '{"web_search":"higher_usage","browser_research":"higher_usage","intelligence_tier":"strong","storage_tier":"higher","support_tier":"priority_email","team_controls":true}'::jsonb),
  ('business', 'Business', 9900, 99900, 14, true,
    650, null, null, 25,
    500, 2500, 214748364800, 250, 100,
    '["cheap","balanced","strong","long_context","coding","creative"]'::jsonb, true, true,
    true, true, true, true,
    true, true,
    '{"web_search":"heavy_usage","browser_research":"high_usage","intelligence_tier":"advanced","storage_tier":"high","support_tier":"priority","admin_controls":true}'::jsonb),
  ('enterprise', 'Enterprise', 0, 0, 30, true,
    0, null, null, 0,
    0, 0, 0, 0, 0,
    '["cheap","balanced","strong","long_context","coding","creative"]'::jsonb, true, true,
    true, true, true, true,
    true, true,
    '{"web_search":"custom","browser_research":"custom","intelligence_tier":"custom","storage_tier":"custom","support_tier":"dedicated","custom_pricing":true,"unlimited_work_hours":true}'::jsonb)
on conflict (plan_slug) do update set
  display_name = excluded.display_name,
  monthly_price_cents = excluded.monthly_price_cents,
  annual_price_cents = excluded.annual_price_cents,
  trial_days = excluded.trial_days,
  is_active = excluded.is_active,
  weekly_work_hours = excluded.weekly_work_hours,
  max_ai_employees = excluded.max_ai_employees,
  max_members = excluded.max_members,
  max_workspaces = excluded.max_workspaces,
  max_rooms = excluded.max_rooms,
  max_topics = excluded.max_topics,
  max_storage_bytes = excluded.max_storage_bytes,
  max_browser_runs_per_week = excluded.max_browser_runs_per_week,
  max_file_upload_mb = excluded.max_file_upload_mb,
  allowed_intelligence_tiers = excluded.allowed_intelligence_tiers,
  browser_research_enabled = excluded.browser_research_enabled,
  gateway_search_enabled = excluded.gateway_search_enabled,
  custom_ai_employees_enabled = excluded.custom_ai_employees_enabled,
  team_features_enabled = excluded.team_features_enabled,
  admin_controls_enabled = excluded.admin_controls_enabled,
  priority_support = excluded.priority_support,
  human_members_unlimited = excluded.human_members_unlimited,
  ai_employees_unlimited = excluded.ai_employees_unlimited,
  entitlements = excluded.entitlements,
  updated_at = now();

-- 3. Unify workspace plan assignment via plan_slug ---------------------------

alter table public.workspaces
  add column if not exists plan_slug text references public.platform_plan_configs(plan_slug);

-- Backfill plan_slug from the legacy free-text plan column.
update public.workspaces set plan_slug = case
  when plan_slug is not null then plan_slug
  when plan in ('founder', 'starter', 'free') then 'free'
  when plan in ('growth', 'pro') then 'pro'
  when plan = 'team' then 'team'
  when plan = 'business' then 'business'
  when plan = 'enterprise' then 'enterprise'
  else 'free'
end;

-- Keep the legacy plan column in sync so older readers stay correct.
update public.workspaces set plan = coalesce(plan_slug, 'free') where plan_slug is not null;

create index if not exists idx_workspaces_plan_slug on public.workspaces (plan_slug);
