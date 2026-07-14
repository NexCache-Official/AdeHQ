import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { getEmailThreadWorkContext } from "@/lib/inbox/work-actions";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? undefined;
    const ctx = await resolveInboxRoute(request, workspaceId, "read");
    const data = await getEmailThreadWorkContext(ctx.secret, {
      workspaceId: ctx.workspaceId,
      mailboxId: ctx.mailbox.id,
      threadId,
    });
    return NextResponse.json(data);
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
