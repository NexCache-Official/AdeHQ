import { NextRequest, NextResponse } from "next/server";
import { getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { requireWorkforceStudioAdmin, workforceStudioErrorResponse } from "@/lib/server/workforce-studio-context";
import { getBlueprint, logEvent } from "@/lib/hiring/workforce-studio/blueprint-service";
import { isGoalOpId, proposeGoalOp } from "@/lib/hiring/workforce-studio/goal-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { workspaceId?: string; op?: string };

/**
 * Deterministic goal-based edit proposal (PR-22D). Never writes the blueprint —
 * client reviews + applies via the normal draft PATCH path.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await request.json()) as Body;
    const op = (body.op ?? "").trim();
    if (!isGoalOpId(op)) {
      return NextResponse.json({ error: "Unknown goal operation." }, { status: 400 });
    }

    const { user, workspaceId } = await requireWorkforceStudioAdmin(
      request,
      getRequestWorkspaceId(request) ?? body.workspaceId,
    );

    const service = createSupabaseSecretClient();
    const blueprint = await getBlueprint(service, workspaceId, params.id);
    const result = proposeGoalOp(op, blueprint.draftPayload);
    if (!result) {
      return NextResponse.json({
        proposal: null,
        ops: [],
        impact: null,
        message: "I couldn't turn that goal into a concrete change.",
      });
    }

    await logEvent(service, {
      workspaceId,
      blueprintId: params.id,
      eventType: "blueprint_goal_op_proposed",
      payload: { op, opCount: result.ops.length },
      createdBy: user.id,
    });

    return NextResponse.json({
      proposal: result.proposal,
      ops: result.ops,
      impact: result.impact,
      message: result.message,
    });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/blueprints/[id]/goal-op");
  }
}
