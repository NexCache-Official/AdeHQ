import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/admin/audit";
import { writeCommerceAudit } from "@/lib/billing/commerce/rbac";
import { PLAN_ENTITLEMENT_MATRIX_V1 } from "@/lib/billing/commerce/entitlement-matrix";
import type { PlanCode, PlanEntitlements } from "@/lib/billing/commerce/types";
import { syncPriceToRevolut } from "@/lib/billing/revolut/provider-sync";
import type { NextRequest } from "next/server";

export type PlanPublishUpdates = {
  display_name?: string;
  monthly_price_cents?: number;
  annual_price_cents?: number;
  trial_days?: number;
  is_active?: boolean;
  weekly_work_hours?: number;
  max_ai_employees?: number | null;
  max_members?: number | null;
  max_workspaces?: number | null;
  max_rooms?: number | null;
  max_topics?: number | null;
  max_storage_bytes?: number | null;
  max_browser_runs_per_week?: number | null;
  max_file_upload_mb?: number | null;
  allowed_intelligence_tiers?: string[];
  browser_research_enabled?: boolean;
  gateway_search_enabled?: boolean;
  custom_ai_employees_enabled?: boolean;
  team_features_enabled?: boolean;
  admin_controls_enabled?: boolean;
  priority_support?: boolean;
  human_members_unlimited?: boolean;
  ai_employees_unlimited?: boolean;
  entitlements?: Record<string, unknown>;
};

export type PlanPublishResult = {
  ok: true;
  plan: Record<string, unknown>;
  planVersionId: string | null;
  priceIds: string[];
  revolutSync: Array<{ priceId: string; ok: boolean; error?: string }>;
  notes: string[];
};

function isPlanCode(slug: string): slug is PlanCode {
  return ["free", "pro", "team", "business", "enterprise"].includes(slug);
}

function entitlementsFromConfig(
  slug: string,
  merged: Record<string, unknown>,
): PlanEntitlements {
  const base =
    isPlanCode(slug) && slug !== "enterprise"
      ? { ...PLAN_ENTITLEMENT_MATRIX_V1[slug] }
      : {
          weeklyWh: Number(merged.weekly_work_hours ?? 0),
          searchEnabled: Boolean(merged.gateway_search_enabled ?? true),
          browserEnabled: Boolean(merged.browser_research_enabled ?? true),
          voiceEnabled: true,
          imageEnabled: true,
          videoEnabled: slug !== "free",
          videoRequiresApproval: slug !== "business" && slug !== "enterprise",
          maxConcurrentRuns: 3,
          maxStewardCollaborators: 2,
          maxStewardSteps: 12,
          maxAutomaticRunWh: 40,
          sharedMemoryEnabled: true,
          memoryRetentionDays: 90,
          artifactStorageBytes: Number(merged.max_storage_bytes ?? 1_073_741_824),
          usageDashboardLevel: "team" as const,
          adminControlsLevel: merged.admin_controls_enabled ? ("advanced" as const) : ("basic" as const),
          supportLevel: merged.priority_support ? ("priority" as const) : ("standard" as const),
          intelligencePolicy: "balanced" as const,
          humanMembersUnlimited: Boolean(merged.human_members_unlimited ?? true),
          aiEmployeesUnlimited: Boolean(merged.ai_employees_unlimited ?? true),
        };

  return {
    ...base,
    weeklyWh: Number(merged.weekly_work_hours ?? base.weeklyWh),
    searchEnabled: Boolean(merged.gateway_search_enabled ?? base.searchEnabled),
    browserEnabled: Boolean(merged.browser_research_enabled ?? base.browserEnabled),
    supportLevel: merged.priority_support ? "priority" : base.supportLevel,
    adminControlsLevel: merged.admin_controls_enabled
      ? "advanced"
      : base.adminControlsLevel,
    humanMembersUnlimited: Boolean(
      merged.human_members_unlimited ?? base.humanMembersUnlimited,
    ),
    aiEmployeesUnlimited: Boolean(
      merged.ai_employees_unlimited ?? base.aiEmployeesUnlimited,
    ),
    artifactStorageBytes: Number(
      merged.max_storage_bytes ?? base.artifactStorageBytes,
    ),
    unlimited_work_hours:
      slug === "enterprise" || Number(merged.weekly_work_hours ?? 0) <= 0,
  };
}

/**
 * Dual-write plan edits so customer surfaces update immediately:
 * 1) platform_plan_configs (entitlements / MRR / settings)
 * 2) new billing_plan_versions + billing_prices (public catalog / checkout)
 * 3) best-effort Revolut sync for paid prices
 */
export async function publishPlanEdit(
  client: SupabaseClient,
  input: {
    planSlug: string;
    updates: PlanPublishUpdates;
    adminUserId: string;
    reason?: string;
    request?: NextRequest;
  },
): Promise<PlanPublishResult> {
  const planSlug = input.planSlug.trim();
  if (!planSlug) throw new Error("planSlug is required.");

  const { data: before, error: readError } = await client
    .from("platform_plan_configs")
    .select("*")
    .eq("plan_slug", planSlug)
    .maybeSingle();
  if (readError) throw readError;
  if (!before) throw new Error(`Unknown plan: ${planSlug}`);

  const updates: Record<string, unknown> = { ...input.updates };
  if (Object.keys(updates).length === 0) {
    throw new Error("No editable fields provided.");
  }

  const { data: after, error: updateError } = await client
    .from("platform_plan_configs")
    .update(updates)
    .eq("plan_slug", planSlug)
    .select("*")
    .single();
  if (updateError) throw updateError;

  await writeAuditLog(client, {
    adminUserId: input.adminUserId,
    action: "plan_config_updated",
    targetType: "platform_plan_config",
    targetId: planSlug,
    before,
    after,
    reason: input.reason,
    request: input.request,
  });

  const notes: string[] = [
    "Entitlements projection updated (platform_plan_configs).",
    "New checkouts and marketing use the published catalog.",
    "Existing paid subscribers keep their current provider price until renewal.",
  ];

  let planVersionId: string | null = null;
  const priceIds: string[] = [];
  const revolutSync: PlanPublishResult["revolutSync"] = [];

  if (!isPlanCode(planSlug)) {
    notes.push("Skipped versioned catalog (slug not in billing_plans codes).");
    return {
      ok: true,
      plan: after as Record<string, unknown>,
      planVersionId,
      priceIds,
      revolutSync,
      notes,
    };
  }

  const { data: billingPlan, error: planErr } = await client
    .from("billing_plans")
    .select("id, code")
    .eq("code", planSlug)
    .maybeSingle();
  if (planErr) throw planErr;

  if (!billingPlan) {
    notes.push("No billing_plans row — catalog version not created.");
    return {
      ok: true,
      plan: after as Record<string, unknown>,
      planVersionId,
      priceIds,
      revolutSync,
      notes,
    };
  }

  const { data: latestVersion } = await client
    .from("billing_plan_versions")
    .select("id, version, eyebrow, description, feature_bullets, visibility")
    .eq("plan_id", billingPlan.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = Number(latestVersion?.version ?? 0) + 1;
  const publicName = String(after.display_name ?? planSlug);
  const weeklyWh = Number(after.weekly_work_hours ?? 0);
  const entitlements = entitlementsFromConfig(planSlug, after as Record<string, unknown>);
  const visibility =
    planSlug === "enterprise"
      ? "enterprise_contract"
      : after.is_active === false
        ? "invite_only"
        : (latestVersion?.visibility ?? "public");

  // Retire prior published versions for this plan (grandfathered checkouts keep snapshots).
  if (latestVersion?.id) {
    await client
      .from("billing_plan_versions")
      .update({ status: "retired", updated_at: new Date().toISOString() })
      .eq("plan_id", billingPlan.id)
      .eq("status", "published");

    await client
      .from("billing_prices")
      .update({ status: "retired", sync_status: "retired", updated_at: new Date().toISOString() })
      .eq("plan_version_id", latestVersion.id)
      .eq("status", "active");
  }

  const { data: newVersion, error: versionErr } = await client
    .from("billing_plan_versions")
    .insert({
      plan_id: billingPlan.id,
      version: nextVersion,
      public_name: publicName,
      eyebrow: latestVersion?.eyebrow ?? "",
      description: latestVersion?.description ?? "",
      feature_bullets: latestVersion?.feature_bullets ?? [],
      weekly_included_wh: weeklyWh,
      entitlements,
      visibility,
      status: "published",
      published_at: new Date().toISOString(),
      created_by: input.adminUserId,
      approved_by: input.adminUserId,
      migration_policy: "migrate_at_renewal",
    })
    .select("id, version")
    .single();
  if (versionErr) throw versionErr;
  planVersionId = newVersion.id;

  // Carry Revolut mappings from previous prices when amounts are unchanged.
  const { data: oldPrices } = latestVersion?.id
    ? await client
        .from("billing_prices")
        .select(
          "cadence, currency, amount_minor, revolut_plan_id, revolut_variation_id, provider_ref",
        )
        .eq("plan_version_id", latestVersion.id)
    : { data: [] as Array<Record<string, unknown>> };

  const oldByCadence = new Map(
    (oldPrices ?? []).map((p) => [`${p.currency}:${p.cadence}`, p]),
  );

  const monthlyCents = Number(after.monthly_price_cents ?? 0);
  const annualCents = Number(after.annual_price_cents ?? 0);
  const currency = "USD";

  for (const cadence of ["monthly", "annual"] as const) {
    const amount = cadence === "monthly" ? monthlyCents : annualCents;
    // Enterprise custom may have 0 — still publish a row for catalog completeness.
    const prev = oldByCadence.get(`${currency}:${cadence}`);
    const amountUnchanged =
      prev && Number(prev.amount_minor) === amount && amount >= 0;

    const { data: priceRow, error: priceErr } = await client
      .from("billing_prices")
      .insert({
        plan_version_id: newVersion.id,
        currency,
        cadence,
        amount_minor: amount,
        status: "active",
        // Live for marketing immediately; Revolut sync fills variation when needed.
        sync_status: "published",
        revolut_plan_id: amountUnchanged ? prev?.revolut_plan_id ?? null : null,
        revolut_variation_id: amountUnchanged
          ? prev?.revolut_variation_id ?? null
          : null,
        provider_ref: amountUnchanged ? prev?.provider_ref ?? null : null,
        verified_at: amountUnchanged || amount === 0 ? new Date().toISOString() : null,
      })
      .select("id, amount_minor")
      .single();
    if (priceErr) throw priceErr;
    priceIds.push(priceRow.id);

    const needsSync =
      amount > 0 &&
      (!amountUnchanged || !prev?.revolut_variation_id);
    if (needsSync) {
      try {
        const sync = await syncPriceToRevolut(client, priceRow.id);
        revolutSync.push({
          priceId: priceRow.id,
          ok: sync.ok,
          error: sync.error,
        });
        // Ensure catalog stays selectable even if sync is mid-flight.
        if (sync.ok) {
          await client
            .from("billing_prices")
            .update({
              status: "active",
              sync_status: "published",
              verified_at: new Date().toISOString(),
            })
            .eq("id", priceRow.id);
        } else {
          await client
            .from("billing_prices")
            .update({ status: "active", sync_status: "published" })
            .eq("id", priceRow.id);
          notes.push(
            `${cadence} Revolut sync pending/failed — list price is live; checkout needs sync (${sync.error ?? "unknown"}).`,
          );
        }
      } catch (err) {
        revolutSync.push({
          priceId: priceRow.id,
          ok: false,
          error: err instanceof Error ? err.message : "sync failed",
        });
        await client
          .from("billing_prices")
          .update({ status: "active", sync_status: "published" })
          .eq("id", priceRow.id);
      }
    } else {
      revolutSync.push({ priceId: priceRow.id, ok: true });
    }
  }

  notes.push(`Published catalog version v${nextVersion}.`);

  await writeCommerceAudit(client, {
    actorUserId: input.adminUserId,
    action: "publish_plan_edit",
    entityType: "billing_plan",
    entityId: planSlug,
    reason: input.reason,
    payload: {
      beforePrices: {
        monthly: before.monthly_price_cents,
        annual: before.annual_price_cents,
        weeklyWh: before.weekly_work_hours,
      },
      afterPrices: {
        monthly: after.monthly_price_cents,
        annual: after.annual_price_cents,
        weeklyWh: after.weekly_work_hours,
      },
      planVersionId,
      priceIds,
      revolutSync,
    },
  });

  return {
    ok: true,
    plan: after as Record<string, unknown>,
    planVersionId,
    priceIds,
    revolutSync,
    notes,
  };
}
