import { NextRequest, NextResponse } from "next/server";
import { getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { requireWorkforceStudioAdmin, workforceStudioErrorResponse } from "@/lib/server/workforce-studio-context";
import { approveBlueprint } from "@/lib/hiring/workforce-studio/blueprint-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApproveBody = { workspaceId?: string; lockToken?: string; expectedRevision?: number };

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await request.json()) as ApproveBody;
    const { user, workspaceId } = await requireWorkforceStudioAdmin(request, getRequestWorkspaceId(request) ?? body.workspaceId);
    if (!body.lockToken || typeof body.expectedRevision !== "number") {
      return NextResponse.json({ error: "lockToken and expectedRevision are required." }, { status: 400 });
    }
    const service = createSupabaseSecretClient();
    const blueprint = await approveBlueprint(service, {
      workspaceId,
      blueprintId: params.id,
      userId: user.id,
      lockToken: body.lockToken,
      expectedRevision: body.expectedRevision,
    });
    return NextResponse.json({ blueprint });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/blueprints/[id]/approve");
  }
}
