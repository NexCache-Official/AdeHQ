/**
 * Serverless drain for inbox inbound + outbox + Slice C email_jobs.
 * Auth: Bearer INTERNAL_CRON_SECRET. Also invoked by Vercel Cron (GET/POST).
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { processQueuedInboundEvents } from "@/lib/inbox/inbound/process";
import { processQueuedOutbox } from "@/lib/inbox/outbox/process";
import { processEmailJobs } from "@/lib/inbox/steward/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_CRON_SECRET?.trim();
  const cronHeader = req.headers.get("x-vercel-cron");
  if (cronHeader === "1") return true;
  if (!secret) return process.env.NODE_ENV === "development";
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

async function drain() {
  const client = createSupabaseSecretClient();
  const inbound = await processQueuedInboundEvents(client, 10);
  const outbox = await processQueuedOutbox(client, 10);
  const emailJobs = await processEmailJobs(client, 10);
  return { ok: true, inboundProcessed: inbound, outboxProcessed: outbox, emailJobsProcessed: emailJobs };
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await drain());
}

/** Vercel Cron uses GET by default. */
export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await drain());
}
