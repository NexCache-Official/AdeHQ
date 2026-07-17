import type { SupabaseClient } from "@supabase/supabase-js";
import { getRevolutCurrency, revolutFetch, type RevolutConfig } from "./client";
import type { CreateCheckoutParams, CreateCheckoutResult } from "./create-checkout";

type RevolutOrderResponse = {
  id: string;
  token?: string;
  checkout_url?: string;
  state?: string;
};

/**
 * Build the Merchant API create-order body (Revolut-Api-Version 2024-09-01).
 * Exported for unit tests.
 */
export function buildRevolutCreateOrderBody(
  config: Pick<RevolutConfig, "appBaseUrl">,
  params: CreateCheckoutParams,
  currency: string = getRevolutCurrency(),
): Record<string, unknown> {
  const redirectBase = `${config.appBaseUrl}/settings/billing`;
  return {
    amount: params.amountCents,
    currency,
    description: `AdeHQ ${params.planSlug} (${params.interval})`,
    merchant_order_data: {
      reference: params.intentId,
    },
    redirect_url: `${redirectBase}?checkout=success`,
    metadata: {
      workspace_id: params.workspaceId,
      plan_slug: params.planSlug,
      interval: params.interval,
      checkout_intent_id: params.intentId,
    },
  };
}

/**
 * Create a Revolut hosted-checkout order server-side and return its checkout URL.
 * Revolut processes the payment on its hosted page; our webhook confirms it.
 */
export async function createRevolutHostedOrder(
  config: RevolutConfig,
  _client: SupabaseClient,
  params: CreateCheckoutParams,
): Promise<CreateCheckoutResult> {
  const redirectBase = `${config.appBaseUrl}/settings/billing`;
  const order = await revolutFetch<RevolutOrderResponse>(config, "/orders", {
    method: "POST",
    body: JSON.stringify(buildRevolutCreateOrderBody(config, params)),
  });

  const checkoutUrl = order.checkout_url ?? `${redirectBase}?checkout=cancelled`;
  return { orderId: order.id, checkoutUrl };
}

/** Retrieve an order (used for subscription setup_order_id → checkout_url). */
export async function retrieveRevolutOrder(orderId: string): Promise<RevolutOrderResponse> {
  const { getRevolutConfig } = await import("./client");
  const config = getRevolutConfig();
  if (!config) throw new Error("Revolut is not configured.");
  return revolutFetch<RevolutOrderResponse>(
    config,
    `/orders/${encodeURIComponent(orderId)}`,
  );
}
