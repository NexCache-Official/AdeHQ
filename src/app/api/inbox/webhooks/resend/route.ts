/**
 * Production Resend webhook for workspace inbox.
 * POST /api/inbox/webhooks/resend
 *
 * verify → idempotent store → enqueue process → 200 immediately
 * Never runs AI or heavy work inline.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { getWorkspaceEmailProvider } from "@/lib/inbox/provider/resend";
import { storeInboundWebhookEvent } from "@/lib/inbox/inbound/store-event";
import { processInboundEvent } from "@/lib/inbox/inbound/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const headers = {
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
  };

  const provider = getWorkspaceEmailProvider();
  const verified = provider.verifyInboundWebhook(rawBody, headers);
  if (!verified.ok) {
    return NextResponse.json({ error: "Invalid webhook", reason: verified.reason }, { status: 400 });
  }

  const meta = provider.parseInboundWebhook(verified.payload);
  // Prefer Svix header id over payload field
  const svixId = headers.id;

  const client = createSupabaseSecretClient();
  const stored = await storeInboundWebhookEvent(client, { meta, svixId });

  if (!stored.duplicate && stored.processingState === "queued") {
    void processInboundEvent(client, stored.eventId).catch((err) =>
      console.warn("[inbox] inbound process failed", err),
    );
  } else if (!stored.duplicate) {
    // delivery events stored as ready — still process to update outbox
    void processInboundEvent(client, stored.eventId).catch((err) =>
      console.warn("[inbox] delivery process failed", err),
    );
  }

  return NextResponse.json({
    ok: true,
    duplicate: stored.duplicate,
    eventId: stored.eventId,
    eventType: meta.eventType,
  });
}
