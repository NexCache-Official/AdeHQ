import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/supabase/auth-server";
import { requirePlatformAdmin } from "@/lib/admin/require-platform-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requirePlatformAdmin(request);
    return NextResponse.json({
      isPlatformAdmin: true,
      role: admin.role,
      email: admin.email,
      permissions: admin.permissions,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.status === 403) {
        return NextResponse.json({ isPlatformAdmin: false }, { status: 200 });
      }
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ Control] /api/admin/me", error);
    return NextResponse.json({ error: "Unable to check admin access." }, { status: 500 });
  }
}
