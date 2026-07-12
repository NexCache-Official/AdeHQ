/**
 * Slice 0 webhook helpers. REMOVABLE.
 */

import { Resend } from "resend";
import { getInboxWebhookSecret, getResendApiKey } from "./config";

export function getResendClient(): Resend | null {
  const key = getResendApiKey();
  if (!key) return null;
  return new Resend(key);
}

export type VerifyResult =
  | { ok: true; payload: unknown }
  | { ok: false; reason: string };

/**
 * Verify Resend/Svix webhook signature using the raw body string.
 */
export function verifyInboxWebhook(
  rawBody: string,
  headers: {
    id: string | null;
    timestamp: string | null;
    signature: string | null;
  },
): VerifyResult {
  const secret = getInboxWebhookSecret();
  if (!secret) {
    return { ok: false, reason: "RESEND_INBOX_WEBHOOK_SECRET (or RESEND_WEBHOOK_SECRET) is not set" };
  }
  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { ok: false, reason: "Missing svix-id / svix-timestamp / svix-signature headers" };
  }

  const resend = getResendClient();
  if (!resend) {
    return { ok: false, reason: "RESEND_API_KEY is not set" };
  }

  try {
    const payload = resend.webhooks.verify({
      payload: rawBody,
      headers: {
        id: headers.id,
        timestamp: headers.timestamp,
        signature: headers.signature,
      },
      webhookSecret: secret,
    });
    return { ok: true, payload };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Signature verification failed",
    };
  }
}

export function extractEventMeta(payload: unknown): {
  eventType: string | null;
  providerEmailId: string | null;
} {
  if (!payload || typeof payload !== "object") {
    return { eventType: null, providerEmailId: null };
  }
  const p = payload as Record<string, unknown>;
  const eventType = typeof p.type === "string" ? p.type : null;
  const data = p.data && typeof p.data === "object" ? (p.data as Record<string, unknown>) : null;
  const providerEmailId =
    data && typeof data.email_id === "string"
      ? data.email_id
      : data && typeof data.id === "string"
        ? data.id
        : null;
  return { eventType, providerEmailId };
}
