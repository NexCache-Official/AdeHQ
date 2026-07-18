import type { SupabaseClient } from "@supabase/supabase-js";
import { startPlanTerm } from "@/lib/billing/plans/plan-terms";
import { ensureCurrentUsagePeriodGrant } from "@/lib/billing/commerce/grants";
import { addBillingPeriod, floorToHour } from "@/lib/billing/commerce/usage-clock";
import { retrieveRevolutSubscription } from "@/lib/billing/revolut/subscriptions";
import type { BillingCadence } from "@/lib/billing/commerce/types";

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

/**
 * Activate from checkout intent after setup order / subscription becomes active.
 * Idempotent via intent status + subscription-activation key.
 */
export async function activateSubscriptionFromIntent(
  client: SupabaseClient,
  intentId: string,
  options: {
    externalPaymentId?: string | null;
    revolutSubscriptionId?: string | null;
  } = {},
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

  const revolutSubId =
    options.revolutSubscriptionId ??
    (typeof intent.metadata?.revolutSubscriptionId === "string"
      ? intent.metadata.revolutSubscriptionId
      : null);

  if (revolutSubId) {
    return activateFromRevolutSubscription(client, {
      workspaceId: intent.workspace_id,
      intentId: intent.id,
      userId: intent.user_id,
      planSlug: intent.plan_slug,
      interval: intent.interval as BillingCadence,
      amountCents: intent.amount_cents ?? 0,
      currency: intent.currency,
      revolutSubscriptionId: revolutSubId,
      externalPaymentId: options.externalPaymentId ?? null,
      planVersionId:
        typeof intent.metadata?.planVersionId === "string"
          ? intent.metadata.planVersionId
          : null,
      priceId: typeof intent.metadata?.priceId === "string" ? intent.metadata.priceId : null,
      snapshotId:
        typeof intent.metadata?.snapshotId === "string" ? intent.metadata.snapshotId : null,
      promoCode:
        typeof intent.metadata?.promoCode === "string" ? intent.metadata.promoCode : null,
    });
  }

  // Legacy one-time order path (grandfather)
  return activateLegacyOneTimeOrder(client, intent, options.externalPaymentId ?? null);
}

export async function activateFromRevolutSubscription(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    intentId?: string | null;
    userId?: string | null;
    planSlug: string;
    interval: BillingCadence;
    amountCents: number;
    currency: string;
    revolutSubscriptionId: string;
    externalPaymentId?: string | null;
    planVersionId?: string | null;
    priceId?: string | null;
    snapshotId?: string | null;
    promoCode?: string | null;
  },
): Promise<{ activated: boolean; workspaceId?: string }> {
  const idempotencyKey = `subscription-activation:${input.revolutSubscriptionId}`;

  const { data: existingEvent } = await client
    .from("billing_events")
    .select("id")
    .eq("external_event_id", idempotencyKey)
    .maybeSingle();
  if (existingEvent) {
    return { activated: false, workspaceId: input.workspaceId };
  }

  // Authoritative retrieve
  let providerState: string = "active";
  try {
    const remote = await retrieveRevolutSubscription(input.revolutSubscriptionId);
    providerState = remote.state;
    if (remote.state === "pending") {
      await client
        .from("billing_subscriptions")
        .update({
          provider_status: "pending",
          external_subscription_id: input.revolutSubscriptionId,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", input.workspaceId);
      return { activated: false, workspaceId: input.workspaceId };
    }
    if (remote.state !== "active") {
      await client
        .from("billing_subscriptions")
        .update({
          provider_status: remote.state,
          external_subscription_id: input.revolutSubscriptionId,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", input.workspaceId);
      return { activated: false, workspaceId: input.workspaceId };
    }
  } catch {
    /* sandbox / retrieve failure: proceed if webhook indicated completion */
    providerState = "active";
  }

  if (providerState !== "active") {
    return { activated: false, workspaceId: input.workspaceId };
  }

  const periodStart = new Date();
  const periodEnd = addBillingPeriod(periodStart, input.interval);
  const usageAnchor = floorToHour(periodStart).toISOString();

  const { data: existing } = await client
    .from("billing_subscriptions")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const subscriptionPayload = {
    workspace_id: input.workspaceId,
    plan_slug: input.planSlug,
    plan_version_id: input.planVersionId,
    price_id: input.priceId,
    checkout_snapshot_id: input.snapshotId,
    billing_cadence: input.interval,
    currency: input.currency,
    status: "active",
    provider: "revolut",
    external_subscription_id: input.revolutSubscriptionId,
    provider_status: "active",
    service_access_status: "active",
    service_access_ends_at: null,
    cancel_at_period_end: false,
    cancel_requested_at: null,
    current_period_start: periodStart.toISOString(),
    current_period_end: periodEnd.toISOString(),
    legacy_manual_renew: false,
    metadata: {
      interval: input.interval,
      provider: "revolut",
      intentId: input.intentId ?? null,
    },
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await client.from("billing_subscriptions").update(subscriptionPayload).eq("id", existing.id);
  } else {
    await client.from("billing_subscriptions").insert(subscriptionPayload);
  }

  await client
    .from("workspaces")
    .update({
      plan_slug: input.planSlug,
      plan: input.planSlug,
      plan_version_id: input.planVersionId,
      usage_clock_kind: "paid",
      usage_anchor_at: usageAnchor,
      current_plan_started_at: periodStart.toISOString(),
    })
    .eq("id", input.workspaceId);

  await startPlanTerm(client, {
    workspaceId: input.workspaceId,
    planSlug: input.planSlug,
    source: "checkout",
    actorUserId: input.userId ?? null,
    reason: `Revolut subscription ${input.interval}`,
    metadata: {
      intentId: input.intentId ?? null,
      externalPaymentId: input.externalPaymentId ?? null,
      revolutSubscriptionId: input.revolutSubscriptionId,
    },
    force: true,
  });

  await client.from("billing_invoices").insert({
    workspace_id: input.workspaceId,
    amount_cents: input.amountCents,
    currency: (input.currency ?? "USD").toLowerCase(),
    status: "paid",
    external_payment_id: input.externalPaymentId ?? null,
  });

  if (input.intentId) {
    await client
      .from("billing_checkout_intents")
      .update({ status: "completed" })
      .eq("id", input.intentId);
  }

  try {
    await client.from("billing_events").insert({
      event_type: "subscription_activation",
      external_event_id: idempotencyKey,
      payload: { revolutSubscriptionId: input.revolutSubscriptionId },
      processed_at: new Date().toISOString(),
    });
  } catch {
    /* duplicate */
  }

  if (input.promoCode?.trim()) {
    await redeemPromoForWorkspace(
      client,
      input.promoCode.trim(),
      input.workspaceId,
      input.userId ?? null,
    );
  }

  try {
    const grant = await ensureCurrentUsagePeriodGrant(client, input.workspaceId);
    // Close any leftover Free / prior-period rows so meters cannot latch onto them.
    await client
      .from("workspace_usage_periods")
      .update({
        status: "closed",
        period_status: "closed",
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", input.workspaceId)
      .neq("id", grant.periodId)
      .eq("status", "active");
  } catch (err) {
    console.error("[activate] usage period grant failed", err);
  }

  return { activated: true, workspaceId: input.workspaceId };
}

async function activateLegacyOneTimeOrder(
  client: SupabaseClient,
  intent: CheckoutIntent,
  externalPaymentId: string | null,
): Promise<{ activated: boolean; workspaceId?: string }> {
  const workspaceId = intent.workspace_id;
  const periodStart = new Date();
  const periodEnd = addBillingPeriod(
    periodStart,
    intent.interval === "annual" ? "annual" : "monthly",
  );
  const usageAnchor = floorToHour(periodStart).toISOString();

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
    provider_status: "active",
    service_access_status: "active",
    current_period_start: periodStart.toISOString(),
    current_period_end: periodEnd.toISOString(),
    cancel_at_period_end: false,
    legacy_manual_renew: true,
    billing_cadence: intent.interval,
    metadata: { interval: intent.interval, provider: "revolut", legacy: true },
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await client.from("billing_subscriptions").update(subscriptionPayload).eq("id", existing.id);
  } else {
    await client.from("billing_subscriptions").insert(subscriptionPayload);
  }

  await client
    .from("workspaces")
    .update({
      usage_clock_kind: "paid",
      usage_anchor_at: usageAnchor,
    })
    .eq("id", workspaceId);

  await startPlanTerm(client, {
    workspaceId,
    planSlug: intent.plan_slug,
    source: "checkout",
    actorUserId: intent.user_id,
    reason: `Revolut checkout ${intent.interval}`,
    metadata: {
      intentId: intent.id,
      externalPaymentId,
    },
    force: true,
  });

  await client.from("billing_invoices").insert({
    workspace_id: workspaceId,
    amount_cents: intent.amount_cents ?? 0,
    currency: (intent.currency ?? "USD").toLowerCase(),
    status: "paid",
    external_payment_id: externalPaymentId,
  });

  await client
    .from("billing_checkout_intents")
    .update({ status: "completed" })
    .eq("id", intent.id);

  try {
    await ensureCurrentUsagePeriodGrant(client, workspaceId);
  } catch {
    /* optional */
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
