import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProviderRef } from "@/lib/billing/commerce/catalog";
import {
  createRevolutSubscriptionPlan,
  retrieveRevolutSubscriptionPlan,
} from "./subscription-plans";
import { getRevolutConfig, getRevolutEnvironment } from "./client";

/**
 * Sync a billing_price to Revolut via outbox saga.
 * Price becomes checkout-ready only after variation verified + sync_status=published.
 */
export async function syncPriceToRevolut(
  client: SupabaseClient,
  priceId: string,
): Promise<{ ok: boolean; revolutPlanId?: string; revolutVariationId?: string; error?: string }> {
  const config = getRevolutConfig();
  if (!config) {
    return { ok: false, error: "Revolut is not configured." };
  }

  const { data: price, error } = await client
    .from("billing_prices")
    .select(
      "*, billing_plan_versions(id, version, public_name, billing_plans(code))",
    )
    .eq("id", priceId)
    .maybeSingle();
  if (error || !price) return { ok: false, error: error?.message ?? "Price not found." };

  if (Number(price.amount_minor) === 0) {
    await client
      .from("billing_prices")
      .update({
        sync_status: "published",
        status: "active",
        verified_at: new Date().toISOString(),
      })
      .eq("id", priceId);
    return { ok: true };
  }

  const version = price.billing_plan_versions as {
    id: string;
    version: number;
    public_name: string;
    billing_plans: { code: string } | { code: string }[];
  } | null;
  if (!version) return { ok: false, error: "Plan version missing." };
  const planJoin = Array.isArray(version.billing_plans)
    ? version.billing_plans[0]
    : version.billing_plans;
  const planCode = planJoin?.code ?? "pro";

  const providerRef =
    price.provider_ref ||
    buildProviderRef({
      environment: getRevolutEnvironment(),
      planCode,
      version: version.version,
      currency: String(price.currency),
      cadence: String(price.cadence),
    });

  await client.from("billing_provider_sync_jobs").insert({
    price_id: priceId,
    provider_ref: providerRef,
    status: "running",
  });

  await client
    .from("billing_prices")
    .update({ sync_status: "provider_sync_pending", provider_ref: providerRef })
    .eq("id", priceId);

  try {
    let revolutPlanId = price.revolut_plan_id as string | null;
    let revolutVariationId = price.revolut_variation_id as string | null;

    if (!revolutPlanId || !revolutVariationId) {
      const created = await createRevolutSubscriptionPlan({
        name: `${version.public_name} ${String(price.cadence)} (${providerRef})`,
        providerRef,
        currency: String(price.currency),
        cadence: price.cadence as "monthly" | "annual",
        amountMinor: Number(price.amount_minor),
      });
      revolutPlanId = created.id;
      revolutVariationId = created.variations?.[0]?.id ?? null;
    }

    if (!revolutPlanId || !revolutVariationId) {
      throw new Error("Revolut plan created without variation id.");
    }

    const verified = await retrieveRevolutSubscriptionPlan(revolutPlanId);
    const variation = verified.variations?.find((v) => v.id === revolutVariationId);
    const phase = variation?.phases?.[0];
    if (phase?.amount != null && Number(phase.amount) !== Number(price.amount_minor)) {
      throw new Error(
        `Provider amount mismatch: expected ${price.amount_minor}, got ${phase.amount}`,
      );
    }

    await client
      .from("billing_prices")
      .update({
        revolut_plan_id: revolutPlanId,
        revolut_variation_id: revolutVariationId,
        provider_ref: providerRef,
        sync_status: "published",
        status: "active",
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", priceId);

    await client
      .from("billing_provider_sync_jobs")
      .update({
        status: "succeeded",
        result: { revolutPlanId, revolutVariationId },
        updated_at: new Date().toISOString(),
      })
      .eq("price_id", priceId)
      .eq("status", "running");

    return { ok: true, revolutPlanId, revolutVariationId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await client
      .from("billing_prices")
      .update({ sync_status: "provider_sync_failed", updated_at: new Date().toISOString() })
      .eq("id", priceId);
    await client
      .from("billing_provider_sync_jobs")
      .update({
        status: "failed",
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("price_id", priceId)
      .eq("status", "running");
    return { ok: false, error: message };
  }
}
