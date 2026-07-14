import { NextRequest, NextResponse } from "next/server";
import { inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { resolveWorkActionBase } from "@/lib/inbox/work-route";
import { prepareProposalWithAi } from "@/lib/inbox/work-actions";

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
      roomId?: string;
      topicId?: string;
      artifactId?: string;
    };
    if (!body.employeeId || !body.roomId) {
      return NextResponse.json({ error: "employeeId and roomId required" }, { status: 400 });
    }
    const base = await resolveWorkActionBase(request, body, threadId);
    const result = await prepareProposalWithAi(base, {
      employeeId: body.employeeId,
      roomId: body.roomId,
      topicId: body.topicId,
      artifactId: body.artifactId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
