import { NextRequest, NextResponse } from "next/server";
import { resolveInboxRoute, inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { resolveWorkActionBase } from "@/lib/inbox/work-route";
import { getEmailThreadWorkContext, saveMemoryFromEmail } from "@/lib/inbox/work-actions";

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
    return NextResponse.json({
      suggestions: data.keyPointSuggestions.map((text) => ({
        title: text.slice(0, 72),
        content: text,
      })),
    });
  } catch (error) {
    return inboxErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      clientActionId?: string;
      title?: string;
      content?: string;
      roomId?: string | null;
      confidence?: number;
    };
    if (!body.title?.trim() || !body.content?.trim()) {
      return NextResponse.json({ error: "title and content required" }, { status: 400 });
    }
    const base = await resolveWorkActionBase(request, body, threadId);
    const result = await saveMemoryFromEmail(base, {
      title: body.title,
      content: body.content,
      roomId: body.roomId,
      confidence: body.confidence,
    });
    return NextResponse.json(result);
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
