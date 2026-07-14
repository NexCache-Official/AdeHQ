import { NextRequest, NextResponse } from "next/server";
import { inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { resolveWorkActionBase } from "@/lib/inbox/work-route";
import { askEmployeeFromEmail } from "@/lib/inbox/work-actions";

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
      employeeId?: string;
      target?: "dm" | "room";
      roomId?: string;
      topicId?: string;
    };
    if (!body.employeeId || !body.target) {
      return NextResponse.json({ error: "employeeId and target required" }, { status: 400 });
    }
    const base = await resolveWorkActionBase(request, body, threadId);
    const result = await askEmployeeFromEmail(base, {
      employeeId: body.employeeId,
      target: body.target,
      roomId: body.roomId,
      topicId: body.topicId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
