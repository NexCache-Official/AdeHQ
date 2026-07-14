import { NextRequest, NextResponse } from "next/server";
import { inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { resolveWorkActionBase } from "@/lib/inbox/work-route";
import { createFollowUpFromEmail } from "@/lib/inbox/work-actions";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      workspaceId?: string;
      clientActionId?: string;
      roomId?: string;
      topicId?: string;
      title?: string;
      dueDate?: string;
      description?: string;
    };
    if (!body.roomId || !body.title?.trim() || !body.dueDate?.trim()) {
      return NextResponse.json(
        { error: "roomId, title, and dueDate required" },
        { status: 400 },
      );
    }
    const base = await resolveWorkActionBase(request, body, threadId);
    const result = await createFollowUpFromEmail(base, {
      roomId: body.roomId,
      topicId: body.topicId,
      title: body.title,
      dueDate: body.dueDate,
      description: body.description,
    });
    return NextResponse.json(result);
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
