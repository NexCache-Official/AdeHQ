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

/** Get or lazily create the current usage period (Mon 00:00 UTC week, month-clipped). */
export async function getOrCreateCurrentPeriod(
  client: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceUsagePeriod> {
  const { startIso, endExclusiveIso } = getCurrentUsagePeriodRange(new Date());
  const { planSlug, allowance, unlimited } = await getWorkspaceAllowance(client, workspaceId);

  // Prefer exact match, then a range scan — some PostgREST/timestamptz
  // round-trips disagree on `.000Z` vs `+00:00` equality and would otherwise
  // invent a fresh zeroed period while the real counter sits unread.
  let existing = await client
    .from("workspace_usage_periods")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("period_start", startIso)
    .eq("period_end", endExclusiveIso)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (!existing.data) {
    const ranged = await client
      .from("workspace_usage_periods")
      .select("*")
      .eq("workspace_id", workspaceId)
      .gte("period_start", startIso)
      .lte("period_start", startIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ranged.error) throw ranged.error;
    if (ranged.data) existing = ranged;
  }
  if (!existing.data) {
    const active = await client
      .from("workspace_usage_periods")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (active.error) throw active.error;
    if (active.data) {
      const rowStart = String(active.data.period_start ?? "");
      const rowEnd = String(active.data.period_end ?? "");
      if (rowStart.startsWith(startIso.slice(0, 10)) && rowEnd.startsWith(endExclusiveIso.slice(0, 10))) {
        existing = active;
      }
    }
  }

  if (existing.data) {
    // Keep allowance in sync if the plan/credits changed mid-period.
    const current = rowToPeriod(existing.data, unlimited);
    if (Math.abs(current.allowance - allowance) > 0.0001 || current.planSlug !== planSlug) {
      const { data: updated, error: updateError } = await client
        .from("workspace_usage_periods")
        .update({ ai_work_hours_allowance: allowance, plan_slug: planSlug })
        .eq("id", current.id)
        .select("*")
        .single();
      if (updateError) throw updateError;
      return rowToPeriod(updated, unlimited);
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

  return rowToPeriod(inserted, unlimited);
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
}

export type CapacityCheck = {
  allowed: boolean;
  warningLevel: WorkspaceCapacity["warningLevel"];
  remaining: number;
  unlimited: boolean;
  reason?: string;
};

const AI_PAUSED_MESSAGE =
  "This workspace has used its AI Work Hours for this period, so AI employees are paused. Human messaging still works — they resume when the period resets (Mon 00:00 UTC, or month end), or upgrade for more capacity.";

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
  } catch {
    // Fail open: if usage tracking is unavailable, do not block AI work.
    return { allowed: true, warningLevel: "ok", remaining: UNLIMITED_ALLOWANCE, unlimited: true };
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
  const period = await getOrCreateCurrentPeriod(client, workspaceId);
  const remaining = period.unlimited ? UNLIMITED_ALLOWANCE : period.remaining;

  let warningLevel: WorkspaceCapacity["warningLevel"] = "ok";
  if (!period.unlimited) {
    if (remaining <= 0) warningLevel = "exhausted";
    else if (period.allowance > 0 && remaining <= period.allowance * LOW_WARNING_FRACTION) {
      warningLevel = "low";
    }
  }

  return {
    allowance: period.allowance,
    used: period.used,
    remaining,
    unlimited: period.unlimited,
    warningLevel,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    planSlug: period.planSlug,
    resetsAt: period.periodEnd,
  };
}
