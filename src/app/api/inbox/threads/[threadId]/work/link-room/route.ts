import { NextRequest, NextResponse } from "next/server";
import { inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { resolveWorkActionBase } from "@/lib/inbox/work-route";
import { linkRoomFromEmail } from "@/lib/inbox/work-actions";

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
      seedBridge?: boolean;
    };
    if (!body.roomId) {
      return NextResponse.json({ error: "roomId required" }, { status: 400 });
    }
    const base = await resolveWorkActionBase(request, body, threadId);
    const result = await linkRoomFromEmail(base, {
      roomId: body.roomId,
      seedBridge: body.seedBridge,
    });
    return NextResponse.json(result);
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
