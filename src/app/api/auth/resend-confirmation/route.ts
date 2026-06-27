import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getEmailRedirectUrl } from "@/lib/auth/callback-session";
import {
  resolveSupabasePublishableKey,
  resolveSupabaseUrl,
} from "@/lib/supabase/config";

export const runtime = "nodejs";

type Body = { email?: string };

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const email = body.email?.trim();

    if (!email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    const supabase = createClient(resolveSupabaseUrl(), resolveSupabasePublishableKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: getEmailRedirectUrl() },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[AdeHQ resend confirmation]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to resend confirmation email." },
      { status: 500 },
    );
  }
}
