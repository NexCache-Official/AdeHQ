import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { ensureToolCatalog } from "@/lib/server/tool-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Idempotent — seeds global tools table (secret key client bypasses RLS). */
export async function POST(request: NextRequest) {
  try {
    await requireAuthUser(request);
    const serviceClient = createSupabaseSecretClient();
    await ensureToolCatalog(serviceClient);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ ensure tool catalog]", error);
    const message = error instanceof Error ? error.message : "Could not seed tool catalog.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
