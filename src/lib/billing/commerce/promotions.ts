import type { SupabaseClient } from "@supabase/supabase-js";
import { appendLedgerEntry } from "./ledger";
import type { PromotionEnforcement } from "./types";

export type PromotionReward =
  | { type: "weekly_wh_bonus"; amountWh: number; numberOfPeriods: number }
  | { type: "one_time_wh_credit"; amountWh: number; expiresAfterDays: number }
  | { type: "percentage_discount"; percent: number; billingCycles: number }
  | { type: "fixed_discount"; amountMinor: number; billingCycles: number }
  | { type: "feature_unlock"; key: string; value: unknown; expiresAfterDays?: number };

export async function getActivePromotionByCode(
  client: SupabaseClient,
  code: string,
) {
  const { data, error } = await client
    .from("billing_promotions")
    .select("*")
    .eq("code", code.toUpperCase())
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Redeem a promotion. Money discounts require revolut_price / revolut_phase / hybrid
 * with a mapped Revolut object — otherwise reject at checkout time.
 */
export async function redeemPromotion(
  client: SupabaseClient,
  input: {
    promotionId: string;
    workspaceId: string;
    billingCustomerId?: string | null;
    subscriptionId?: string | null;
    actorUserId?: string | null;
  },
): Promise<{ ok: true; terms: string } | { ok: false; error: string }> {
  const { data: promo, error } = await client
    .from("billing_promotions")
    .select("*")
    .eq("id", input.promotionId)
    .maybeSingle();
  if (error) throw error;
  if (!promo || promo.status !== "active") {
    return { ok: false, error: "Promotion is not active." };
  }

  const enforcement = promo.enforcement as PromotionEnforcement;
  if (
    (enforcement === "revolut_price" || enforcement === "revolut_phase") &&
    !promo.revolut_price_id
  ) {
    return {
      ok: false,
      error: "This promotion cannot be charged: provider price mapping is missing.",
    };
  }

  const idempotencyKey = `promotion-redemption:${input.promotionId}:${input.workspaceId}`;
  const { error: redeemError } = await client.from("billing_promotion_redemptions").insert({
    promotion_id: input.promotionId,
    workspace_id: input.workspaceId,
    billing_customer_id: input.billingCustomerId ?? null,
    subscription_id: input.subscriptionId ?? null,
    terms_snapshot: {
      name: promo.name,
      code: promo.code,
      enforcement,
      rewards: promo.rewards,
      customer_terms: promo.customer_terms,
    },
    idempotency_key: idempotencyKey,
  });
  if (redeemError) {
    if (redeemError.code === "23505") {
      return { ok: false, error: "Promotion already redeemed for this workspace." };
    }
    throw redeemError;
  }

  const rewards = (Array.isArray(promo.rewards) ? promo.rewards : []) as PromotionReward[];
  for (const reward of rewards) {
    if (reward.type === "one_time_wh_credit") {
      await appendLedgerEntry(client, {
        workspaceId: input.workspaceId,
        entryType: "weekly_promo_grant",
        amountWh: reward.amountWh,
        promotionId: input.promotionId,
        idempotencyKey: `promo-onetime:${input.promotionId}:${input.workspaceId}`,
        createdBy: input.actorUserId,
      });
      await client.from("wh_credit_lots").insert({
        workspace_id: input.workspaceId,
        lot_type: "one_time_promo",
        amount_wh: reward.amountWh,
        remaining_wh: reward.amountWh,
        expires_at: new Date(
          Date.now() + reward.expiresAfterDays * 24 * 60 * 60 * 1000,
        ).toISOString(),
        promotion_id: input.promotionId,
      });
    }
    // weekly_wh_bonus applied by grant job via redemption snapshot
  }

  return { ok: true, terms: String(promo.customer_terms ?? "") };
}

/** Exact customer-facing promo language for checkout. */
export function formatPromotionCheckoutCopy(promo: {
  customer_terms?: string | null;
  rewards?: unknown;
}): string {
  if (promo.customer_terms?.trim()) return promo.customer_terms.trim();
  const rewards = (Array.isArray(promo.rewards) ? promo.rewards : []) as PromotionReward[];
  const parts: string[] = [];
  for (const r of rewards) {
    if (r.type === "weekly_wh_bonus") {
      parts.push(
        `Includes +${r.amountWh} WH every 7 days for your first ${r.numberOfPeriods} usage periods.`,
      );
    }
    if (r.type === "one_time_wh_credit") {
      parts.push(
        `Also includes ${r.amountWh} bonus WH expiring ${r.expiresAfterDays} days after activation.`,
      );
    }
  }
  return parts.join(" ") || "Promotional terms apply as shown at checkout.";
}
