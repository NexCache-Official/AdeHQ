import type { SupabaseClient } from "@supabase/supabase-js";
import { floorToHour } from "./usage-clock";

/**
 * PR-20G dual-read verification helpers for production cutover.
 * Ensures workspaces have usage anchors + plan_version pins.
 */
export async function backfillCommerceAnchors(
  client: SupabaseClient,
  limit = 500,
): Promise<{ updated: number }> {
  const { data: rows, error } = await client
    .from("workspaces")
    .select(
      "id, usage_anchor_at, plan_version_id, plan_slug, plan, free_plan_started_at, created_at, current_plan_started_at",
    )
    .is("usage_anchor_at", null)
    .limit(limit);
  if (error) throw error;

  let updated = 0;
  for (const row of rows ?? []) {
    const planCode = String(row.plan_slug ?? row.plan ?? "free").toLowerCase();
    const paid = !["free", "founder", ""].includes(planCode);
    const anchorSource = paid
      ? row.current_plan_started_at ?? row.created_at
      : row.free_plan_started_at ?? row.created_at;
    const usageAnchor = floorToHour(String(anchorSource ?? new Date().toISOString())).toISOString();

    let planVersionId = row.plan_version_id as string | null;
    if (!planVersionId) {
      const { data: version } = await client
        .from("billing_plan_versions")
        .select("id, billing_plans!inner(code)")
        .eq("status", "published")
        .eq("billing_plans.code", planCode === "founder" ? "free" : planCode)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      planVersionId = version?.id ?? null;
    }

    const { error: updError } = await client
      .from("workspaces")
      .update({
        usage_anchor_at: usageAnchor,
        usage_clock_kind: paid ? "paid" : "free",
        plan_version_id: planVersionId,
      })
      .eq("id", row.id);
    if (!updError) updated += 1;
  }
  return { updated };
}

export async function verifyCommerceDualRead(
  client: SupabaseClient,
): Promise<{
  workspacesMissingAnchor: number;
  workspacesMissingPlanVersion: number;
  legacyManualRenew: number;
  publishedPricesMissingVariation: number;
}> {
  const [anchors, versions, legacy, prices] = await Promise.all([
    client
      .from("workspaces")
      .select("id", { count: "exact", head: true })
      .is("usage_anchor_at", null),
    client
      .from("workspaces")
      .select("id", { count: "exact", head: true })
      .is("plan_version_id", null),
    client
      .from("billing_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("legacy_manual_renew", true)
      .in("status", ["active", "trialing", "manual", "comped"]),
    client
      .from("billing_prices")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .eq("sync_status", "published")
      .gt("amount_minor", 0)
      .is("revolut_variation_id", null),
  ]);

  return {
    workspacesMissingAnchor: anchors.count ?? 0,
    workspacesMissingPlanVersion: versions.count ?? 0,
    legacyManualRenew: legacy.count ?? 0,
    publishedPricesMissingVariation: prices.count ?? 0,
  };
}
