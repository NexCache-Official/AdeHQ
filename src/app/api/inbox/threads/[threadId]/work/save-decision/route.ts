import { NextRequest, NextResponse } from "next/server";
import { inboxErrorResponse } from "@/lib/inbox/route-helpers";
import { resolveWorkActionBase } from "@/lib/inbox/work-route";
import { saveDecisionFromEmail } from "@/lib/inbox/work-actions";

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
      decisionStatement?: string;
      rationale?: string;
      ownerName?: string;
      decisionDate?: string;
      alternatives?: string;
      consequences?: string;
    };
    if (!body.roomId || !body.decisionStatement?.trim() || !body.rationale?.trim()) {
      return NextResponse.json(
        { error: "roomId, decisionStatement, and rationale required" },
        { status: 400 },
      );
    }
    const base = await resolveWorkActionBase(request, body, threadId);
    const result = await saveDecisionFromEmail(base, {
      roomId: body.roomId,
      topicId: body.topicId,
      decisionStatement: body.decisionStatement,
      rationale: body.rationale,
      ownerName: body.ownerName,
      decisionDate: body.decisionDate,
      alternatives: body.alternatives,
      consequences: body.consequences,
    });
    return NextResponse.json(result);
  } catch (error) {
    return inboxErrorResponse(error);
  }
}
