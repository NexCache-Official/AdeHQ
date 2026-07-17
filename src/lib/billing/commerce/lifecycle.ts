import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlanVersionById, getPublishedPrice } from "./catalog";
import { ensureCurrentUsagePeriodGrant, grantUpgradeAllowanceAdjustment, maybeIssuePastDueGraceWh } from "./grants";
import { firstUsagePeriodStartOnOrAfter, floorToHour, addBillingPeriod } from "./usage-clock";
import { PAYMENT_GRACE_MS, REFUND_POLICY_COPY, type BillingCadence, type PlanCode } from "./types";
import { cancelRevolutSubscription } from "@/lib/billing/revolut/subscriptions";

export { REFUND_POLICY_COPY };

/**
 * Cancel at provider immediately; keep AdeHQ paid access until billing_period_end.
 */
export async function cancelSubscriptionPaidThrough(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    actorUserId?: string | null;
    reason: string;
  },
): Promise<{
  serviceAccessEndsAt: string;
  providerStatus: string;
  serviceAccessStatus: string;
}> {
  const { data: sub, error } = await client
    .from("billing_subscriptions")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!sub) throw new Error("No subscription found.");

  const endsAt =
    sub.current_period_end ??
    addBillingPeriod(
      new Date(String(sub.current_period_start ?? sub.created_at)),
      (sub.billing_cadence as BillingCadence | null) ?? "monthly",
    ).toISOString();

  if (sub.external_subscription_id && !sub.legacy_manual_renew) {
    try {
      await cancelRevolutSubscription(String(sub.external_subscription_id));
    } catch (err) {
      console.error("[commerce.cancel] Revolut cancel failed", err);
      // Still schedule AdeHQ access end; reconciliation can repair provider state.
    }
  }

  const now = new Date().toISOString();
  const { error: updateError } = await client
    .from("billing_subscriptions")
    .update({
      provider_status: "cancelled",
      service_access_status: "scheduled_to_end",
      service_access_ends_at: endsAt,
      cancel_requested_at: now,
      cancel_at_period_end: true,
      status: "active", // keep legacy status meaningful until access ends
      updated_at: now,
      metadata: {
        ...(typeof sub.metadata === "object" && sub.metadata ? sub.metadata : {}),
        cancelReason: input.reason,
        cancelActorUserId: input.actorUserId ?? null,
      },
    })
    .eq("id", sub.id);
  if (updateError) throw updateError;

  await client.from("commerce_audit_events").insert({
    actor_user_id: input.actorUserId ?? null,
    action: "subscription_cancel_scheduled",
    entity_type: "billing_subscription",
    entity_id: String(sub.id),
    reason: input.reason,
    payload: { serviceAccessEndsAt: endsAt, refundPolicy: REFUND_POLICY_COPY },
  });

  return {
    serviceAccessEndsAt: String(endsAt),
    providerStatus: "cancelled",
    serviceAccessStatus: "scheduled_to_end",
  };
}

/** Apply Free when service_access_ends_at has passed. */
export async function applyServiceAccessEndIfDue(
  client: SupabaseClient,
  workspaceId: string,
  now = new Date(),
): Promise<boolean> {
  const { data: sub } = await client
    .from("billing_subscriptions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("service_access_status", "scheduled_to_end")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub?.service_access_ends_at) return false;
  if (new Date(String(sub.service_access_ends_at)).getTime() > now.getTime()) return false;

  const { data: freeVersion } = await client
    .from("billing_plan_versions")
    .select("id, billing_plans!inner(code)")
    .eq("status", "published")
    .eq("billing_plans.code", "free")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const freeAnchor = floorToHour(now).toISOString();
  await client
    .from("billing_subscriptions")
    .update({
      service_access_status: "free",
      status: "cancelled",
      plan_slug: "free",
      plan_version_id: freeVersion?.id ?? null,
      updated_at: now.toISOString(),
    })
    .eq("id", sub.id);

  await client
    .from("workspaces")
    .update({
      plan_slug: "free",
      plan: "free",
      plan_version_id: freeVersion?.id ?? null,
      usage_clock_kind: "free",
      usage_anchor_at: freeAnchor,
      current_plan_started_at: now.toISOString(),
    })
    .eq("id", workspaceId);

  return true;
}

/**
 * Schedule downgrade: money at next renewal; WH at first usage boundary on/after renewal.
 */
export async function scheduleDowngrade(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    targetPlanCode: PlanCode;
    cadence: BillingCadence;
    actorUserId?: string | null;
    reason: string;
  },
): Promise<void> {
  const price = await getPublishedPrice(client, input.targetPlanCode, input.cadence);
  if (!price) throw new Error("Target plan price is not published.");

  const { data: sub, error } = await client
    .from("billing_subscriptions")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!sub) throw new Error("No subscription found.");

  const commercialAt = new Date(
    String(sub.current_period_end ?? addBillingPeriod(new Date(), input.cadence)),
  );

  const { data: workspace } = await client
    .from("workspaces")
    .select("usage_anchor_at")
    .eq("id", input.workspaceId)
    .maybeSingle();

  const usageAt = firstUsagePeriodStartOnOrAfter(
    workspace?.usage_anchor_at ?? commercialAt,
    commercialAt,
  );

  await client
    .from("billing_subscriptions")
    .update({
      pending_commercial_plan_version_id: price.planVersionId,
      pending_price_id: price.priceId,
      commercial_change_effective_at: commercialAt.toISOString(),
      pending_usage_plan_version_id: price.planVersionId,
      usage_change_effective_period_start: usageAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sub.id);

  await client.from("commerce_audit_events").insert({
    actor_user_id: input.actorUserId ?? null,
    action: "subscription_downgrade_scheduled",
    entity_type: "billing_subscription",
    entity_id: String(sub.id),
    reason: input.reason,
    payload: {
      targetPlanCode: input.targetPlanCode,
      commercialChangeEffectiveAt: commercialAt.toISOString(),
      usageChangeEffectivePeriodStart: usageAt.toISOString(),
    },
  });
}

/** Immediate upgrade entitlement + ledger adjustment; usage clock unchanged. */
export async function applyImmediateUpgradeEntitlements(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    subscriptionId: string;
    toPlanVersionId: string;
    toPriceId: string;
    toPlanSlug: PlanCode;
    cadence: BillingCadence;
  },
): Promise<void> {
  const oldVersionId = (
    await client
      .from("billing_subscriptions")
      .select("plan_version_id")
      .eq("id", input.subscriptionId)
      .maybeSingle()
  ).data?.plan_version_id;

  const oldVersion = oldVersionId
    ? await getPlanVersionById(client, String(oldVersionId))
    : null;
  const newVersion = await getPlanVersionById(client, input.toPlanVersionId);
  if (!newVersion) throw new Error("Target plan version not found.");

  const period = await ensureCurrentUsagePeriodGrant(client, input.workspaceId);

  await client
    .from("billing_subscriptions")
    .update({
      plan_slug: input.toPlanSlug,
      plan_version_id: input.toPlanVersionId,
      price_id: input.toPriceId,
      billing_cadence: input.cadence,
      service_access_status: "active",
      provider_status: "active",
      status: "active",
      pending_commercial_plan_version_id: null,
      pending_price_id: null,
      pending_usage_plan_version_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.subscriptionId);

  // Do not re-anchor usage clock on upgrade
  await client
    .from("workspaces")
    .update({
      plan_slug: input.toPlanSlug,
      plan: input.toPlanSlug,
      plan_version_id: input.toPlanVersionId,
      usage_clock_kind: "paid",
      current_plan_started_at: new Date().toISOString(),
    })
    .eq("id", input.workspaceId);

  await grantUpgradeAllowanceAdjustment(client, {
    workspaceId: input.workspaceId,
    usagePeriodId: period.periodId,
    periodKey: period.periodKey,
    subscriptionId: input.subscriptionId,
    toPlanVersionId: input.toPlanVersionId,
    oldWeekly: oldVersion?.weeklyIncludedWh ?? period.baseWhGranted,
    newWeekly: newVersion.weeklyIncludedWh,
  });
}

export async function markSubscriptionOverdue(
  client: SupabaseClient,
  workspaceId: string,
  providerSubscriptionId: string,
): Promise<void> {
  const graceEnds = new Date(Date.now() + PAYMENT_GRACE_MS).toISOString();
  await client
    .from("billing_subscriptions")
    .update({
      provider_status: "overdue",
      service_access_status: "grace",
      status: "past_due",
      grace_ends_at: graceEnds,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("external_subscription_id", providerSubscriptionId);

  await maybeIssuePastDueGraceWh(
    client,
    workspaceId,
    `${providerSubscriptionId}:${graceEnds.slice(0, 10)}`,
  );
}

export async function markSubscriptionReadOnlyIfGraceExpired(
  client: SupabaseClient,
  workspaceId: string,
  now = new Date(),
): Promise<boolean> {
  const { data: sub } = await client
    .from("billing_subscriptions")
    .select("id, grace_ends_at, service_access_status")
    .eq("workspace_id", workspaceId)
    .eq("service_access_status", "grace")
    .maybeSingle();
  if (!sub?.grace_ends_at) return false;
  if (new Date(String(sub.grace_ends_at)).getTime() > now.getTime()) return false;

  await client
    .from("billing_subscriptions")
    .update({
      service_access_status: "read_only",
      updated_at: now.toISOString(),
    })
    .eq("id", sub.id);
  return true;
}
