/**
 * GET /api/inbox/unread-count?workspaceId= — sidebar badge.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveInboxRoute(
      request,
      request.nextUrl.searchParams.get("workspaceId") ?? undefined,
      "read",
    );
    const { count } = await ctx.secret
      .from("email_threads")
      .select("id", { count: "exact", head: true })
      .eq("mailbox_id", ctx.mailbox.id)
      .eq("has_unread", true)
      .eq("is_spam", false)
      .neq("status", "archived");
    return NextResponse.json({ count: count ?? 0 });
  } catch (error) {
    // Unclaimed mailbox → zero badge, not an error for the sidebar.
    if (error instanceof Error && /No mailbox has been claimed/i.test(error.message)) {
      return NextResponse.json({ count: 0 });
    }
    return inboxErrorResponse(error);
  }
}
