import { NextRequest, NextResponse } from "next/server";
import { inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { resolveWorkActionBase } from "@/lib/inbox/work-route";
import { startBrainstormFromEmail } from "@/lib/inbox/work-actions";

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
      employeeIds?: string[];
      roomId?: string;
      topicTitle?: string;
      leadEmployeeId?: string;
    };
    if (!Array.isArray(body.employeeIds) || body.employeeIds.length === 0) {
      return NextResponse.json(
        { error: "employeeIds required (at least one)" },
        { status: 400 },
      );
    }
    const base = await resolveWorkActionBase(request, body, threadId);
    const result = await startBrainstormFromEmail(base, {
      employeeIds: body.employeeIds,
      roomId: body.roomId,
      topicTitle: body.topicTitle,
      leadEmployeeId: body.leadEmployeeId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
