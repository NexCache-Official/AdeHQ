/**
 * Slice 0 — Removable Resend inbox transport-proof webhook.
 *
 * POST /api/dev/inbox-transport-proof/webhook
 *
 * Behaviour (matches planned async boundary):
 *   verify signature → idempotently store event → return 200 immediately
 *
 * Does NOT fetch bodies, run AI, or touch production tables.
 * Gated by INBOX_PROOF_ENABLED=true and NODE_ENV=development (or INBOX_PROOF_ALLOW_NON_DEV=true).
 */

import { NextRequest, NextResponse } from "next/server";
import { isInboxProofEnabled } from "@/lib/inbox-transport-proof/config";
import {
  extractEventMeta,
  verifyInboxWebhook,
} from "@/lib/inbox-transport-proof/verify";
import {
  markSvixSeen,
  storeWebhookEvent,
} from "@/lib/inbox-transport-proof/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAllowedEnv(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  return process.env.INBOX_PROOF_ALLOW_NON_DEV?.trim().toLowerCase() === "true";
}

export async function POST(req: NextRequest) {
  if (!isInboxProofEnabled() || !isAllowedEnv()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const rawBody = await req.text();
  const headers = {
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
  };

  const verified = verifyInboxWebhook(rawBody, headers);
  if (!verified.ok) {
    storeWebhookEvent({
      storedAt: new Date().toISOString(),
      status: "rejected",
      svixId: headers.id,
      eventType: null,
      providerEmailId: null,
      payload: null,
      note: verified.reason,
    });
    return NextResponse.json({ error: "Invalid webhook", reason: verified.reason }, { status: 400 });
  }

  const { eventType, providerEmailId } = extractEventMeta(verified.payload);
  const svixId = headers.id;

  if (svixId && !markSvixSeen(svixId)) {
    storeWebhookEvent({
      storedAt: new Date().toISOString(),
      status: "duplicate",
      svixId,
      eventType,
      providerEmailId,
      payload: verified.payload,
      note: "svix-id already seen — not processed again",
    });
    // Still 200 so Resend does not retry forever.
    return NextResponse.json({ ok: true, duplicate: true, svixId });
  }

  storeWebhookEvent({
    storedAt: new Date().toISOString(),
    status: "accepted",
    svixId,
    eventType,
    providerEmailId,
    payload: verified.payload,
  });

  return NextResponse.json({
    ok: true,
    duplicate: false,
    svixId,
    eventType,
    providerEmailId,
  });
}

export async function GET() {
  if (!isInboxProofEnabled() || !isAllowedEnv()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    proof: "inbox-transport-proof",
    message:
      "POST Resend webhooks here. Set INBOX_PROOF_ENABLED=true. Events land in .tmp/inbox-transport-proof/.",
  });
}
