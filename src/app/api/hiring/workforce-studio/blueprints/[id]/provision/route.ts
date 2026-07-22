import { NextRequest, NextResponse } from "next/server";
import { getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { requireWorkforceStudioAdmin, workforceStudioErrorResponse } from "@/lib/server/workforce-studio-context";
import { createHirePlan } from "@/lib/hiring/workforce-studio/plan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type ProvisionBody = { workspaceId?: string };

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await request.json().catch(() => ({}))) as ProvisionBody;
    const { user, workspaceId } = await requireWorkforceStudioAdmin(
      request,
      getRequestWorkspaceId(request) ?? body.workspaceId,
    );
    const service = createSupabaseSecretClient();
    const { plan, steps } = await createHirePlan(service, { workspaceId, blueprintId: params.id, userId: user.id });
    return NextResponse.json({ plan, steps });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/blueprints/[id]/provision");
  }
}
