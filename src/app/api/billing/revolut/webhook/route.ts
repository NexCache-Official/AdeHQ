import { NextRequest, NextResponse } from "next/server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { handleRevolutWebhook, verifyRevolutSignature } from "@/lib/billing/revolut/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const valid = verifyRevolutSignature(rawBody, {
    signature: request.headers.get("revolut-signature"),
    timestamp: request.headers.get("revolut-request-timestamp"),
  });
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    const service = createSupabaseSecretClient();
    const result = await handleRevolutWebhook(service, payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[AdeHQ Revolut webhook]", error);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
