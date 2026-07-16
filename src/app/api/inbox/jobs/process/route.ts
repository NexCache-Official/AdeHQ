/**
 * Serverless drain for inbox inbound + outbox + Slice C email_jobs.
 * Auth: Bearer CRON_SECRET or INTERNAL_CRON_SECRET only.
 * Do not trust x-vercel-cron alone — that header is spoofable.
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
  const secrets = [
    process.env.CRON_SECRET?.trim(),
    process.env.INTERNAL_CRON_SECRET?.trim(),
  ].filter((value): value is string => Boolean(value));
  if (secrets.length === 0) return process.env.NODE_ENV === "development";
  const header = req.headers.get("authorization");
  return secrets.some((secret) => header === `Bearer ${secret}`);
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
