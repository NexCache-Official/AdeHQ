import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublishedPrice } from "@/lib/billing/commerce/catalog";
import { REFUND_POLICY_COPY, type BillingCadence, type PlanCode } from "@/lib/billing/commerce/types";
import { getRevolutConfig, getRevolutCurrency } from "@/lib/billing/revolut/client";
import { isRevolutConfigured } from "@/lib/billing/revolut/create-checkout";
import { createOrGetRevolutCustomer } from "@/lib/billing/revolut/customers";
import { createRevolutSubscription } from "@/lib/billing/revolut/subscriptions";
import { retrieveRevolutOrder } from "@/lib/billing/revolut/orders";
import { syncPriceToRevolut } from "@/lib/billing/revolut/provider-sync";

export type StartCheckoutParams = {
  workspaceId: string;
  userId: string;
  planSlug: string;
  interval: "monthly" | "annual";
  promoCode?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
};

export type StartCheckoutResult = {
  intentId: string;
  checkoutUrl: string | null;
  providerConfigured: boolean;
  message?: string;
  snapshotId?: string;
};

// Re-export for callers that imported isRevolutConfigured from checkout path historically
export { isRevolutConfigured };

/**
 * Start Revolut Subscription HPP checkout with frozen checkout snapshot.
 */
export async function startCheckout(
  client: SupabaseClient,
  params: StartCheckoutParams,
): Promise<StartCheckoutResult> {
  const planCode = params.planSlug.toLowerCase() as PlanCode;
  if (planCode === "free" || planCode === "enterprise") {
    throw new Error(`Plan is not available for self-serve checkout: ${params.planSlug}`);
  }

  const cadence = params.interval as BillingCadence;
  const currency = getRevolutCurrency();
  let price = await getPublishedPrice(client, planCode, cadence, currency);
  if (!price) {
    throw new Error(`Plan is not available for checkout: ${params.planSlug}`);
  }

  // Ensure Revolut variation exists before promising a charge
  if (price.amountMinor > 0 && !price.revolutVariationId) {
    const sync = await syncPriceToRevolut(client, price.priceId);
    if (!sync.ok || !sync.revolutVariationId) {
      throw new Error(
        sync.error ??
          "This plan is not ready for payment yet (provider sync pending). Try again shortly.",
      );
    }
    price = { ...price, revolutVariationId: sync.revolutVariationId };
  }

  const snapshotPayload = {
    planCode,
    planVersionId: price.planVersionId,
    priceId: price.priceId,
    publicName: price.publicName,
    cadence,
    currency,
    amountMinor: price.amountMinor,
    weeklyIncludedWh: price.weeklyIncludedWh,
    entitlements: price.entitlements,
    refundPolicy: REFUND_POLICY_COPY,
    usageClockNote:
      "Your seven-day usage period begins when your paid plan activates and continues independently from your monthly or annual billing date.",
    promoCode: params.promoCode ?? null,
  };

  const { data: snapshot, error: snapError } = await client
    .from("billing_checkout_snapshots")
    .insert({
      workspace_id: params.workspaceId,
      plan_version_id: price.planVersionId,
      price_id: price.priceId,
      terms_template: "b2b_workspace",
      snapshot: snapshotPayload,
      created_by: params.userId,
    })
    .select("id")
    .single();
  if (snapError) throw snapError;

  const { data: intent, error } = await client
    .from("billing_checkout_intents")
    .insert({
      workspace_id: params.workspaceId,
      user_id: params.userId,
      plan_slug: planCode,
      interval: cadence,
      status: "pending",
      provider: "revolut",
      amount_cents: price.amountMinor,
      currency,
      metadata: {
        promoCode: params.promoCode ?? null,
        snapshotId: snapshot.id,
        planVersionId: price.planVersionId,
        priceId: price.priceId,
        checkoutMode: "revolut_subscription",
      },
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
      snapshotId: String(snapshot.id),
      message:
        "Billing is not configured. Set REVOLUT_MERCHANT_API_KEY (and webhook secret) on the server, then try again.",
    };
  }

  const config = getRevolutConfig();
  if (!config) {
    return {
      intentId,
      checkoutUrl: null,
      providerConfigured: false,
      snapshotId: String(snapshot.id),
      message: "Billing is not configured.",
    };
  }

  // Ensure billing customer row
  let { data: billingCustomer } = await client
    .from("billing_customers")
    .select("id, external_customer_id, email")
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();

  const email =
    params.customerEmail?.trim() ||
    billingCustomer?.email ||
    `workspace-${params.workspaceId.slice(0, 8)}@customers.adehq.com`;

  if (!billingCustomer?.external_customer_id) {
    const revolutCustomer = await createOrGetRevolutCustomer({
      email,
      fullName: params.customerName,
      externalReference: params.workspaceId,
    });
    const upsert = await client
      .from("billing_customers")
      .upsert(
        {
          workspace_id: params.workspaceId,
          external_customer_id: revolutCustomer.id,
          email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id" },
      )
      .select("id, external_customer_id, email")
      .single();
    if (upsert.error) {
      // workspace_id may not be unique — fall back to insert/update
      if (billingCustomer?.id) {
        await client
          .from("billing_customers")
          .update({
            external_customer_id: revolutCustomer.id,
            email,
            updated_at: new Date().toISOString(),
          })
          .eq("id", billingCustomer.id);
        billingCustomer = {
          id: billingCustomer.id,
          external_customer_id: revolutCustomer.id,
          email,
        };
      } else {
        const inserted = await client
          .from("billing_customers")
          .insert({
            workspace_id: params.workspaceId,
            external_customer_id: revolutCustomer.id,
            email,
          })
          .select("id, external_customer_id, email")
          .single();
        if (inserted.error) throw inserted.error;
        billingCustomer = inserted.data;
      }
    } else {
      billingCustomer = { ...upsert.data, email: upsert.data.email ?? email };
    }
  }

  const redirectUrl = `${config.appBaseUrl}/settings/billing?checkout=success`;
  const subscription = await createRevolutSubscription({
    planVariationId: String(price.revolutVariationId),
    customerId: String(billingCustomer!.external_customer_id),
    externalReference: intentId,
    setupOrderRedirectUrl: redirectUrl,
    idempotencyKey: `checkout-sub:${intentId}`,
  });

  let checkoutUrl: string | null = null;
  if (subscription.setup_order_id) {
    const order = await retrieveRevolutOrder(subscription.setup_order_id);
    checkoutUrl = order.checkout_url ?? null;
  }

  // Pre-create local subscription row in pending state
  const { data: existingSub } = await client
    .from("billing_subscriptions")
    .select("id")
    .eq("workspace_id", params.workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const pendingPayload = {
    workspace_id: params.workspaceId,
    billing_customer_id: billingCustomer?.id ?? null,
    plan_slug: planCode,
    plan_version_id: price.planVersionId,
    price_id: price.priceId,
    checkout_snapshot_id: snapshot.id,
    billing_cadence: cadence,
    currency,
    provider: "revolut",
    external_subscription_id: subscription.id,
    provider_status: subscription.state,
    service_access_status: "free",
    status: "trialing",
    legacy_manual_renew: false,
    metadata: { intentId, checkoutMode: "revolut_subscription" },
    updated_at: new Date().toISOString(),
  };

  if (existingSub) {
    await client.from("billing_subscriptions").update(pendingPayload).eq("id", existingSub.id);
  } else {
    await client.from("billing_subscriptions").insert(pendingPayload);
  }

  await client
    .from("billing_checkout_intents")
    .update({
      status: "started",
      external_order_id: subscription.setup_order_id ?? null,
      metadata: {
        promoCode: params.promoCode ?? null,
        snapshotId: snapshot.id,
        planVersionId: price.planVersionId,
        priceId: price.priceId,
        checkoutMode: "revolut_subscription",
        revolutSubscriptionId: subscription.id,
      },
    })
    .eq("id", intentId);

  return {
    intentId,
    checkoutUrl,
    providerConfigured: true,
    snapshotId: String(snapshot.id),
  };
}
