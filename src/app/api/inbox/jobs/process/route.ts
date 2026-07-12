/**
 * Serverless drain nudge for inbox inbound + outbox queues.
 * Auth: Bearer INTERNAL_CRON_SECRET or platform secret header.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { processQueuedInboundEvents } from "@/lib/inbox/inbound/process";
import { processQueuedOutbox } from "@/lib/inbox/outbox/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV === "development";
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = createSupabaseSecretClient();
  const inbound = await processQueuedInboundEvents(client, 10);
  const outbox = await processQueuedOutbox(client, 10);
  return NextResponse.json({ ok: true, inboundProcessed: inbound, outboxProcessed: outbox });
}
