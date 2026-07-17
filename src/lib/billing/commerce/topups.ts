import type { SupabaseClient } from "@supabase/supabase-js";
import { appendLedgerEntry } from "./ledger";
import { getRevolutConfig, getRevolutCurrency, revolutFetch } from "@/lib/billing/revolut/client";
import { isRevolutConfigured } from "@/lib/billing/revolut/create-checkout";

export async function listActiveTopUpProducts(client: SupabaseClient) {
  const { data, error } = await client
    .from("wh_topup_products")
    .select("*")
    .eq("status", "active")
    .order("wh_amount", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function startTopUpCheckout(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    userId: string;
    productId: string;
  },
): Promise<{ orderId: string; checkoutUrl: string | null; providerConfigured: boolean }> {
  const { data: product, error } = await client
    .from("wh_topup_products")
    .select("*")
    .eq("id", input.productId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  if (!product) throw new Error("Top-up product not found.");

  if (!isRevolutConfigured()) {
    return { orderId: "", checkoutUrl: null, providerConfigured: false };
  }

  const config = getRevolutConfig();
  if (!config) return { orderId: "", checkoutUrl: null, providerConfigured: false };

  const currency = getRevolutCurrency();
  const order = await revolutFetch<{ id: string; checkout_url?: string }>(config, "/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: product.price_minor,
      currency,
      description: `AdeHQ Work Hours top-up (${product.wh_amount} WH)`,
      merchant_order_data: {
        reference: `topup:${input.workspaceId}:${product.id}:${Date.now()}`,
      },
      redirect_url: `${config.appBaseUrl}/settings/billing?topup=success`,
      metadata: {
        kind: "wh_topup",
        workspace_id: input.workspaceId,
        product_id: product.id,
        wh_amount: String(product.wh_amount),
        expires_after_days: String(product.expires_after_days),
        user_id: input.userId,
      },
    }),
  });

  return {
    orderId: order.id,
    checkoutUrl: order.checkout_url ?? null,
    providerConfigured: true,
  };
}

export async function fulfillTopUpOrder(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    productId: string;
    whAmount: number;
    expiresAfterDays: number;
    orderId: string;
  },
): Promise<void> {
  const idempotencyKey = `topup:${input.orderId}`;
  const { duplicate } = await appendLedgerEntry(client, {
    workspaceId: input.workspaceId,
    entryType: "purchased_grant",
    amountWh: input.whAmount,
    purchaseId: input.orderId,
    idempotencyKey,
    reason: "Work Hours top-up",
  });
  if (duplicate) return;

  const expiresAt = new Date(
    Date.now() + input.expiresAfterDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  await client.from("wh_credit_lots").insert({
    workspace_id: input.workspaceId,
    lot_type: "purchased",
    amount_wh: input.whAmount,
    remaining_wh: input.whAmount,
    expires_at: expiresAt,
    topup_product_id: input.productId,
    purchase_id: input.orderId,
  });
}
