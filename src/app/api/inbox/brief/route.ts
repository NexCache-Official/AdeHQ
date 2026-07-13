/**
 * GET /api/inbox/brief?workspaceId= — Inbox Brief stats for the primary mailbox.
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

    const mailboxId = ctx.mailbox.id;
    const userId = ctx.user.id;

    const [unread, needsApproval, highPriority, assignedToMe] = await Promise.all([
      ctx.secret
        .from("email_threads")
        .select("id", { count: "exact", head: true })
        .eq("mailbox_id", mailboxId)
        .eq("has_unread", true)
        .eq("is_spam", false)
        .neq("status", "archived"),
      ctx.secret
        .from("email_threads")
        .select("id", { count: "exact", head: true })
        .eq("mailbox_id", mailboxId)
        .eq("is_spam", false)
        .not("latest_draft_id", "is", null)
        .in("draft_status", ["ready", "idle"]),
      ctx.secret
        .from("email_threads")
        .select("id", { count: "exact", head: true })
        .eq("mailbox_id", mailboxId)
        .eq("is_spam", false)
        .in("priority", ["high", "urgent"])
        .in("status", ["open", "waiting"]),
      ctx.secret
        .from("email_threads")
        .select("id", { count: "exact", head: true })
        .eq("mailbox_id", mailboxId)
        .eq("assigned_human_id", userId)
        .eq("is_spam", false)
        .neq("status", "archived"),
    ]);

    return NextResponse.json({
      greeting: greetingForHour(new Date().getHours()),
      mailboxAddress: ctx.mailbox.address,
      stats: {
        unread: unread.count ?? 0,
        needsApproval: needsApproval.count ?? 0,
        highPriority: highPriority.count ?? 0,
        assignedToMe: assignedToMe.count ?? 0,
      },
    });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
