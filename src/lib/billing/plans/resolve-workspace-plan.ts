import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PlanConfig,
  PlanConfigRow,
  PlanSource,
  ResolvedWorkspacePlan,
  SubscriptionStatus,
} from "./types";

export const DEFAULT_PLAN_SLUG = "free";

/** Subscription statuses that grant the subscription's plan entitlements. */
const ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  "trialing",
  "active",
  "manual",
  "comped",
  "enterprise",
];

function toPlanConfig(row: PlanConfigRow): PlanConfig {
  return {
    planSlug: row.plan_slug,
    displayName: row.display_name,
    monthlyPriceCents: row.monthly_price_cents,
    annualPriceCents: row.annual_price_cents,
    trialDays: row.trial_days,
    isActive: row.is_active,
    weeklyWorkHours: Number(row.weekly_work_hours ?? 0),
    humanMembersUnlimited: row.human_members_unlimited ?? true,
    aiEmployeesUnlimited: row.ai_employees_unlimited ?? true,
    maxAiEmployees: row.max_ai_employees,
    maxMembers: row.max_members,
    maxWorkspaces: row.max_workspaces,
    maxStorageBytes: row.max_storage_bytes,
    maxFileUploadMb: row.max_file_upload_mb,
    allowedIntelligenceTiers: Array.isArray(row.allowed_intelligence_tiers)
      ? row.allowed_intelligence_tiers
      : [],
    browserResearchEnabled: row.browser_research_enabled,
    gatewaySearchEnabled: row.gateway_search_enabled,
    teamFeaturesEnabled: row.team_features_enabled,
    adminControlsEnabled: row.admin_controls_enabled,
    prioritySupport: row.priority_support,
    entitlements: (row.entitlements as Record<string, unknown>) ?? {},
  };
}

/** enterprise / custom plans use weekly_work_hours = 0 to mean unlimited. */
function isUnlimitedWorkHours(config: PlanConfig): boolean {
  if (config.entitlements?.unlimited_work_hours === true) return true;
  return config.planSlug === "enterprise" && config.weeklyWorkHours <= 0;
}

function isActiveOverride(row: Record<string, unknown>, now: number): boolean {
  const startsAt = row.starts_at ? Date.parse(String(row.starts_at)) : null;
  const expiresAt = row.expires_at ? Date.parse(String(row.expires_at)) : null;
  if (startsAt != null && Number.isFinite(startsAt) && startsAt > now) return false;
  if (expiresAt != null && Number.isFinite(expiresAt) && expiresAt <= now) return false;
  return true;
}

async function loadPlanConfig(
  client: SupabaseClient,
  planSlug: string,
): Promise<PlanConfig | null> {
  const { data, error } = await client
    .from("platform_plan_configs")
    .select("*")
    .eq("plan_slug", planSlug)
    .maybeSingle();
  if (error) throw error;
  return data ? toPlanConfig(data as PlanConfigRow) : null;
}

/**
 * Resolve the effective plan for a workspace.
 * Priority: active workspace_plan_overrides -> active subscription -> workspaces.plan_slug -> free.
 * Returns base weekly Work Hours from plan/override; promo + credit extras are layered in the
 * usage capacity calculation (see src/lib/billing/usage/periods.ts).
 */
export async function resolveWorkspacePlan(
  client: SupabaseClient,
  workspaceId: string,
): Promise<ResolvedWorkspacePlan> {
  const now = Date.now();

  const [workspaceRes, overrideRes, subscriptionRes] = await Promise.all([
    client.from("workspaces").select("plan_slug, plan").eq("id", workspaceId).maybeSingle(),
    client
      .from("workspace_plan_overrides")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    client
      .from("billing_subscriptions")
      .select("plan_slug, status")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (workspaceRes.error) throw workspaceRes.error;

  const override =
    !overrideRes.error && overrideRes.data && isActiveOverride(overrideRes.data, now)
      ? overrideRes.data
      : null;

  const subscription =
    !subscriptionRes.error && subscriptionRes.data ? subscriptionRes.data : null;
  const subscriptionStatus = (subscription?.status as SubscriptionStatus | undefined) ?? null;
  const subscriptionActive =
    subscription != null &&
    subscriptionStatus != null &&
    ACTIVE_SUBSCRIPTION_STATUSES.includes(subscriptionStatus);

  const workspacePlanSlug =
    (workspaceRes.data?.plan_slug as string | null) ??
    (workspaceRes.data?.plan as string | null) ??
    null;

  let planSlug: string;
  let source: PlanSource;
  if (override) {
    planSlug = String(override.plan_slug);
    source = "override";
  } else if (subscriptionActive && subscription?.plan_slug) {
    planSlug = String(subscription.plan_slug);
    source = "subscription";
  } else if (workspacePlanSlug) {
    planSlug = workspacePlanSlug;
    source = "workspace";
  } else {
    planSlug = DEFAULT_PLAN_SLUG;
    source = "default";
  }

  let config = await loadPlanConfig(client, planSlug);
  if (!config) {
    config = await loadPlanConfig(client, DEFAULT_PLAN_SLUG);
    planSlug = DEFAULT_PLAN_SLUG;
    source = "default";
  }
  if (!config) {
    throw new Error("No plan configs found. Apply migration 20260706200000_commercial_plan_entitlements.sql.");
  }

  const overrideWorkHours =
    override && override.weekly_ai_work_hours_override != null
      ? Number(override.weekly_ai_work_hours_override)
      : null;

  const unlimitedWorkHours = isUnlimitedWorkHours(config);
  const weeklyWorkHoursBase =
    overrideWorkHours != null && Number.isFinite(overrideWorkHours)
      ? overrideWorkHours
      : config.weeklyWorkHours;

  return {
    workspaceId,
    planSlug,
    source,
    subscriptionStatus,
    config,
    weeklyWorkHoursBase,
    unlimitedWorkHours,
    override: override
      ? {
          weeklyWorkHoursOverride: overrideWorkHours,
          reason: override.reason ? String(override.reason) : null,
          expiresAt: override.expires_at ? String(override.expires_at) : null,
        }
      : null,
  };
}

export async function listActivePlanConfigs(client: SupabaseClient): Promise<PlanConfig[]> {
  const { data, error } = await client
    .from("platform_plan_configs")
    .select("*")
    .eq("is_active", true)
    .order("monthly_price_cents");
  if (error) throw error;
  return ((data as PlanConfigRow[] | null) ?? []).map(toPlanConfig);
}
