import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrCreateCurrentPeriod } from "@/lib/billing/usage/periods";

type CheckoutIntent = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  plan_slug: string;
  interval: string;
  amount_cents: number | null;
  currency: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

function addInterval(interval: string): string {
  const end = new Date();
  if (interval === "annual") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end.toISOString();
}

/**
 * Activate a workspace subscription from a completed checkout intent.
 * Idempotent: a completed intent is not processed twice.
 * Updates the subscription, workspace plan, an invoice row, and refreshes the usage period.
 */
export async function activateSubscriptionFromIntent(
  client: SupabaseClient,
  intentId: string,
  options: { externalPaymentId?: string | null } = {},
): Promise<{ activated: boolean; workspaceId?: string }> {
  const { data: intentRow, error } = await client
    .from("billing_checkout_intents")
    .select("*")
    .eq("id", intentId)
    .maybeSingle();
  if (error) throw error;
  if (!intentRow) return { activated: false };

  const intent = intentRow as CheckoutIntent;
  if (intent.status === "completed") {
    return { activated: false, workspaceId: intent.workspace_id };
  }

  const workspaceId = intent.workspace_id;
  const periodEnd = addInterval(intent.interval);

  // Upsert the subscription (latest wins).
  const { data: existing } = await client
    .from("billing_subscriptions")
    .select("id")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const subscriptionPayload = {
    workspace_id: workspaceId,
    plan_slug: intent.plan_slug,
    status: "active",
    current_period_start: new Date().toISOString(),
    current_period_end: periodEnd,
    cancel_at_period_end: false,
    metadata: { interval: intent.interval, provider: "revolut" },
  };

  if (existing) {
    await client.from("billing_subscriptions").update(subscriptionPayload).eq("id", existing.id);
  } else {
    await client.from("billing_subscriptions").insert(subscriptionPayload);
  }

  // Point the workspace at the new plan.
  await client
    .from("workspaces")
    .update({ plan_slug: intent.plan_slug, plan: intent.plan_slug })
    .eq("id", workspaceId);

  // Record a paid invoice for payment history.
  await client.from("billing_invoices").insert({
    workspace_id: workspaceId,
    amount_cents: intent.amount_cents ?? 0,
    currency: (intent.currency ?? "USD").toLowerCase(),
    status: "paid",
    stripe_invoice_id: options.externalPaymentId ?? null,
  });

  // Mark the intent completed.
  await client
    .from("billing_checkout_intents")
    .update({ status: "completed" })
    .eq("id", intentId);

  // Redeem promo code if one was attached to the checkout.
  const promoCode = intent.metadata?.promoCode;
  if (typeof promoCode === "string" && promoCode.trim()) {
    await redeemPromoForWorkspace(client, promoCode.trim(), workspaceId, intent.user_id);
  }

  // Ensure the current usage period reflects the new allowance.
  try {
    await getOrCreateCurrentPeriod(client, workspaceId);
  } catch {
    /* period table optional */
  }

  return { activated: true, workspaceId };
}

async function redeemPromoForWorkspace(
  client: SupabaseClient,
  code: string,
  workspaceId: string,
  userId: string | null,
): Promise<void> {
  try {
    const { data: promo } = await client
      .from("promo_codes")
      .select("id, active")
      .eq("code", code.toUpperCase())
      .maybeSingle();
    if (!promo || !promo.active || !userId) return;
    await client.from("promo_code_redemptions").insert({
      promo_code_id: promo.id,
      user_id: userId,
      workspace_id: workspaceId,
    });
  } catch {
    /* redemption is best-effort */
  }
}
