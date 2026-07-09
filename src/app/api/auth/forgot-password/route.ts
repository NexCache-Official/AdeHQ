import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPasswordResetRedirectUrl } from "@/lib/auth/recovery";
import { resolveSupabasePublishableKey, resolveSupabaseUrl } from "@/lib/supabase/config";

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to send reset email." },
      { status: 500 },
    );
  }
}
