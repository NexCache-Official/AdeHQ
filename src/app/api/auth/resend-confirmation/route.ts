import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getEmailRedirectUrl } from "@/lib/auth/callback-session";
import {
  resolveSupabasePublishableKey,
  resolveSupabaseUrl,
} from "@/lib/supabase/config";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  consumeRateLimit,
  rateLimitResponse,
  requestIp,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";

type Body = { email?: string };

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const email = body.email?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    const secret = createSupabaseSecretClient();
    const [ipLimit, emailLimit] = await Promise.all([
      consumeRateLimit(secret, {
        bucket: "auth.resend_confirmation.ip",
        key: requestIp(request),
        limit: 5,
        windowMs: 15 * 60_000,
      }),
      consumeRateLimit(secret, {
        bucket: "auth.resend_confirmation.email",
        key: email,
        limit: 3,
        windowMs: 60 * 60_000,
      }),
    ]);
    if (!ipLimit.allowed) return rateLimitResponse(ipLimit);
    if (!emailLimit.allowed) return rateLimitResponse(emailLimit);

    const supabase = createClient(resolveSupabaseUrl(), resolveSupabasePublishableKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: getEmailRedirectUrl() },
    });

    if (error) {
      console.warn("[AdeHQ resend confirmation]", error.message);
    }

    // Enumeration-safe: callers cannot distinguish an existing account.
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[AdeHQ resend confirmation]", error);
    return NextResponse.json({ error: "Unable to process request." }, { status: 503 });
  }
}
