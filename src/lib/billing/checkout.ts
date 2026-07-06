import type { SupabaseClient } from "@supabase/supabase-js";
import { createRevolutCheckout, isRevolutConfigured } from "@/lib/billing/revolut/create-checkout";

export type StartCheckoutParams = {
  workspaceId: string;
  userId: string;
  planSlug: string;
  interval: "monthly" | "annual";
  promoCode?: string | null;
};

export type StartCheckoutResult = {
  intentId: string;
  checkoutUrl: string | null;
  providerConfigured: boolean;
  message?: string;
};

async function priceFor(
  client: SupabaseClient,
  planSlug: string,
  interval: "monthly" | "annual",
): Promise<{ amountCents: number } | null> {
  const { data, error } = await client
    .from("platform_plan_configs")
    .select("monthly_price_cents, annual_price_cents, is_active")
    .eq("plan_slug", planSlug)
    .maybeSingle();
  if (error || !data || !data.is_active) return null;
  const amountCents =
    interval === "annual" ? Number(data.annual_price_cents) : Number(data.monthly_price_cents);
  return { amountCents };
}

/**
 * Create a checkout intent and, when a payment provider is configured, a hosted checkout.
 * The intent is the internal source of truth; Revolut (Phase 10) fulfills it.
 */
export async function startCheckout(
  client: SupabaseClient,
  params: StartCheckoutParams,
): Promise<StartCheckoutResult> {
  const price = await priceFor(client, params.planSlug, params.interval);
  if (!price) {
    throw new Error(`Plan is not available for checkout: ${params.planSlug}`);
  }

  const { data: intent, error } = await client
    .from("billing_checkout_intents")
    .insert({
      workspace_id: params.workspaceId,
      user_id: params.userId,
      plan_slug: params.planSlug,
      interval: params.interval,
      status: "pending",
      provider: "revolut",
      amount_cents: price.amountCents,
      metadata: params.promoCode ? { promoCode: params.promoCode } : {},
    })
    .select("id")
    .single();
  if (error) throw error;

  const intentId = String(intent.id);

  if (!isRevolutConfigured()) {
    return {
      intentId,
      checkoutUrl: null,
      providerConfigured: false,
      message: "Payments are not enabled yet. Your upgrade request has been recorded.",
    };
  }

  const checkout = await createRevolutCheckout(client, {
    intentId,
    workspaceId: params.workspaceId,
    planSlug: params.planSlug,
    interval: params.interval,
    amountCents: price.amountCents,
  });

  await client
    .from("billing_checkout_intents")
    .update({ status: "started", external_order_id: checkout.orderId })
    .eq("id", intentId);

  return { intentId, checkoutUrl: checkout.checkoutUrl, providerConfigured: true };
}
