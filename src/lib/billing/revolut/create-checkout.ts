import type { SupabaseClient } from "@supabase/supabase-js";
import { getRevolutConfig } from "./client";

export type CreateCheckoutParams = {
  intentId: string;
  workspaceId: string;
  planSlug: string;
  interval: "monthly" | "annual";
  amountCents: number;
};

export type CreateCheckoutResult = {
  orderId: string;
  checkoutUrl: string;
};

export function isRevolutConfigured(): boolean {
  return getRevolutConfig() != null;
}

/**
 * Create a Revolut hosted checkout order for a plan upgrade.
 * Fully implemented in Phase 10 (Revolut integration). Throws when unconfigured so callers
 * gate on isRevolutConfigured() first.
 */
export async function createRevolutCheckout(
  client: SupabaseClient,
  params: CreateCheckoutParams,
): Promise<CreateCheckoutResult> {
  const config = getRevolutConfig();
  if (!config) {
    throw new Error("Revolut is not configured.");
  }
  return createRevolutOrder(config, client, params);
}

// Implemented in Phase 10.
async function createRevolutOrder(
  config: NonNullable<ReturnType<typeof getRevolutConfig>>,
  client: SupabaseClient,
  params: CreateCheckoutParams,
): Promise<CreateCheckoutResult> {
  const { createRevolutHostedOrder } = await import("./orders");
  return createRevolutHostedOrder(config, client, params);
}
