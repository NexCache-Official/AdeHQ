import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUsagePeriodRange } from "@/lib/ai/work-hours/periods";
import { resolveWorkspacePlan } from "@/lib/billing/plans/resolve-workspace-plan";

/** Sentinel allowance for plans with unlimited weekly Work Hours (enterprise/custom). */
export const UNLIMITED_ALLOWANCE = 1_000_000;

/** Fraction of remaining allowance below which we warn the workspace. */
const LOW_WARNING_FRACTION = 0.1;

export type WorkspaceUsagePeriod = {
  id: string;
  workspaceId: string;
  planSlug: string;
  periodStart: string;
  periodEnd: string;
  allowance: number;
  used: number;
  remaining: number;
  actualCostUsd: number;
  unlimited: boolean;
};

export type WorkspaceCapacity = {
  allowance: number;
  used: number;
  remaining: number;
  unlimited: boolean;
  warningLevel: "ok" | "low" | "exhausted";
  periodStart: string;
  periodEnd: string;
  planSlug: string;
  resetsAt: string;
};

/** Sum unexpired work-hour credit grants for a workspace. */
async function sumActiveCreditGrants(
  client: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from("usage_credit_grants")
    .select("amount, expires_at, credit_type")
    .eq("workspace_id", workspaceId)
    .eq("credit_type", "work_hours");
  if (error) {
    // Missing table or transient error: treat as no credits rather than blocking usage.
    return 0;
  }
  let total = 0;
  for (const row of data ?? []) {
    const expiresAt = row.expires_at ? Date.parse(String(row.expires_at)) : null;
    if (expiresAt != null && Number.isFinite(expiresAt) && expiresAt <= Date.parse(nowIso)) {
      continue;
    }
    const amount = Number(row.amount);
    if (Number.isFinite(amount) && amount > 0) total += amount;
  }
  return total;
}

/** Sum weekly extra Work Hours from active promo code redemptions for a workspace. */
async function sumActivePromoWorkHours(
  client: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  try {
    const { data, error } = await client
      .from("promo_code_redemptions")
      .select("promo_codes(active, expires_at, extra_work_hours_per_week)")
      .eq("workspace_id", workspaceId);
    if (error || !data) return 0;
    const now = Date.now();
    let total = 0;
    for (const row of data as Array<{ promo_codes: unknown }>) {
      const promo = Array.isArray(row.promo_codes) ? row.promo_codes[0] : row.promo_codes;
      if (!promo || typeof promo !== "object") continue;
      const p = promo as { active?: boolean; expires_at?: string | null; extra_work_hours_per_week?: number | null };
      if (!p.active) continue;
      if (p.expires_at && Date.parse(p.expires_at) <= now) continue;
      const extra = Number(p.extra_work_hours_per_week);
      if (Number.isFinite(extra) && extra > 0) total += extra;
    }
    return total;
  } catch {
    return 0;
  }
}

/**
 * Compute the weekly AI Work Hours allowance for a workspace:
 * base plan (or override) + active work-hour credit grants + active promo extras.
 */
export async function getWorkspaceAllowance(
  client: SupabaseClient,
  workspaceId: string,
): Promise<{ planSlug: string; allowance: number; unlimited: boolean }> {
  const plan = await resolveWorkspacePlan(client, workspaceId);
  if (plan.unlimitedWorkHours) {
    return { planSlug: plan.planSlug, allowance: UNLIMITED_ALLOWANCE, unlimited: true };
  }
  const [credits, promoExtras] = await Promise.all([
    sumActiveCreditGrants(client, workspaceId),
    sumActivePromoWorkHours(client, workspaceId),
  ]);
  return {
    planSlug: plan.planSlug,
    allowance: plan.weeklyWorkHoursBase + credits + promoExtras,
    unlimited: false,
  };
}

function rowToPeriod(row: Record<string, unknown>, unlimited: boolean): WorkspaceUsagePeriod {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    planSlug: String(row.plan_slug),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    allowance: Number(row.ai_work_hours_allowance ?? 0),
    used: Number(row.ai_work_hours_used ?? 0),
    remaining: Number(row.ai_work_hours_remaining ?? 0),
    actualCostUsd: Number(row.actual_cost_usd ?? 0),
    unlimited,
  };
}

/** Retire every active usage period except `keepPeriodId` (mid-upgrade hygiene). */
async function retireOtherActivePeriods(
  client: SupabaseClient,
  workspaceId: string,
  keepPeriodId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await client
    .from("workspace_usage_periods")
    .update({
      status: "closed",
      period_status: "closed",
      updated_at: now,
    })
    .eq("workspace_id", workspaceId)
    .neq("id", keepPeriodId)
    .eq("status", "active");
}

/** Get or lazily create the current usage period.
 * Prefers activation-anchored 168h commerce clock when usage_anchor_at is set;
 * falls back to legacy Monday-UTC week for workspaces not yet migrated.
 */
export async function getOrCreateCurrentPeriod(
  client: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceUsagePeriod> {
  const { data: wsClock } = await client
    .from("workspaces")
    .select("usage_anchor_at")
    .eq("id", workspaceId)
    .maybeSingle();

  if (wsClock?.usage_anchor_at) {
    try {
      const { ensureCurrentUsagePeriodGrant } = await import(
        "@/lib/billing/commerce/grants"
      );
      const { sumCreditLotRemaining } = await import("@/lib/billing/commerce/ledger");
      const grant = await ensureCurrentUsagePeriodGrant(client, workspaceId);
      const { planSlug, allowance, unlimited } = await getWorkspaceAllowance(
        client,
        workspaceId,
      );
      const { data: row } = await client
        .from("workspace_usage_periods")
        .select("*")
        .eq("id", grant.periodId)
        .maybeSingle();
      if (row) {
        const lots = await sumCreditLotRemaining(client, workspaceId).catch(() => 0);
        const baseAllowance = Number(row.base_wh_granted ?? row.ai_work_hours_allowance ?? 0);
        const promo = Number(row.promotional_wh_granted ?? 0);
        const effectiveAllowance = unlimited
          ? UNLIMITED_ALLOWANCE
          : Math.max(allowance, baseAllowance + promo + lots);
        // Keep legacy allowance column + plan slug aligned with the live resolved plan.
        // Also bump base_wh_granted on upgrade so mid-period Pro activations aren't stuck
        // reading a Free-period row that somehow got selected earlier.
        const needsSync =
          Math.abs(Number(row.ai_work_hours_allowance) - effectiveAllowance) > 0.0001 ||
          String(row.plan_slug) !== planSlug ||
          (!unlimited && Number(row.base_wh_granted ?? 0) < allowance);
        if (needsSync) {
          await client
            .from("workspace_usage_periods")
            .update({
              ai_work_hours_allowance: effectiveAllowance,
              base_wh_granted: unlimited
                ? Number(row.base_wh_granted ?? 0)
                : Math.max(Number(row.base_wh_granted ?? 0), allowance),
              plan_slug: planSlug,
              status: "active",
              period_status: "active",
              updated_at: new Date().toISOString(),
            })
            .eq("id", grant.periodId);
          const refreshed = await client
            .from("workspace_usage_periods")
            .select("*")
            .eq("id", grant.periodId)
            .single();
          await retireOtherActivePeriods(client, workspaceId, grant.periodId).catch(() => undefined);
          if (refreshed.data) return rowToPeriod(refreshed.data, unlimited);
        }
        await retireOtherActivePeriods(client, workspaceId, grant.periodId).catch(() => undefined);
        return rowToPeriod(
          {
            ...row,
            plan_slug: planSlug,
            ai_work_hours_allowance: effectiveAllowance,
          },
          unlimited,
        );
      }
    } catch (err) {
      console.error("[usage.periods] commerce clock failed; falling back", err);
      // Last resort while still on the commerce clock: prefer the newest overlapping
      // active period for this workspace rather than the legacy Monday-UTC Free row.
      try {
        const { planSlug, allowance, unlimited } = await getWorkspaceAllowance(
          client,
          workspaceId,
        );
        const nowIso = new Date().toISOString();
        const { data: overlapping } = await client
          .from("workspace_usage_periods")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("status", "active")
          .lte("period_start", nowIso)
          .gt("period_end", nowIso)
          .order("period_start", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (overlapping) {
          const effectiveAllowance = unlimited
            ? UNLIMITED_ALLOWANCE
            : Math.max(allowance, Number(overlapping.ai_work_hours_allowance ?? 0));
          if (
            String(overlapping.plan_slug) !== planSlug ||
            Math.abs(Number(overlapping.ai_work_hours_allowance) - effectiveAllowance) > 0.0001
          ) {
            await client
              .from("workspace_usage_periods")
              .update({
                plan_slug: planSlug,
                ai_work_hours_allowance: effectiveAllowance,
                updated_at: new Date().toISOString(),
              })
              .eq("id", overlapping.id);
          }
          await retireOtherActivePeriods(client, workspaceId, String(overlapping.id)).catch(
            () => undefined,
          );
          return rowToPeriod(
            {
              ...overlapping,
              plan_slug: planSlug,
              ai_work_hours_allowance: effectiveAllowance,
            },
            unlimited,
          );
        }
      } catch (fallbackErr) {
        console.error("[usage.periods] commerce overlap fallback failed", fallbackErr);
      }
    }
  }

  const { startIso, endExclusiveIso } = getCurrentUsagePeriodRange(new Date());
  const { planSlug, allowance, unlimited } = await getWorkspaceAllowance(client, workspaceId);

  // Prefer exact match on *active* rows only — closed Free periods from before an
  // upgrade must never be revived (that was pinning meters at 10 WH after Pro checkout).
  let existing = await client
    .from("workspace_usage_periods")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .eq("period_start", startIso)
    .eq("period_end", endExclusiveIso)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (!existing.data) {
    const ranged = await client
      .from("workspace_usage_periods")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .gte("period_start", startIso)
      .lte("period_start", startIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ranged.error) throw ranged.error;
    if (ranged.data) existing = ranged;
  }
  if (!existing.data) {
    const nowIso = new Date().toISOString();
    const active = await client
      .from("workspace_usage_periods")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .lte("period_start", nowIso)
      .gt("period_end", nowIso)
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (active.error) throw active.error;
    if (active.data) existing = active;
  }

  if (existing.data) {
    // Keep allowance in sync if the plan/credits changed mid-period.
    const current = rowToPeriod(existing.data, unlimited);
    if (Math.abs(current.allowance - allowance) > 0.0001 || current.planSlug !== planSlug) {
      const previousAllowance = current.allowance;
      const { data: updated, error: updateError } = await client
        .from("workspace_usage_periods")
        .update({ ai_work_hours_allowance: allowance, plan_slug: planSlug })
        .eq("id", current.id)
        .select("*")
        .single();
      if (updateError) throw updateError;
      const period = rowToPeriod(updated, unlimited);
      // Only restore when capacity grew (upgrade / credits), not on every read.
      if (period.unlimited || (allowance > previousAllowance && period.remaining > 0)) {
        const { restoreWorkforceFromOffline } = await import("./workforce-capacity");
        await restoreWorkforceFromOffline(client, workspaceId).catch(() => undefined);
      }
      return period;
    }
    return current;
  }

  const { data: inserted, error: insertError } = await client
    .from("workspace_usage_periods")
    .insert({
      workspace_id: workspaceId,
      plan_slug: planSlug,
      period_type: "weekly",
      period_start: startIso,
      period_end: endExclusiveIso,
      ai_work_hours_allowance: allowance,
    })
    .select("*")
    .single();

  // Handle race: another request created the period first.
  if (insertError) {
    if (String((insertError as { code?: string }).code) === "23505") {
      const retry = await client
        .from("workspace_usage_periods")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("period_start", startIso)
        .eq("period_end", endExclusiveIso)
        .single();
      if (retry.error) throw retry.error;
      return rowToPeriod(retry.data, unlimited);
    }
    throw insertError;
  }

  const created = rowToPeriod(inserted, unlimited);
  if (created.unlimited || created.remaining > 0) {
    const { restoreWorkforceFromOffline } = await import("./workforce-capacity");
    await restoreWorkforceFromOffline(client, workspaceId).catch(() => undefined);
  }
  return created;
}

/** Increment the current period's used Work Hours + actual cost (billable events only). */
export async function applyCostToPeriod(
  client: SupabaseClient,
  workspaceId: string,
  workHoursCharged: number,
  actualCostUsd: number,
): Promise<void> {
  if (workHoursCharged <= 0 && actualCostUsd <= 0) return;
  const period = await getOrCreateCurrentPeriod(client, workspaceId);
  const { error } = await client.rpc("increment_workspace_usage_period", {
    p_period_id: period.id,
    p_work_hours: workHoursCharged,
    p_cost_usd: actualCostUsd,
  });
  if (error) throw error;

  // Overage is allowed and counted; once used crosses allowance, take workforce offline.
  try {
    const capacity = await getWorkspaceCapacity(client, workspaceId);
    const { syncWorkforceToCapacity } = await import("./workforce-capacity");
    await syncWorkforceToCapacity(client, workspaceId, {
      used: capacity.used,
      allowance: capacity.allowance,
      unlimited: capacity.unlimited,
    });
  } catch (syncError) {
    console.warn("[AdeHQ usage] workforce capacity sync failed", syncError);
  }
}

export type CapacityCheck = {
  allowed: boolean;
  warningLevel: WorkspaceCapacity["warningLevel"];
  remaining: number;
  unlimited: boolean;
  reason?: string;
};

const AI_PAUSED_MESSAGE =
  "This workspace has used its AI Work Hours for this period, so AI employees are paused. Human messaging still works — they resume when the usage period resets, or upgrade for more capacity.";

/**
 * Enforcement gate for user-visible AI work. Blocks when period Work Hours are exhausted.
 * Human messaging and low-cost internal maintenance are never routed through this.
 */
export async function checkWorkspaceAiCapacity(
  client: SupabaseClient,
  workspaceId: string,
): Promise<CapacityCheck> {
  let capacity: WorkspaceCapacity;
  try {
    capacity = await getWorkspaceCapacity(client, workspaceId);
  } catch (error) {
    console.error("[AdeHQ usage] capacity check failed closed", {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      allowed: false,
      warningLevel: "exhausted",
      remaining: 0,
      unlimited: false,
      reason: "AI work is temporarily paused while usage capacity is verified.",
    };
  }

  if (capacity.unlimited) {
    return { allowed: true, warningLevel: "ok", remaining: capacity.remaining, unlimited: true };
  }

  const exhausted = capacity.warningLevel === "exhausted" || capacity.remaining <= 0;
  return {
    allowed: !exhausted,
    warningLevel: capacity.warningLevel,
    remaining: capacity.remaining,
    unlimited: false,
    reason: exhausted ? AI_PAUSED_MESSAGE : undefined,
  };
}

/** Current capacity snapshot for enforcement + customer display. */
export async function getWorkspaceCapacity(
  client: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceCapacity> {
  const [period, resolved] = await Promise.all([
    getOrCreateCurrentPeriod(client, workspaceId),
    getWorkspaceAllowance(client, workspaceId),
  ]);

  // Live plan is the source of truth for allowance / plan label. Period rows can
  // lag after checkout (stale Free periods left "active") and must not pin the UI
  // to 10 WH while the workspace is already Pro.
  const unlimited = resolved.unlimited || period.unlimited;
  const allowance = unlimited
    ? UNLIMITED_ALLOWANCE
    : Math.max(resolved.allowance, period.allowance);
  const used = period.used;
  const remaining = unlimited
    ? UNLIMITED_ALLOWANCE
    : Math.max(0, Math.round((allowance - used) * 10000) / 10000);

  let warningLevel: WorkspaceCapacity["warningLevel"] = "ok";
  if (!unlimited) {
    if (remaining <= 0) warningLevel = "exhausted";
    else if (allowance > 0 && remaining <= allowance * LOW_WARNING_FRACTION) {
      warningLevel = "low";
    }
  }

  // Never let a stale "free" resolve mask a paid period row (or vice versa).
  // Prefer the higher commercial tier between live resolve and the open period.
  const PLAN_TIER: Record<string, number> = {
    free: 0,
    pro: 1,
    team: 2,
    business: 3,
    enterprise: 4,
  };
  const resolvedSlug = (resolved.planSlug || "free").toLowerCase();
  const periodSlug = (period.planSlug || "free").toLowerCase();
  const planSlug =
    (PLAN_TIER[resolvedSlug] ?? 0) >= (PLAN_TIER[periodSlug] ?? 0)
      ? resolvedSlug
      : periodSlug;

  return {
    allowance,
    used,
    remaining,
    unlimited,
    warningLevel,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    planSlug,
    resetsAt: period.periodEnd,
  };
}
