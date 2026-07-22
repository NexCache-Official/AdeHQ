import { NextRequest, NextResponse } from "next/server";
import { getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { requireWorkforceStudioAdmin, workforceStudioErrorResponse } from "@/lib/server/workforce-studio-context";
import { getBlueprint, patchDraftBlueprint } from "@/lib/hiring/workforce-studio/blueprint-service";
import type { WorkforceBlueprintPayload } from "@/lib/hiring/workforce-studio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const workspaceId = getRequestWorkspaceId(request);
    const { workspaceId: wsId } = await requireWorkforceStudioAdmin(request, workspaceId);
    const service = createSupabaseSecretClient();
    const blueprint = await getBlueprint(service, wsId, params.id);
    return NextResponse.json({ blueprint });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/blueprints/[id]");
  }
}

type PatchBody = {
  workspaceId?: string;
  lockToken?: string;
  expectedRevision?: number;
  payload?: WorkforceBlueprintPayload;
  changeSummary?: string;
  name?: string;
};

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await request.json()) as PatchBody;
    const { user, workspaceId } = await requireWorkforceStudioAdmin(request, getRequestWorkspaceId(request) ?? body.workspaceId);

    if (!body.lockToken || typeof body.expectedRevision !== "number" || !body.payload) {
      return NextResponse.json(
        { error: "lockToken, expectedRevision, and payload are required." },
        { status: 400 },
      );
    }

    const service = createSupabaseSecretClient();
    const blueprint = await patchDraftBlueprint(service, {
      workspaceId,
      blueprintId: params.id,
      userId: user.id,
      lockToken: body.lockToken,
      expectedRevision: body.expectedRevision,
      payload: body.payload,
      changeSummary: body.changeSummary ?? "Manual edit",
      name: body.name,
    });

    return NextResponse.json({ blueprint });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/blueprints/[id]");
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const workspaceId = getRequestWorkspaceId(request);
    const { workspaceId: wsId } = await requireWorkforceStudioAdmin(request, workspaceId);
    const service = createSupabaseSecretClient();
    const { error } = await service
      .from("workforce_blueprints")
      .update({ status: "archived" })
      .eq("workspace_id", wsId)
      .eq("id", params.id)
      .eq("status", "draft");
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/blueprints/[id]");
  }
}
