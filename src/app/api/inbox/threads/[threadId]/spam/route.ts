import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { setThreadSpam } from "@/lib/inbox/thread-actions";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      spam?: boolean;
    };
    const ctx = await resolveInboxRoute(request, body.workspaceId, "organize");
    await setThreadSpam(ctx.secret, ctx.mailbox.id, threadId, body.spam !== false);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
