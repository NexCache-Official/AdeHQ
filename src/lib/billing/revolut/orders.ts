import type { SupabaseClient } from "@supabase/supabase-js";
import { revolutFetch, type RevolutConfig } from "./client";
import type { CreateCheckoutParams, CreateCheckoutResult } from "./create-checkout";

type RevolutOrderResponse = {
  id: string;
  token?: string;
  checkout_url?: string;
  state?: string;
};

/**
 * Create a Revolut hosted-checkout order server-side and return its checkout URL.
 * Revolut processes the payment on its hosted page; our webhook (Phase 10) confirms it.
 */
export async function createRevolutHostedOrder(
  config: RevolutConfig,
  _client: SupabaseClient,
  params: CreateCheckoutParams,
): Promise<CreateCheckoutResult> {
  const redirectBase = `${config.appBaseUrl}/settings/billing`;

  const order = await revolutFetch<RevolutOrderResponse>(config, "/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: params.amountCents,
      currency: "USD",
      description: `AdeHQ ${params.planSlug} (${params.interval})`,
      merchant_order_ext_ref: params.intentId,
      redirect_url: `${redirectBase}?checkout=success`,
      metadata: {
        workspace_id: params.workspaceId,
        plan_slug: params.planSlug,
        interval: params.interval,
        checkout_intent_id: params.intentId,
      },
    }),
  });

  const checkoutUrl = order.checkout_url ?? `${redirectBase}?checkout=cancelled`;
  return { orderId: order.id, checkoutUrl };
}
