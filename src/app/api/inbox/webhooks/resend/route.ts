/**
 * Production Resend webhook for workspace inbox.
 * POST /api/inbox/webhooks/resend
 *
 * verify → idempotent store → process → 200
 * Never runs AI. Processing is awaited so Vercel does not freeze the
 * function after the response (fire-and-forget was dropping queued events).
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { getWorkspaceEmailProvider } from "@/lib/inbox/provider/resend";
import { storeInboundWebhookEvent } from "@/lib/inbox/inbound/store-event";
import { processInboundEvent } from "@/lib/inbox/inbound/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  let processed: { ok: boolean; reason?: string } | null = null;
  if (!stored.duplicate) {
    try {
      processed = await processInboundEvent(client, stored.eventId);
    } catch (err) {
      console.warn("[inbox] process failed after store", err);
      processed = {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Always 200 after verify+store so Resend does not hammer retries.
  // Failed process leaves the event for /api/inbox/jobs/process to drain.
  return NextResponse.json({
    ok: true,
    duplicate: stored.duplicate,
    eventId: stored.eventId,
    eventType: meta.eventType,
    processed,
  });
}
