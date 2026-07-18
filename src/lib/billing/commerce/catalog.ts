import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePlanEntitlements } from "./entitlement-matrix";
import { pricingCardDisplay } from "./pricing-math";
import type {
  BillingCadence,
  PlanCode,
  PlanEntitlements,
  PublishedCatalogPrice,
} from "./types";

type VersionRow = {
  id: string;
  version: number;
  public_name: string;
  eyebrow: string;
  description: string;
  weekly_included_wh: number;
  entitlements: unknown;
  visibility: string;
  status: string;
  plan_id: string;
  billing_plans: { code: string } | { code: string }[] | null;
};

type PriceRow = {
  id: string;
  plan_version_id: string;
  currency: string;
  cadence: string;
  amount_minor: number;
  revolut_variation_id: string | null;
  status: string;
  sync_status: string;
};

function planCodeFromJoin(plans: VersionRow["billing_plans"]): PlanCode {
  const row = Array.isArray(plans) ? plans[0] : plans;
  return (row?.code ?? "free") as PlanCode;
}

/** Published + provider-verified (or free) prices selectable for checkout/pricing page. */
export async function listPublishedPublicCatalog(
  client: SupabaseClient,
  currency = "USD",
): Promise<PublishedCatalogPrice[]> {
  const { data: versions, error } = await client
    .from("billing_plan_versions")
    .select(
      "id, version, public_name, eyebrow, description, weekly_included_wh, entitlements, visibility, status, plan_id, billing_plans(code)",
    )
    .eq("status", "published")
    .eq("visibility", "public");
  if (error) throw error;

  const versionIds = (versions ?? []).map((v) => v.id);
  if (versionIds.length === 0) return [];

  // Active prices are listable for marketing immediately after publish.
  // Checkout still requires revolut_variation_id for paid plans (enforced elsewhere).
  const { data: prices, error: priceError } = await client
    .from("billing_prices")
    .select(
      "id, plan_version_id, currency, cadence, amount_minor, revolut_variation_id, status, sync_status",
    )
    .in("plan_version_id", versionIds)
    .eq("currency", currency)
    .eq("status", "active")
    .in("sync_status", [
      "published",
      "provider_synced",
      "provider_sync_pending",
      "validation_passed",
    ]);
  if (priceError) throw priceError;

  const byVersion = new Map((versions as VersionRow[]).map((v) => [v.id, v]));
  const out: PublishedCatalogPrice[] = [];

  for (const price of (prices ?? []) as PriceRow[]) {
    const version = byVersion.get(price.plan_version_id);
    if (!version) continue;
    const planCode = planCodeFromJoin(version.billing_plans);
    // Paid plans need a Revolut variation for real checkout; free may omit.
    if (planCode !== "free" && price.amount_minor > 0 && !price.revolut_variation_id) {
      // Still list for marketing; checkout will require sync. Flag via null variation.
    }
    out.push({
      priceId: price.id,
      planVersionId: version.id,
      planCode,
      publicName: version.public_name,
      eyebrow: version.eyebrow,
      description: version.description,
      weeklyIncludedWh: Number(version.weekly_included_wh),
      entitlements: parsePlanEntitlements(version.entitlements),
      currency: price.currency,
      cadence: price.cadence as BillingCadence,
      amountMinor: price.amount_minor,
      revolutVariationId: price.revolut_variation_id,
      visibility: version.visibility as PublishedCatalogPrice["visibility"],
    });
  }

  const order: PlanCode[] = ["free", "pro", "team", "business", "enterprise"];
  out.sort(
    (a, b) =>
      order.indexOf(a.planCode) - order.indexOf(b.planCode) ||
      (a.cadence === "monthly" ? 0 : 1) - (b.cadence === "monthly" ? 0 : 1),
  );
  return out;
}

export async function getPublishedPrice(
  client: SupabaseClient,
  planCode: PlanCode,
  cadence: BillingCadence,
  currency = "USD",
): Promise<PublishedCatalogPrice | null> {
  const catalog = await listPublishedPublicCatalog(client, currency);
  return (
    catalog.find((p) => p.planCode === planCode && p.cadence === cadence) ?? null
  );
}

export async function getPlanVersionById(
  client: SupabaseClient,
  planVersionId: string,
): Promise<{
  id: string;
  planCode: PlanCode;
  publicName: string;
  weeklyIncludedWh: number;
  entitlements: PlanEntitlements;
  version: number;
} | null> {
  const { data, error } = await client
    .from("billing_plan_versions")
    .select(
      "id, version, public_name, weekly_included_wh, entitlements, billing_plans(code)",
    )
    .eq("id", planVersionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const plans = data.billing_plans as { code: string } | { code: string }[] | null;
  const planCode = planCodeFromJoin(plans);
  return {
    id: data.id,
    planCode,
    publicName: data.public_name,
    weeklyIncludedWh: Number(data.weekly_included_wh),
    entitlements: parsePlanEntitlements(data.entitlements),
    version: data.version,
  };
}

/** Pricing page payload with monthly/annual toggle helpers. */
export async function getPricingPageCatalog(client: SupabaseClient, currency = "USD") {
  const catalog = await listPublishedPublicCatalog(client, currency);
  const byPlan = new Map<PlanCode, { monthly?: PublishedCatalogPrice; annual?: PublishedCatalogPrice }>();
  for (const row of catalog) {
    const slot = byPlan.get(row.planCode) ?? {};
    if (row.cadence === "monthly") slot.monthly = row;
    else slot.annual = row;
    byPlan.set(row.planCode, slot);
  }

  return Array.from(byPlan.entries()).map(([planCode, prices]) => {
    const monthly = prices.monthly;
    const annual = prices.annual;
    const base = monthly ?? annual!;
    return {
      planCode,
      publicName: base.publicName,
      eyebrow: base.eyebrow,
      description: base.description,
      weeklyIncludedWh: base.weeklyIncludedWh,
      entitlements: base.entitlements,
      monthly: monthly
        ? {
            priceId: monthly.priceId,
            amountMinor: monthly.amountMinor,
            display: pricingCardDisplay({
              cadence: "monthly",
              monthlyAmountMinor: monthly.amountMinor,
              annualAmountMinor: annual?.amountMinor ?? monthly.amountMinor * 12,
            }),
          }
        : null,
      annual: annual
        ? {
            priceId: annual.priceId,
            amountMinor: annual.amountMinor,
            display: pricingCardDisplay({
              cadence: "annual",
              monthlyAmountMinor: monthly?.amountMinor ?? Math.round(annual.amountMinor / 12),
              annualAmountMinor: annual.amountMinor,
            }),
          }
        : null,
    };
  });
}

export function buildProviderRef(opts: {
  environment: string;
  planCode: string;
  version: number;
  currency: string;
  cadence: string;
}): string {
  return `adehq:${opts.environment}:${opts.planCode}:v${opts.version}:${opts.currency}:${opts.cadence}`;
}
