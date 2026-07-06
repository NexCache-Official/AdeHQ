import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/lib/supabase/auth-server";
import { requirePlatformAdmin, type PlatformAdminContext } from "./require-platform-admin";

/**
 * Wrap an /api/admin/* handler: enforce platform admin, normalize errors.
 * The handler receives the admin context (user, admin, serviceClient).
 */
export function adminRoute(
  handler: (request: NextRequest, ctx: PlatformAdminContext) => Promise<NextResponse>,
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const ctx = await requirePlatformAdmin(request);
      return await handler(request, ctx);
    } catch (error) {
      if (error instanceof AuthError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      console.error("[AdeHQ Control]", request.nextUrl.pathname, error);
      return NextResponse.json({ error: "Admin request failed." }, { status: 500 });
    }
  };
}
