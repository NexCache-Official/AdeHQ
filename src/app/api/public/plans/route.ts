import { NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { getPricingPageCatalog } from "@/lib/billing/commerce/catalog";
import { listActivePlanConfigs } from "@/lib/billing/plans/resolve-workspace-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public, customer-safe plan catalog for the marketing pricing page. */
export async function GET() {
  try {
    const service = createSupabaseSecretClient();

    try {
      const catalog = await getPricingPageCatalog(service);
      if (catalog.length > 0) {
        return NextResponse.json({
          cadenceToggle: true,
          plans: catalog.map((plan) => ({
            planSlug: plan.planCode,
            displayName: plan.publicName,
            eyebrow: plan.eyebrow,
            description: plan.description,
            weeklyWorkHours: plan.weeklyIncludedWh,
            unlimitedWorkHours: plan.entitlements.unlimited_work_hours === true,
            entitlements: plan.entitlements,
            // Flat cents for older clients + nested commerce shape for new ones.
            monthlyPriceCents: plan.monthly?.amountMinor ?? 0,
            annualPriceCents: plan.annual?.amountMinor ?? 0,
            monthly: plan.monthly,
            annual: plan.annual,
          })),
        });
      }
    } catch {
      /* fall through to legacy projection */
    }

    const plans = await listActivePlanConfigs(service);
    return NextResponse.json({
      cadenceToggle: true,
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
