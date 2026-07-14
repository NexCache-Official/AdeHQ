import { NextRequest, NextResponse } from "next/server";
import { inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { resolveWorkActionBase } from "@/lib/inbox/work-route";
import { createTaskFromEmail } from "@/lib/inbox/work-actions";

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
      description?: string;
      assigneeEmployeeId?: string | null;
    };
    if (!body.roomId || !body.title?.trim()) {
      return NextResponse.json({ error: "roomId and title required" }, { status: 400 });
    }
    const base = await resolveWorkActionBase(request, body, threadId);
    const result = await createTaskFromEmail(base, {
      roomId: body.roomId,
      topicId: body.topicId,
      title: body.title,
      description: body.description,
      assigneeEmployeeId: body.assigneeEmployeeId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
