import { NextRequest, NextResponse } from "next/server";
import { getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { requireWorkforceStudioAdmin, workforceStudioErrorResponse } from "@/lib/server/workforce-studio-context";
import { getPlanWithSteps } from "@/lib/hiring/workforce-studio/plan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const workspaceId = getRequestWorkspaceId(request);
    const { workspaceId: wsId } = await requireWorkforceStudioAdmin(request, workspaceId);
    const service = createSupabaseSecretClient();
    const { plan, steps } = await getPlanWithSteps(service, wsId, params.id);
    return NextResponse.json({ plan, steps });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/plans/[id]");
  }
}
