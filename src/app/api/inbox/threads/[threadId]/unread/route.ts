import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { markThreadUnread } from "@/lib/inbox/thread-actions";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await params;
    const body = (await request.json().catch(() => ({}))) as { workspaceId?: string };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "read");
    await markThreadUnread(ctx.secret, ctx.mailbox.id, threadId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
