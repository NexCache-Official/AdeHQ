import { createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRevolutConfig } from "./client";
import { activateSubscriptionFromIntent } from "@/lib/billing/activate";

export type RevolutWebhookHeaders = {
  signature: string | null;
  timestamp: string | null;
};

/**
 * Extract all v1 hex signatures from a Revolut-Signature header
 * (Revolut may send multiple comma-separated values).
 */
export function parseRevolutSignatureHeader(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3).trim())
    .filter(Boolean);
}

/**
 * Verify a Revolut webhook signature.
 * Revolut signs `v1.{timestamp}.{rawBody}` with the webhook secret (HMAC-SHA256).
 * Production fails closed when the webhook secret is absent.
 */
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
    // Legacy single value without comma list
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
  order_id?: string;
  merchant_order_ext_ref?: string;
  merchant_order_data?: { reference?: string };
  metadata?: { checkout_intent_id?: string };
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

/**
 * Handle a verified Revolut webhook payload. Activates the subscription on order completion.
 */
export async function handleRevolutWebhook(
  client: SupabaseClient,
  payload: RevolutWebhookEvent,
): Promise<{ handled: boolean }> {
  const eventType = payload.event ?? "";

  try {
    await client.from("billing_events").insert({
      event_type: eventType,
      payload: payload as unknown as Record<string, unknown>,
      processed_at: new Date().toISOString(),
      external_event_id: payload.order_id ? `${eventType}:${payload.order_id}` : null,
    });
  } catch {
    /* events table optional / duplicate external_event_id */
  }

  const isCompletion = eventType === "ORDER_COMPLETED" || eventType === "ORDER_AUTHORISED";
  if (!isCompletion) return { handled: false };

  const intentId = resolveIntentId(payload);
  if (intentId) {
    await activateSubscriptionFromIntent(client, intentId, {
      externalPaymentId: payload.order_id ?? null,
    });
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
