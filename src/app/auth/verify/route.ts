import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_PROJECT_URL } from "@/lib/supabase/config";
import { getSiteUrl } from "@/lib/site-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Branded redirect for Supabase Auth verification links.
 *
 * Supabase expects:
 *   `${SUPABASE_PROJECT_URL}/auth/v1/verify?token=...&type=...&redirect_to=...`
 *
 * Email clients should not display the raw Supabase domain, so we expose
 * `${getSiteUrl()}/auth/verify?...` and 302 to Supabase internally.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const type = url.searchParams.get("type");
  const redirectTo = url.searchParams.get("redirect_to");

  if (!token || !type) {
    return NextResponse.json({ error: "Missing token/type" }, { status: 400 });
  }

  const params = new URLSearchParams({
    token,
    type,
    redirect_to: redirectTo || `${getSiteUrl()}/auth/callback`,
  });

  return NextResponse.redirect(`${SUPABASE_PROJECT_URL}/auth/v1/verify?${params.toString()}`);
}

