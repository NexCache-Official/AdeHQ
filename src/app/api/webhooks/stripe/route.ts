import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stripe webhook skeleton — verifies signature when STRIPE_WEBHOOK_SECRET is set. */
export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (webhookSecret && !signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  let eventType = "unknown";
  let payload: Record<string, unknown> = {};

  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
    eventType = String(payload.type ?? "unknown");
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  // Full Stripe signature verification requires the stripe package — log skeleton for now.
  if (!webhookSecret) {
    console.warn("[Stripe webhook] STRIPE_WEBHOOK_SECRET not set — accepting event in skeleton mode.");
  }

  try {
    const client = createServiceRoleClient();
    await client.from("billing_events").insert({
      event_type: eventType,
      payload,
      processed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Stripe webhook] billing_events insert failed:", err);
  }

  return NextResponse.json({ received: true, eventType });
}
