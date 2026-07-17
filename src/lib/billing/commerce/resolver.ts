import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlanVersionById } from "./catalog";
import { ensureCurrentUsagePeriodGrant } from "./grants";
import { sumActiveReservations, sumCreditLotRemaining } from "./ledger";
import { parsePlanEntitlements } from "./entitlement-matrix";
import type {
  PlanEntitlements,
  ProviderSubscriptionStatus,
  ServiceAccessStatus,
} from "./types";

export type OperationalFeatureKey =
  | "voice"
  | "video"
  | "image"
  | "browser"
  | "search"
  | "steward";

function operationalFlag(key: OperationalFeatureKey): boolean {
  const envMap: Record<OperationalFeatureKey, string | undefined> = {
    voice: process.env.ADEHQ_BRAIN_VOICE_V1,
    video: process.env.ADEHQ_BRAIN_VIDEO_V1,
    image: process.env.ADEHQ_BRAIN_IMAGE_V1,
    browser: process.env.ADEHQ_BRAIN_BROWSER_V1,
    search: process.env.ADEHQ_BRAIN_SEARCH_V1,
    steward: process.env.ADEHQ_BRAIN_STEWARD_V1,
  };
  const raw = envMap[key]?.trim();
  // Undefined = operationally available (commercial entitlements still apply)
  if (raw == null || raw === "") return true;
  return raw === "1" || raw.toLowerCase() === "true";
}

/**
 * Single commercial resolver for pricing, checkout, Brain, and billing UI.
 * Uses service_access_status (not provider_status) for paid entitlements.
 */
export async function resolveWorkspaceCommercial(
  client: SupabaseClient,
  workspaceId: string,
) {
  const { data: workspace, error: wsError } = await client
    .from("workspaces")
    .select(
      "plan_slug, plan, plan_version_id, usage_anchor_at, usage_clock_kind, free_plan_started_at, current_plan_started_at, free_wh_eligible",
    )
    .eq("id", workspaceId)
    .maybeSingle();
  if (wsError) throw wsError;
  if (!workspace) throw new Error("Workspace not found.");

  const { data: subscription } = await client
    .from("billing_subscriptions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const serviceAccess = (subscription?.service_access_status as ServiceAccessStatus | undefined) ?? "free";
  const providerStatus = (subscription?.provider_status as ProviderSubscriptionStatus | null) ?? null;

  const paidAccess =
    serviceAccess === "active" ||
    serviceAccess === "grace" ||
    serviceAccess === "scheduled_to_end" ||
    serviceAccess === "read_only";

  let planVersionId =
    (paidAccess ? (subscription?.plan_version_id as string | null) : null) ??
    (workspace.plan_version_id as string | null);

  // Free access: pin free version when service access is not paid-bearing
  if (!paidAccess) {
    const { data: freeVersion } = await client
      .from("billing_plan_versions")
      .select("id, billing_plans!inner(code)")
      .eq("status", "published")
      .eq("billing_plans.code", "free")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    planVersionId = freeVersion?.id ?? planVersionId;
  }

  const version = planVersionId ? await getPlanVersionById(client, planVersionId) : null;
  const entitlements: PlanEntitlements =
    version?.entitlements ?? parsePlanEntitlements({});

  const period = await ensureCurrentUsagePeriodGrant(client, workspaceId);

  const { data: periodRow } = await client
    .from("workspace_usage_periods")
    .select("*")
    .eq("id", period.periodId)
    .maybeSingle();

  const baseGranted = Number(periodRow?.base_wh_granted ?? period.baseWhGranted);
  const baseUsed = Number(periodRow?.base_wh_used ?? periodRow?.ai_work_hours_used ?? 0);
  const promoGranted = Number(periodRow?.promotional_wh_granted ?? 0);
  const promoUsed = Number(periodRow?.promotional_wh_used ?? 0);

  // Upgrade adjustments from ledger
  const { data: adjustments } = await client
    .from("wh_ledger_entries")
    .select("amount_wh")
    .eq("workspace_id", workspaceId)
    .eq("usage_period_id", period.periodId)
    .eq("entry_type", "upgrade_allowance_adjustment");
  const upgradeAdjust = (adjustments ?? []).reduce(
    (sum, row) => sum + Number(row.amount_wh ?? 0),
    0,
  );

  const periodRemaining = Math.max(
    0,
    baseGranted + promoGranted + upgradeAdjust - baseUsed - promoUsed,
  );

  const [lotsRemaining, reserved] = await Promise.all([
    sumCreditLotRemaining(client, workspaceId),
    sumActiveReservations(client, workspaceId),
  ]);

  const availableWh = Math.max(0, periodRemaining + lotsRemaining - reserved);
  const unlimited = entitlements.unlimited_work_hours === true;

  const commerciallyEntitled = {
    search: entitlements.searchEnabled,
    browser: entitlements.browserEnabled,
    voice: entitlements.voiceEnabled,
    image: entitlements.imageEnabled,
    video: entitlements.videoEnabled,
    steward: entitlements.maxStewardCollaborators > 0,
  };

  const operationallyAvailable = {
    search: {
      ok: operationalFlag("search"),
      reason: operationalFlag("search") ? undefined : "temporary_provider_outage",
    },
    browser: {
      ok: operationalFlag("browser"),
      reason: operationalFlag("browser") ? undefined : "temporary_provider_outage",
    },
    voice: {
      ok: operationalFlag("voice"),
      reason: operationalFlag("voice") ? undefined : "temporary_provider_outage",
    },
    image: {
      ok: operationalFlag("image"),
      reason: operationalFlag("image") ? undefined : "temporary_provider_outage",
    },
    video: {
      ok: operationalFlag("video"),
      reason: operationalFlag("video") ? undefined : "temporary_provider_outage",
    },
    steward: {
      ok: operationalFlag("steward"),
      reason: operationalFlag("steward") ? undefined : "temporary_provider_outage",
    },
  };

  return {
    workspaceId,
    planCode: version?.planCode ?? "free",
    planVersionId: version?.id ?? null,
    publicName: version?.publicName ?? "Free",
    entitlements,
    serviceAccess,
    providerStatus,
    usageAnchorAt: workspace.usage_anchor_at,
    usageClockKind: workspace.usage_clock_kind,
    usagePeriod: {
      id: period.periodId,
      periodKey: period.periodKey,
      baseWhGranted: baseGranted,
      promotionalWhGranted: promoGranted,
      baseWhUsed: baseUsed,
      promotionalWhUsed: promoUsed,
      upgradeAdjustmentWh: upgradeAdjust,
      remainingWh: periodRemaining,
      startedAt: periodRow?.period_key ?? null,
    },
    wallets: {
      creditLotsRemainingWh: lotsRemaining,
      reservedWh: reserved,
      availableWh: unlimited ? Number.POSITIVE_INFINITY : availableWh,
      unlimited,
    },
    subscription: subscription
      ? {
          id: String(subscription.id),
          planSlug: String(subscription.plan_slug),
          billingPeriodEnd: subscription.current_period_end
            ? String(subscription.current_period_end)
            : null,
          billingPeriodStart: subscription.current_period_start
            ? String(subscription.current_period_start)
            : null,
          serviceAccessEndsAt: subscription.service_access_ends_at
            ? String(subscription.service_access_ends_at)
            : null,
          cancelRequestedAt: subscription.cancel_requested_at
            ? String(subscription.cancel_requested_at)
            : null,
          graceEndsAt: subscription.grace_ends_at
            ? String(subscription.grace_ends_at)
            : null,
          legacyManualRenew: Boolean(subscription.legacy_manual_renew),
          pendingCommercialPlanVersionId:
            subscription.pending_commercial_plan_version_id ?? null,
          commercialChangeEffectiveAt: subscription.commercial_change_effective_at
            ? String(subscription.commercial_change_effective_at)
            : null,
          pendingUsagePlanVersionId: subscription.pending_usage_plan_version_id ?? null,
          usageChangeEffectivePeriodStart: subscription.usage_change_effective_period_start
            ? String(subscription.usage_change_effective_period_start)
            : null,
          externalSubscriptionId: subscription.external_subscription_id ?? null,
        }
      : null,
    commerciallyEntitled,
    operationallyAvailable,
    aiExecutionAllowed:
      (serviceAccess === "active" ||
        serviceAccess === "grace" ||
        serviceAccess === "scheduled_to_end") &&
      (unlimited || availableWh > 0),
  };
}
