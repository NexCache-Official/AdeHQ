import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { listActivePlanConfigs } from "@/lib/billing/plans/resolve-workspace-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public, customer-safe plan catalog for the marketing pricing page. */
export async function GET() {
  try {
    const service = createServiceRoleClient();
    const plans = await listActivePlanConfigs(service);
    return NextResponse.json({
      plans: plans.map((plan) => {
        const unlimited =
          plan.entitlements?.unlimited_work_hours === true ||
          (plan.planSlug === "enterprise" && plan.weeklyWorkHours <= 0);
        return {
          planSlug: plan.planSlug,
          displayName: plan.displayName,
          monthlyPriceCents: plan.monthlyPriceCents,
          annualPriceCents: plan.annualPriceCents,
          weeklyWorkHours: plan.weeklyWorkHours,
          unlimitedWorkHours: unlimited,
          browserResearchEnabled: plan.browserResearchEnabled,
          gatewaySearchEnabled: plan.gatewaySearchEnabled,
          teamFeaturesEnabled: plan.teamFeaturesEnabled,
          adminControlsEnabled: plan.adminControlsEnabled,
          prioritySupport: plan.prioritySupport,
          entitlements: {
            intelligence_tier: plan.entitlements?.intelligence_tier ?? null,
            web_search: plan.entitlements?.web_search ?? null,
            browser_research: plan.entitlements?.browser_research ?? null,
            support_tier: plan.entitlements?.support_tier ?? null,
          },
        };
      }),
    });
  } catch (error) {
    console.error("[AdeHQ public plans]", error);
    return NextResponse.json({ error: "Unable to load plans." }, { status: 500 });
  }
}
