import { createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRevolutConfig } from "./client";
import { activateSubscriptionFromIntent } from "@/lib/billing/activate";

export type RevolutWebhookHeaders = {
  signature: string | null;
  timestamp: string | null;
};

/**
 * Verify a Revolut webhook signature.
 * Revolut signs `v1.{timestamp}.{rawBody}` with the webhook secret (HMAC-SHA256) and sends the
 * result as `Revolut-Signature: v1=<hex>`. When no secret is configured, verification is skipped
 * (development only).
 */
export function verifyRevolutSignature(
  rawBody: string,
  headers: RevolutWebhookHeaders,
): boolean {
  const config = getRevolutConfig();
  const secret = config?.webhookSecret;
  if (!secret) return true;
  if (!headers.signature || !headers.timestamp) return false;

  const payloadToSign = `v1.${headers.timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(payloadToSign).digest("hex");
  const provided = headers.signature.replace(/^v1=/, "");

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type RevolutWebhookEvent = {
  event?: string;
  order_id?: string;
  merchant_order_ext_ref?: string;
};

/**
 * Handle a verified Revolut webhook payload. Activates the subscription on order completion.
 * Persists the raw event for audit/idempotency.
 */
export async function handleRevolutWebhook(
  client: SupabaseClient,
  payload: RevolutWebhookEvent,
): Promise<{ handled: boolean }> {
  const eventType = payload.event ?? "";

  // Persist the event (best-effort).
  try {
    await client.from("billing_events").insert({
      event_type: eventType,
      payload: payload as unknown as Record<string, unknown>,
      processed_at: new Date().toISOString(),
    });
  } catch {
    /* events table optional */
  }

  const isCompletion = eventType === "ORDER_COMPLETED" || eventType === "ORDER_AUTHORISED";
  if (!isCompletion) return { handled: false };

  // Resolve the checkout intent: prefer our merchant ext ref, fall back to the external order id.
  const intentId = payload.merchant_order_ext_ref ?? null;
  if (intentId) {
    await activateSubscriptionFromIntent(client, intentId, { externalPaymentId: payload.order_id ?? null });
    return { handled: true };
  }

  if (payload.order_id) {
    const { data: intent } = await client
      .from("billing_checkout_intents")
      .select("id")
      .eq("external_order_id", payload.order_id)
      .maybeSingle();
    if (intent) {
      await activateSubscriptionFromIntent(client, String(intent.id), {
        externalPaymentId: payload.order_id,
      });
      return { handled: true };
    }
  }

  return { handled: false };
}
