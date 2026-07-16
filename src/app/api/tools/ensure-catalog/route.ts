import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/supabase/auth-server";
import {
  assertPlatformAdminCanWrite,
  requirePlatformAdmin,
} from "@/lib/admin/require-platform-admin";
import { ensureToolCatalog } from "@/lib/server/tool-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Idempotent — seeds global tools table (secret key client bypasses RLS). */
export async function POST(request: NextRequest) {
  try {
    const { admin, serviceClient } = await requirePlatformAdmin(request);
    assertPlatformAdminCanWrite(admin);
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
