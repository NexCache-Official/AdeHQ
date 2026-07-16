import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPasswordResetRedirectUrl } from "@/lib/auth/recovery";
import { resolveSupabasePublishableKey, resolveSupabaseUrl } from "@/lib/supabase/config";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import {
  consumeRateLimit,
  rateLimitResponse,
  requestIp,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";

type Body = { email?: string };

/**
 * Request a password reset email. Always returns success to avoid email enumeration.
 */
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
        bucket: "auth.forgot_password.ip",
        key: requestIp(request),
        limit: 5,
        windowMs: 15 * 60_000,
      }),
      consumeRateLimit(secret, {
        bucket: "auth.forgot_password.email",
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

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getPasswordResetRedirectUrl(),
    });

    if (error) {
      console.warn("[AdeHQ forgot-password]", error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[AdeHQ forgot-password]", error);
    return NextResponse.json({ error: "Unable to process request." }, { status: 503 });
  }
}
