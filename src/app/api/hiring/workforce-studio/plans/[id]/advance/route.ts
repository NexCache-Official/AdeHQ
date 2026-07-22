import { NextRequest, NextResponse } from "next/server";
import { getRequestWorkspaceId } from "@/lib/supabase/auth-server";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { requireWorkforceStudioAdmin, workforceStudioErrorResponse } from "@/lib/server/workforce-studio-context";
import { advanceHirePlan } from "@/lib/hiring/workforce-studio/plan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Generous ceiling: normal batches finish in ~8s (BATCH_DEADLINE_MS); a
// compensation pass after a terminal failure walks every succeeded step
// synchronously and needs more headroom for large teams.
export const maxDuration = 60;

type AdvanceBody = { workspaceId?: string };

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await request.json().catch(() => ({}))) as AdvanceBody;
    const { workspaceId } = await requireWorkforceStudioAdmin(
      request,
      getRequestWorkspaceId(request) ?? body.workspaceId,
    );
    const service = createSupabaseSecretClient();
    const { plan, steps } = await advanceHirePlan(service, { workspaceId, planId: params.id });
    return NextResponse.json({ plan, steps });
  } catch (error) {
    return workforceStudioErrorResponse(error, "/plans/[id]/advance");
  }
}
