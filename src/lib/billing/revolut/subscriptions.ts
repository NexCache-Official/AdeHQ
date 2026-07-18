import { getRevolutConfig, revolutFetch } from "./client";

export type RevolutSubscription = {
  id: string;
  state:
    | "pending"
    | "active"
    | "overdue"
    | "paused"
    | "cancelled"
    | "finished";
  customer_id: string;
  plan_id?: string;
  plan_variation_id?: string;
  external_reference?: string;
  setup_order_id?: string;
  start_date?: string | null;
  current_cycle_id?: string;
  scheduled_action?: unknown;
};

export async function createRevolutSubscription(input: {
  planVariationId: string;
  customerId: string;
  externalReference: string;
  setupOrderRedirectUrl: string;
  idempotencyKey: string;
}): Promise<RevolutSubscription> {
  const config = getRevolutConfig();
  if (!config) throw new Error("Revolut is not configured.");

  // Base URL already includes /api — path is /subscriptions (no version segment).
  return revolutFetch<RevolutSubscription>(config, "/subscriptions", {
    method: "POST",
    headers: { "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({
      plan_variation_id: input.planVariationId,
      customer_id: input.customerId,
      external_reference: input.externalReference,
      setup_order_redirect_url: input.setupOrderRedirectUrl,
    }),
  });
}

export async function retrieveRevolutSubscription(
  subscriptionId: string,
): Promise<RevolutSubscription> {
  const config = getRevolutConfig();
  if (!config) throw new Error("Revolut is not configured.");
  return revolutFetch<RevolutSubscription>(
    config,
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
  );
}

/** Revolut cancel is immediate — AdeHQ keeps paid-through access separately. */
export async function cancelRevolutSubscription(
  subscriptionId: string,
): Promise<RevolutSubscription> {
  const config = getRevolutConfig();
  if (!config) throw new Error("Revolut is not configured.");
  return revolutFetch<RevolutSubscription>(
    config,
    `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    { method: "POST" },
  );
}

export async function updateRevolutSubscription(
  subscriptionId: string,
  body: Record<string, unknown>,
): Promise<RevolutSubscription> {
  const config = getRevolutConfig();
  if (!config) throw new Error("Revolut is not configured.");
  return revolutFetch<RevolutSubscription>(
    config,
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}
