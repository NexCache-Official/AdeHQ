import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { assertPlatformAdminCanWrite } from "@/lib/admin/require-platform-admin";
import { writeAuditLog } from "@/lib/admin/audit";
import {
  ensureBillingPlanIdentity,
  publishPlanEdit,
} from "@/lib/billing/commerce/publish-plan-edit";
import { getPricingPageCatalog } from "@/lib/billing/commerce/catalog";
import { isValidPlanSlug } from "@/lib/billing/commerce/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE_FIELDS = [
  "display_name",
  "monthly_price_cents",
  "annual_price_cents",
  "trial_days",
  "is_active",
  "weekly_work_hours",
  "max_ai_employees",
  "max_members",
  "max_workspaces",
  "max_rooms",
  "max_topics",
  "max_storage_bytes",
  "max_browser_runs_per_week",
  "max_file_upload_mb",
  "allowed_intelligence_tiers",
  "browser_research_enabled",
  "gateway_search_enabled",
  "custom_ai_employees_enabled",
  "team_features_enabled",
  "admin_controls_enabled",
  "priority_support",
  "human_members_unlimited",
  "ai_employees_unlimited",
  "entitlements",
] as const;

export const GET = adminRoute(async (_request, { serviceClient }) => {
  const [{ data, error }, catalog, versionsRes, pricesRes] = await Promise.all([
    serviceClient.from("platform_plan_configs").select("*").order("monthly_price_cents"),
    getPricingPageCatalog(serviceClient).catch(() => []),
    serviceClient
      .from("billing_plan_versions")
      .select("id, plan_id, version, public_name, status, published_at, billing_plans(code)")
      .eq("status", "published")
      .order("version", { ascending: false }),
    serviceClient
      .from("billing_prices")
      .select(
        "id, plan_version_id, cadence, amount_minor, sync_status, status, revolut_variation_id",
      )
      .eq("status", "active"),
  ]);
  if (error) throw error;

  const pricesByVersion = new Map<string, typeof pricesRes.data>();
  for (const price of pricesRes.data ?? []) {
    const list = pricesByVersion.get(price.plan_version_id) ?? [];
    list.push(price);
    pricesByVersion.set(price.plan_version_id, list);
  }

  const liveBySlug = new Map<
    string,
    {
      version: number;
      syncStatuses: string[];
      hasRevolut: boolean;
      priceIdsNeedingSync: string[];
    }
  >();
  for (const version of versionsRes.data ?? []) {
    const plans = version.billing_plans as { code: string } | { code: string }[] | null;
    const code = Array.isArray(plans) ? plans[0]?.code : plans?.code;
    if (!code || liveBySlug.has(code)) continue;
    const prices = pricesByVersion.get(version.id) ?? [];
    const priceIdsNeedingSync = prices
      .filter((p) => Number(p.amount_minor) > 0 && !p.revolut_variation_id)
      .map((p) => String(p.id));
    liveBySlug.set(code, {
      version: version.version,
      syncStatuses: prices.map((p) => String(p.sync_status)),
      hasRevolut: priceIdsNeedingSync.length === 0,
      priceIdsNeedingSync,
    });
  }

  const plans = (data ?? []).map((plan) => {
    const live = liveBySlug.get(plan.plan_slug);
    return {
      ...plan,
      catalogVersion: live?.version ?? null,
      revolutReady: live?.hasRevolut ?? plan.plan_slug === "free",
      syncStatuses: live?.syncStatuses ?? [],
      priceIdsNeedingSync: live?.priceIdsNeedingSync ?? [],
    };
  });

  return NextResponse.json({
    plans,
    pricingPreview: catalog,
  });
});

export const PUT = adminRoute(async (request, { admin, serviceClient }) => {
  assertPlatformAdminCanWrite(admin);

  const body = await request.json().catch(() => null);
  const planSlug = typeof body?.planSlug === "string" ? body.planSlug.trim() : "";
  if (!planSlug || typeof body?.updates !== "object" || body.updates === null) {
    return NextResponse.json(
      { error: "planSlug and updates are required." },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body.updates) updates[field] = body.updates[field];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No editable fields provided." }, { status: 400 });
  }

  try {
    const result = await publishPlanEdit(serviceClient, {
      planSlug,
      updates,
      adminUserId: admin.userId,
      reason: typeof body?.reason === "string" ? body.reason : undefined,
      request,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publish failed.";
    const status = message.startsWith("Unknown plan") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
});

/**
 * Create a new plan (optionally duplicated from an existing one) and publish
 * marketing + Revolut catalog in one action.
 */
export const POST = adminRoute(async (request, { admin, serviceClient }) => {
  assertPlatformAdminCanWrite(admin);

  const body = await request.json().catch(() => null);
  const planSlug =
    typeof body?.planSlug === "string" ? body.planSlug.trim().toLowerCase() : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const sourceSlug =
    typeof body?.duplicateFrom === "string" ? body.duplicateFrom.trim().toLowerCase() : "";

  if (!planSlug || !displayName) {
    return NextResponse.json(
      { error: "planSlug and displayName are required." },
      { status: 400 },
    );
  }
  if (!isValidPlanSlug(planSlug)) {
    return NextResponse.json(
      {
        error:
          "Invalid plan slug. Use 2–32 chars: start with a letter, then lowercase letters, digits, or underscore.",
      },
      { status: 400 },
    );
  }

  const { data: collision } = await serviceClient
    .from("platform_plan_configs")
    .select("plan_slug")
    .eq("plan_slug", planSlug)
    .maybeSingle();
  if (collision) {
    return NextResponse.json({ error: `Plan slug already exists: ${planSlug}` }, { status: 409 });
  }

  let seed: Record<string, unknown> = {
    plan_slug: planSlug,
    display_name: displayName,
    monthly_price_cents: 0,
    annual_price_cents: 0,
    trial_days: 0,
    weekly_work_hours: 10,
    is_active: true,
    human_members_unlimited: true,
    ai_employees_unlimited: true,
    browser_research_enabled: true,
    gateway_search_enabled: true,
    custom_ai_employees_enabled: true,
    team_features_enabled: true,
    admin_controls_enabled: false,
    priority_support: false,
    allowed_intelligence_tiers: ["cheap", "balanced"],
    entitlements: {},
  };

  if (sourceSlug) {
    const { data: source, error: sourceError } = await serviceClient
      .from("platform_plan_configs")
      .select("*")
      .eq("plan_slug", sourceSlug)
      .maybeSingle();
    if (sourceError) throw sourceError;
    if (!source) {
      return NextResponse.json({ error: `Unknown source plan: ${sourceSlug}` }, { status: 404 });
    }
    const { plan_slug: _s, id: _i, created_at: _c, updated_at: _u, ...rest } = source as Record<
      string,
      unknown
    > & { plan_slug?: string; id?: string; created_at?: string; updated_at?: string };
    seed = {
      ...rest,
      plan_slug: planSlug,
      display_name: displayName,
      is_active: true,
    };
  }

  // Optional create-form overrides (applied before publish so dual-write sees them).
  if (typeof body?.monthlyPriceCents === "number") {
    seed.monthly_price_cents = Math.max(0, Math.round(body.monthlyPriceCents));
  }
  if (typeof body?.annualPriceCents === "number") {
    seed.annual_price_cents = Math.max(0, Math.round(body.annualPriceCents));
  }
  if (typeof body?.weeklyWorkHours === "number") {
    seed.weekly_work_hours = Math.max(0, body.weeklyWorkHours);
  }
  if (typeof body?.isActive === "boolean") {
    seed.is_active = body.isActive;
  }

  const { data, error } = await serviceClient
    .from("platform_plan_configs")
    .insert(seed)
    .select("*")
    .single();
  if (error) throw error;

  await ensureBillingPlanIdentity(serviceClient, planSlug, displayName);

  await writeAuditLog(serviceClient, {
    adminUserId: admin.userId,
    action: "plan_config_created",
    targetType: "platform_plan_config",
    targetId: planSlug,
    after: data,
    reason: typeof body?.reason === "string" ? body.reason : "admin_plans_create_publish",
    request,
  });

  // Publish immediately: versioned catalog + best-effort Revolut sync.
  const publishUpdates: Record<string, unknown> = {
    display_name: displayName,
    monthly_price_cents: Number(data.monthly_price_cents ?? 0),
    annual_price_cents: Number(data.annual_price_cents ?? 0),
    weekly_work_hours: Number(data.weekly_work_hours ?? 0),
    is_active: Boolean(data.is_active),
  };

  try {
    const result = await publishPlanEdit(serviceClient, {
      planSlug,
      updates: publishUpdates,
      adminUserId: admin.userId,
      reason: typeof body?.reason === "string" ? body.reason : "admin_plans_create_publish",
      request,
    });
    const revolutSynced = result.revolutSync.every((r) => r.ok);
    return NextResponse.json({
      ok: true,
      plan: result.plan,
      planVersionId: result.planVersionId,
      priceIds: result.priceIds,
      revolutSync: result.revolutSync,
      revolutSynced,
      notes: result.notes,
    });
  } catch (publishError) {
    const message =
      publishError instanceof Error ? publishError.message : "Created but publish failed.";
    return NextResponse.json(
      {
        ok: true,
        plan: data,
        revolutSynced: false,
        notes: [
          "Plan config created.",
          `Publish step failed (${message}). Open Edit & publish to retry marketing/Revolut sync.`,
        ],
      },
      { status: 201 },
    );
  }
});
