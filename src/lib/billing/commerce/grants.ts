import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlanVersionById } from "./catalog";
import { appendLedgerEntry } from "./ledger";
import {
  getUsagePeriodForAnchor,
  usagePeriodIdempotencyKey,
} from "./usage-clock";
import { PAST_DUE_GRACE_WH, type ServiceAccessStatus } from "./types";

function shouldSkipPaidBaseGrant(
  usageClockKind: string | null | undefined,
  serviceAccess: ServiceAccessStatus,
  providerStatus: string | null | undefined,
): boolean {
  if (usageClockKind !== "paid") return false;
  if (serviceAccess === "scheduled_to_end" || serviceAccess === "active") return false;
  return (
    serviceAccess === "grace" ||
    serviceAccess === "read_only" ||
    providerStatus === "overdue"
  );
}

/**
 * Ensure current usage period exists and weekly base grant is posted (idempotent).
 * Skips new paid base grants when overdue/grace/read_only.
 */
export async function ensureCurrentUsagePeriodGrant(
  client: SupabaseClient,
  workspaceId: string,
  opts?: { now?: Date },
): Promise<{
  periodId: string;
  periodKey: string;
  baseWhGranted: number;
  skippedBaseGrant: boolean;
}> {
  const now = opts?.now ?? new Date();

  const { data: workspace, error: wsError } = await client
    .from("workspaces")
    .select(
      "usage_anchor_at, usage_clock_kind, plan_version_id, plan_slug, plan, free_plan_started_at, created_at, free_wh_eligible",
    )
    .eq("id", workspaceId)
    .maybeSingle();
  if (wsError) throw wsError;
  if (!workspace) throw new Error("Workspace not found.");

  const anchor =
    workspace.usage_anchor_at ??
    workspace.free_plan_started_at ??
    workspace.created_at ??
    now.toISOString();

  const { startedAt, endsAt, periodKey } = getUsagePeriodForAnchor(anchor, now);

  const { data: sub } = await client
    .from("billing_subscriptions")
    .select(
      "service_access_status, provider_status, plan_version_id, pending_usage_plan_version_id, usage_change_effective_period_start",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const serviceAccess = (sub?.service_access_status as ServiceAccessStatus | undefined) ?? "free";
  const skippedBaseGrant = shouldSkipPaidBaseGrant(
    workspace.usage_clock_kind,
    serviceAccess,
    sub?.provider_status ? String(sub.provider_status) : null,
  );

  let planVersionId =
    (sub?.plan_version_id as string | null) ??
    (workspace.plan_version_id as string | null);

  if (
    sub?.pending_usage_plan_version_id &&
    sub.usage_change_effective_period_start &&
    startedAt.getTime() >= new Date(String(sub.usage_change_effective_period_start)).getTime()
  ) {
    planVersionId = String(sub.pending_usage_plan_version_id);
  }

  const version = planVersionId
    ? await getPlanVersionById(client, planVersionId)
    : null;
  const planSlug =
    version?.planCode ??
    String(workspace.plan_slug ?? workspace.plan ?? "free").toLowerCase();

  const unlimited = version?.entitlements.unlimited_work_hours === true;
  const freeIneligible =
    (workspace.usage_clock_kind === "free" || serviceAccess === "free") &&
    workspace.free_wh_eligible === false;

  let baseWhGranted = unlimited ? 0 : (version?.weeklyIncludedWh ?? 10);
  if (freeIneligible || skippedBaseGrant) baseWhGranted = 0;

  const { data: existing } = await client
    .from("workspace_usage_periods")
    .select("id, base_wh_granted, ai_work_hours_allowance, plan_slug")
    .eq("workspace_id", workspaceId)
    .eq("period_key", periodKey)
    .maybeSingle();

  if (existing?.id) {
    // Mid-period upgrade: bump the open period so the UI doesn't keep showing
    // Free's 10 WH after a Pro checkout lands.
    const nextBase = unlimited ? Number(existing.base_wh_granted ?? 0) : baseWhGranted;
    const needsBump =
      String(existing.plan_slug ?? "") !== planSlug ||
      (!unlimited &&
        (Number(existing.base_wh_granted ?? 0) < nextBase ||
          Number(existing.ai_work_hours_allowance ?? 0) < nextBase));
    if (needsBump && !skippedBaseGrant) {
      await client
        .from("workspace_usage_periods")
        .update({
          plan_slug: planSlug,
          plan_version_id: planVersionId,
          base_wh_granted: Math.max(Number(existing.base_wh_granted ?? 0), nextBase),
          ai_work_hours_allowance: Math.max(
            Number(existing.ai_work_hours_allowance ?? 0),
            nextBase,
          ),
          status: "active",
          period_status: "active",
          entitlement_snapshot: version?.entitlements ?? {},
          updated_at: now.toISOString(),
        })
        .eq("id", existing.id);

      const delta =
        nextBase - Math.max(Number(existing.base_wh_granted ?? 0), 0);
      if (delta > 0) {
        await appendLedgerEntry(client, {
          workspaceId,
          entryType: "upgrade_allowance_adjustment",
          amountWh: delta,
          usagePeriodId: String(existing.id),
          idempotencyKey: `period-upgrade:${workspaceId}:${periodKey}:${planVersionId ?? planSlug}`,
          metadata: { periodKey, planVersionId, from: existing.base_wh_granted, to: nextBase },
        }).catch(() => undefined);
      }
    }

    return {
      periodId: String(existing.id),
      periodKey,
      baseWhGranted: Math.max(Number(existing.base_wh_granted ?? 0), nextBase),
      skippedBaseGrant,
    };
  }

  const { data: period, error: periodError } = await client
    .from("workspace_usage_periods")
    .insert({
      workspace_id: workspaceId,
      plan_slug: planSlug,
      period_type: "weekly",
      period_start: startedAt.toISOString(),
      period_end: endsAt.toISOString(),
      period_key: periodKey,
      plan_version_id: planVersionId,
      ai_work_hours_allowance: baseWhGranted,
      ai_work_hours_used: 0,
      base_wh_granted: baseWhGranted,
      promotional_wh_granted: 0,
      base_wh_used: 0,
      promotional_wh_used: 0,
      entitlement_snapshot: version?.entitlements ?? {},
      period_status: "active",
      status: "active",
    })
    .select("id")
    .single();

  if (periodError) {
    const again = await client
      .from("workspace_usage_periods")
      .select("id, base_wh_granted")
      .eq("workspace_id", workspaceId)
      .eq("period_key", periodKey)
      .maybeSingle();
    if (again.data) {
      return {
        periodId: String(again.data.id),
        periodKey,
        baseWhGranted: Number(again.data.base_wh_granted ?? 0),
        skippedBaseGrant,
      };
    }
    throw periodError;
  }

  if (baseWhGranted > 0) {
    await appendLedgerEntry(client, {
      workspaceId,
      entryType: "weekly_base_grant",
      amountWh: baseWhGranted,
      usagePeriodId: String(period.id),
      idempotencyKey: usagePeriodIdempotencyKey(workspaceId, startedAt),
      metadata: { periodKey, planVersionId },
    });
  }

  return {
    periodId: String(period.id),
    periodKey,
    baseWhGranted,
    skippedBaseGrant,
  };
}

/** Issue one past-due grace lot per delinquency episode. */
export async function maybeIssuePastDueGraceWh(
  client: SupabaseClient,
  workspaceId: string,
  delinquencyKey: string,
): Promise<boolean> {
  const idempotencyKey = `past-due-grace:${workspaceId}:${delinquencyKey}`;
  const { duplicate } = await appendLedgerEntry(client, {
    workspaceId,
    entryType: "past_due_grace_grant",
    amountWh: PAST_DUE_GRACE_WH,
    idempotencyKey,
    reason: "Past-due grace Work Hours",
  });
  if (duplicate) return false;

  await client.from("wh_credit_lots").insert({
    workspace_id: workspaceId,
    lot_type: "past_due_grace",
    amount_wh: PAST_DUE_GRACE_WH,
    remaining_wh: PAST_DUE_GRACE_WH,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    metadata: { delinquencyKey },
  });
  return true;
}

/** Ledger adjustment when upgrading mid-period (period snapshot stays immutable). */
export async function grantUpgradeAllowanceAdjustment(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    usagePeriodId: string;
    periodKey: string;
    subscriptionId: string;
    toPlanVersionId: string;
    oldWeekly: number;
    newWeekly: number;
  },
): Promise<number> {
  const delta = Math.max(0, input.newWeekly - input.oldWeekly);
  if (delta <= 0) return 0;
  await appendLedgerEntry(client, {
    workspaceId: input.workspaceId,
    entryType: "upgrade_allowance_adjustment",
    amountWh: delta,
    usagePeriodId: input.usagePeriodId,
    idempotencyKey: `upgrade-adjust:${input.subscriptionId}:${input.periodKey}:${input.toPlanVersionId}`,
    metadata: { oldWeekly: input.oldWeekly, newWeekly: input.newWeekly },
  });
  return delta;
}
