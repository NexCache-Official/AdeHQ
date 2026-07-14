import { NextRequest, NextResponse } from "next/server";
import { inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { resolveWorkActionBase } from "@/lib/inbox/work-route";
import { startRoomFromEmail } from "@/lib/inbox/work-actions";

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
      roomName?: string;
    };
    const base = await resolveWorkActionBase(request, body, threadId);
    const result = await startRoomFromEmail(base, { roomName: body.roomName });
    return NextResponse.json(result);
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
