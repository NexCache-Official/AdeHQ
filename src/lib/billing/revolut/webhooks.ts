import { createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRevolutConfig } from "./client";
import { activateSubscriptionFromIntent } from "@/lib/billing/activate";
import { retrieveRevolutSubscription } from "./subscriptions";
import {
  markSubscriptionOverdue,
  applyServiceAccessEndIfDue,
} from "@/lib/billing/commerce/lifecycle";
import { addBillingPeriod } from "@/lib/billing/commerce/usage-clock";
import type { BillingCadence } from "@/lib/billing/commerce/types";

export type RevolutWebhookHeaders = {
  signature: string | null;
  timestamp: string | null;
};

export function parseRevolutSignatureHeader(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3).trim())
    .filter(Boolean);
}

export function verifyRevolutSignature(
  rawBody: string,
  headers: RevolutWebhookHeaders,
): boolean {
  const config = getRevolutConfig();
  const secret = config?.webhookSecret;
  if (!secret) return process.env.NODE_ENV === "development";
  if (!headers.signature || !headers.timestamp) return false;

  const payloadToSign = `v1.${headers.timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(payloadToSign).digest("hex");
  const candidates = parseRevolutSignatureHeader(headers.signature);
  if (candidates.length === 0) {
    const provided = headers.signature.replace(/^v1=/, "").trim();
    if (provided) candidates.push(provided);
  }

  const expectedBuf = Buffer.from(expected);
  for (const candidate of candidates) {
    const providedBuf = Buffer.from(candidate);
    if (
      expectedBuf.length === providedBuf.length &&
      timingSafeEqual(expectedBuf, providedBuf)
    ) {
      return true;
    }
  }
  return false;
}

type RevolutWebhookEvent = {
  event?: string;
  event_id?: string;
  id?: string;
  order_id?: string;
  subscription_id?: string;
  merchant_order_ext_ref?: string;
  merchant_order_data?: { reference?: string };
  metadata?: { checkout_intent_id?: string };
  [key: string]: unknown;
};

function resolveIntentId(payload: RevolutWebhookEvent): string | null {
  const fromData = payload.merchant_order_data?.reference;
  if (typeof fromData === "string" && fromData.trim()) return fromData.trim();
  if (typeof payload.merchant_order_ext_ref === "string" && payload.merchant_order_ext_ref.trim()) {
    return payload.merchant_order_ext_ref.trim();
  }
  const fromMeta = payload.metadata?.checkout_intent_id;
  if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta.trim();
  return null;
}

function eventDedupeKey(payload: RevolutWebhookEvent): string {
  const eventType = payload.event ?? "unknown";
  const id =
    payload.event_id ??
    payload.id ??
    payload.order_id ??
    payload.subscription_id ??
    JSON.stringify(payload).slice(0, 80);
  return `${eventType}:${id}`;
}

async function applyProviderSubscriptionState(
  client: SupabaseClient,
  revolutSubscriptionId: string,
): Promise<boolean> {
  const remote = await retrieveRevolutSubscription(revolutSubscriptionId);
  const { data: sub } = await client
    .from("billing_subscriptions")
    .select("*")
    .eq("external_subscription_id", revolutSubscriptionId)
    .maybeSingle();
  if (!sub) return false;

  const workspaceId = String(sub.workspace_id);

  if (remote.state === "active") {
    const cadence = (sub.billing_cadence as BillingCadence | null) ?? "monthly";
    const periodStart = sub.current_period_start
      ? new Date(String(sub.current_period_start))
      : new Date();
    // On renewal, advance billing period if needed — never touch usage clock
    let periodEnd = sub.current_period_end
      ? new Date(String(sub.current_period_end))
      : addBillingPeriod(periodStart, cadence);
    if (periodEnd.getTime() <= Date.now()) {
      periodEnd = addBillingPeriod(new Date(), cadence);
    }

    await client
      .from("billing_subscriptions")
      .update({
        provider_status: "active",
        service_access_status:
          sub.service_access_status === "scheduled_to_end"
            ? "scheduled_to_end"
            : "active",
        status: sub.service_access_status === "scheduled_to_end" ? "active" : "active",
        grace_ends_at: null,
        current_period_end: periodEnd.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", sub.id);

    // Activate from pending if needed
    if (sub.service_access_status === "free" || sub.status === "trialing") {
      const meta = (sub.metadata ?? {}) as Record<string, unknown>;
      const intentId = typeof meta.intentId === "string" ? meta.intentId : null;
      if (intentId) {
        await activateSubscriptionFromIntent(client, intentId, {
          revolutSubscriptionId,
        });
      }
    }
    return true;
  }

  if (remote.state === "overdue") {
    await markSubscriptionOverdue(client, workspaceId, revolutSubscriptionId);
    return true;
  }

  if (remote.state === "cancelled" || remote.state === "finished") {
    // Do NOT drop AdeHQ access immediately
    const endsAt =
      sub.service_access_ends_at ??
      sub.current_period_end ??
      new Date().toISOString();
    await client
      .from("billing_subscriptions")
      .update({
        provider_status: remote.state,
        service_access_status:
          new Date(String(endsAt)).getTime() > Date.now()
            ? "scheduled_to_end"
            : "free",
        service_access_ends_at: endsAt,
        cancel_at_period_end: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sub.id);
    await applyServiceAccessEndIfDue(client, workspaceId);
    return true;
  }

  if (remote.state === "paused") {
    await client
      .from("billing_subscriptions")
      .update({
        provider_status: "paused",
        service_access_status: "read_only",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sub.id);
    return true;
  }

  await client
    .from("billing_subscriptions")
    .update({
      provider_status: remote.state,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sub.id);
  return true;
}

/**
 * Handle a verified Revolut webhook. State-based and idempotent.
 */
export async function handleRevolutWebhook(
  client: SupabaseClient,
  payload: RevolutWebhookEvent,
): Promise<{ handled: boolean }> {
  const eventType = payload.event ?? "";
  const dedupe = eventDedupeKey(payload);

  try {
    const { error } = await client.from("billing_events").insert({
      event_type: eventType,
      payload: payload as unknown as Record<string, unknown>,
      processed_at: new Date().toISOString(),
      external_event_id: dedupe,
    });
    if (error && String(error.message ?? "").includes("duplicate")) {
      return { handled: true };
    }
  } catch {
    /* duplicate or missing column */
  }

  // Subscription lifecycle — re-fetch authoritative state
  const subscriptionId =
    (typeof payload.subscription_id === "string" && payload.subscription_id) ||
    (eventType.toLowerCase().includes("subscription") && typeof payload.id === "string"
      ? payload.id
      : null);

  if (subscriptionId) {
    try {
      await applyProviderSubscriptionState(client, subscriptionId);
      return { handled: true };
    } catch (err) {
      console.error("[revolut.webhook] subscription state apply failed", err);
    }
  }

  const isCompletion = eventType === "ORDER_COMPLETED" || eventType === "ORDER_AUTHORISED";
  if (!isCompletion) return { handled: false };

  // WH top-up one-time orders
  const meta = payload.metadata as Record<string, unknown> | undefined;
  if (meta?.kind === "wh_topup" && typeof meta.workspace_id === "string") {
    const { fulfillTopUpOrder } = await import("@/lib/billing/commerce/topups");
    await fulfillTopUpOrder(client, {
      workspaceId: String(meta.workspace_id),
      productId: String(meta.product_id ?? ""),
      whAmount: Number(meta.wh_amount ?? 0),
      expiresAfterDays: Number(meta.expires_after_days ?? 365),
      orderId: String(payload.order_id ?? dedupe),
    });
    return { handled: true };
  }

  const intentId = resolveIntentId(payload);
  if (intentId) {
    const { data: intent } = await client
      .from("billing_checkout_intents")
      .select("metadata")
      .eq("id", intentId)
      .maybeSingle();
    const revolutSubscriptionId =
      intent?.metadata &&
      typeof intent.metadata === "object" &&
      typeof (intent.metadata as Record<string, unknown>).revolutSubscriptionId === "string"
        ? String((intent.metadata as Record<string, unknown>).revolutSubscriptionId)
        : null;

    await activateSubscriptionFromIntent(client, intentId, {
      externalPaymentId: payload.order_id ?? null,
      revolutSubscriptionId,
    });
    return { handled: true };
  }

  if (payload.order_id) {
    const { data: intent } = await client
      .from("billing_checkout_intents")
      .select("id, metadata")
      .eq("external_order_id", payload.order_id)
      .maybeSingle();
    if (intent) {
      const revolutSubscriptionId =
        intent.metadata &&
        typeof intent.metadata === "object" &&
        typeof (intent.metadata as Record<string, unknown>).revolutSubscriptionId === "string"
          ? String((intent.metadata as Record<string, unknown>).revolutSubscriptionId)
          : null;
      await activateSubscriptionFromIntent(client, String(intent.id), {
        externalPaymentId: payload.order_id,
        revolutSubscriptionId,
      });
      return { handled: true };
    }
  }

  return { handled: false };
}

/** Reconciliation worker: re-fetch provider state for at-risk subscriptions. */
export async function reconcileRevolutSubscriptions(
  client: SupabaseClient,
  limit = 50,
): Promise<number> {
  const { data: subs } = await client
    .from("billing_subscriptions")
    .select("external_subscription_id, workspace_id, provider_status, service_access_status")
    .not("external_subscription_id", "is", null)
    .eq("legacy_manual_renew", false)
    .or(
      "provider_status.in.(pending,overdue,cancelled),service_access_status.in.(grace,scheduled_to_end,read_only)",
    )
    .limit(limit);

  let n = 0;
  for (const sub of subs ?? []) {
    if (!sub.external_subscription_id) continue;
    try {
      await applyProviderSubscriptionState(client, String(sub.external_subscription_id));
      await applyServiceAccessEndIfDue(client, String(sub.workspace_id));
      n += 1;
    } catch (err) {
      console.error("[revolut.reconcile]", sub.external_subscription_id, err);
    }
  }
  return n;
}
