import { NextRequest, NextResponse } from "next/server";
import { getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { requireWorkforceStudioAdmin, workforceStudioErrorResponse } from "@/lib/server/workforce-studio-context";
import { getBlueprint, logEvent } from "@/lib/hiring/workforce-studio/blueprint-service";
import { proposeNlEdit } from "@/lib/hiring/workforce-studio/nl-edit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Must exceed nl-edit.ts's internal generateObject race timeout (60s, the
// "strong" tier budget) so a slow SiliconFlow response resolves to a
// graceful "couldn't turn that into a concrete change" reply instead of a
// raw platform timeout.
export const maxDuration = 90;

type NlEditBody = { workspaceId?: string; instruction?: string };

/**
 * Proposes a small, typed diff against the current draft from a free-text
 * instruction. Never writes to the blueprint — the client reviews the
 * proposal and, if accepted, merges it locally with applyNlEditProposal
 * before the normal PATCH /blueprints/[id] save path (same optimistic
 * concurrency + lock rules as any other edit).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await request.json()) as NlEditBody;
    const instruction = (body.instruction ?? "").trim();
    if (!instruction) {
      return NextResponse.json({ error: "Tell Maya what to change." }, { status: 400 });
    }

    const { user, workspaceId } = await requireWorkforceStudioAdmin(
      request,
      getRequestWorkspaceId(request) ?? body.workspaceId,
    );

    const service = createSupabaseSecretClient();
    const blueprint = await getBlueprint(service, workspaceId, params.id);

    const result = await proposeNlEdit(instruction, blueprint.draftPayload);
    if (!result) {
      return NextResponse.json({
        proposal: null,
        ops: [],
        message: "I couldn't turn that into a concrete change. Try naming a specific role or outcome — e.g. \"add a second backend engineer\".",
      });
    }

    await logEvent(service, {
      workspaceId,
      blueprintId: params.id,
      eventType: "blueprint_nl_edit_proposed",
      payload: { instruction, opCount: result.ops.length },
      createdBy: user.id,
    });

    return NextResponse.json({ proposal: result.proposal, ops: result.ops });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/blueprints/[id]/nl-edit");
  }
}
