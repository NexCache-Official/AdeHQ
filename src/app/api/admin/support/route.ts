import { NextResponse } from "next/server";
import { adminRoute } from "@/lib/admin/api-route";
import { requirePlatformPermission } from "@/lib/admin/require-platform-admin";
import { searchSupport, getSupportDetail } from "@/lib/admin/queries/support";
import { logRestrictedAccess } from "@/lib/admin/restricted-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = adminRoute(async (request, ctx) => {
  requirePlatformPermission(ctx, "support.read");

  const q = request.nextUrl.searchParams.get("q");
  const userId = request.nextUrl.searchParams.get("userId");
  const reason = request.nextUrl.searchParams.get("reason") ?? "Support diagnostics";

  if (userId) {
    await logRestrictedAccess(ctx.serviceClient, {
      adminUserId: ctx.admin.userId,
      action: "support_user_detail",
      targetType: "user",
      targetId: userId,
      reason,
      privacyLevel: "internal_metadata",
      request,
    });
    const detail = await getSupportDetail(ctx.serviceClient, userId);
    return NextResponse.json({ detail });
  }

  if (q?.trim()) {
    await logRestrictedAccess(ctx.serviceClient, {
      adminUserId: ctx.admin.userId,
      action: "support_search",
      targetType: "search",
      targetId: q.trim(),
      reason,
      privacyLevel: "internal_metadata",
      request,
    });
    const results = await searchSupport(ctx.serviceClient, q);
    return NextResponse.json(results);
  }

  return NextResponse.json({ error: "Provide q or userId." }, { status: 400 });
});
