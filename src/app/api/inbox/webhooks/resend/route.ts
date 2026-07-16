/**
 * Production Resend webhook for workspace inbox.
 * POST /api/inbox/webhooks/resend
 *
 * verify → idempotent store → 200 immediately.
 * Processing is best-effort nudge + cron drain (/api/inbox/jobs/process).
 * Never runs AI in this request.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { getWorkspaceEmailProvider } from "@/lib/inbox/provider/resend";
import { storeInboundWebhookEvent } from "@/lib/inbox/inbound/store-event";
import { processQueuedInboundEvents } from "@/lib/inbox/inbound/process";
import { processQueuedOutbox } from "@/lib/inbox/outbox/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Short — we return after enqueue; cron recovers abandoned work. */
export const maxDuration = 15;

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
  const svixId = headers.id;

  const client = createSupabaseSecretClient();
  const stored = await storeInboundWebhookEvent(client, { meta, svixId });

  // Best-effort drain — must not delay the 200. Daily cron is recovery only
  // (Hobby plan); prefer the just-stored event so real replies land immediately.
  if (!stored.duplicate) {
    void (async () => {
      try {
        const { processInboundEvent } = await import("@/lib/inbox/inbound/process");
        await processInboundEvent(client, stored.eventId);
        await Promise.all([
          processQueuedInboundEvents(client, 8),
          processQueuedOutbox(client, 4),
        ]);
      } catch (err) {
        console.warn("[inbox] webhook drain nudge failed", err);
      }
    })();
  }

  return NextResponse.json({
    ok: true,
    duplicate: stored.duplicate,
    eventId: stored.eventId,
    eventType: meta.eventType,
    queued: !stored.duplicate,
  });
}
