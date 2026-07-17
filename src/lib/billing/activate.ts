import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrCreateCurrentPeriod } from "@/lib/billing/usage/periods";
import { startPlanTerm } from "@/lib/billing/plans/plan-terms";

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
  const periodStart = new Date().toISOString();
  const periodEnd = addInterval(intent.interval);

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
    current_period_start: periodStart,
    current_period_end: periodEnd,
    cancel_at_period_end: false,
    metadata: { interval: intent.interval, provider: "revolut" },
  };

  if (existing) {
    await client.from("billing_subscriptions").update(subscriptionPayload).eq("id", existing.id);
  } else {
    await client.from("billing_subscriptions").insert(subscriptionPayload);
  }

  await startPlanTerm(client, {
    workspaceId,
    planSlug: intent.plan_slug,
    source: "checkout",
    actorUserId: intent.user_id,
    reason: `Revolut checkout ${intent.interval}`,
    metadata: {
      intentId: intent.id,
      externalPaymentId: options.externalPaymentId ?? null,
    },
    force: true,
  });

  await client.from("billing_invoices").insert({
    workspace_id: workspaceId,
    amount_cents: intent.amount_cents ?? 0,
    currency: (intent.currency ?? "USD").toLowerCase(),
    status: "paid",
    external_payment_id: options.externalPaymentId ?? null,
  });

  await client
    .from("billing_checkout_intents")
    .update({ status: "completed" })
    .eq("id", intentId);

  const promoCode = intent.metadata?.promoCode;
  if (typeof promoCode === "string" && promoCode.trim()) {
    await redeemPromoForWorkspace(client, promoCode.trim(), workspaceId, intent.user_id);
  }

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
      .select("id, active, discount_type, applies_to_plan, extra_work_hours_per_week")
      .eq("code", code.toUpperCase())
      .maybeSingle();
    if (!promo || !promo.active || !userId) return;

    await client.from("promo_code_redemptions").insert({
      promo_code_id: promo.id,
      user_id: userId,
      workspace_id: workspaceId,
    });

    if (
      promo.discount_type === "plan_override" &&
      typeof promo.applies_to_plan === "string" &&
      promo.applies_to_plan.trim()
    ) {
      const planSlug = promo.applies_to_plan.trim();
      await client.from("workspace_plan_overrides").upsert(
        {
          workspace_id: workspaceId,
          plan_slug: planSlug,
          reason: `Promo ${code}`,
          created_by: userId,
        },
        { onConflict: "workspace_id" },
      );
      await startPlanTerm(client, {
        workspaceId,
        planSlug,
        source: "promo",
        actorUserId: userId,
        reason: `Promo code ${code}`,
        force: true,
      });
    }
  } catch {
    /* redemption is best-effort */
  }
}
