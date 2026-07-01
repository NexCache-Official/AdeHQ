import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import {
  finalizeOrchestrationIfComplete,
  updateOrchestrationEmployeeStatus,
} from "@/lib/orchestration/persistence";
import type { PersistedOrchestrationEmployeeStatus } from "@/lib/orchestration/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StatusBody = {
  employeeId: string;
  phase: PersistedOrchestrationEmployeeStatus["phase"];
  detail?: string | null;
  waitingOnEmployeeName?: string | null;
  runId?: string | null;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: { orchestrationId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const body = (await request.json()) as StatusBody;

    if (!body.employeeId || !body.phase) {
      return NextResponse.json({ error: "employeeId and phase are required." }, { status: 400 });
    }

    const { data: row, error: rowError } = await client
      .from("conversation_orchestrations")
      .select("workspace_id")
      .eq("id", params.orchestrationId)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) {
      return NextResponse.json({ error: "Orchestration not found." }, { status: 404 });
    }

    const workspaceId = String(row.workspace_id);
    await requireWorkspaceMembership(client, workspaceId, user.id);

    const statuses = await updateOrchestrationEmployeeStatus(client, {
      workspaceId,
      orchestrationId: params.orchestrationId,
      employeeId: body.employeeId,
      phase: body.phase,
      detail: body.detail,
      waitingOnEmployeeName: body.waitingOnEmployeeName,
      runId: body.runId,
    });

    if (!statuses) {
      return NextResponse.json({ error: "Could not update status." }, { status: 500 });
    }

    await finalizeOrchestrationIfComplete(client, workspaceId, params.orchestrationId);

    return NextResponse.json({ employeeStatuses: statuses });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ orchestration PATCH]", error);
    return NextResponse.json({ error: "Could not update orchestration." }, { status: 500 });
  }
}
