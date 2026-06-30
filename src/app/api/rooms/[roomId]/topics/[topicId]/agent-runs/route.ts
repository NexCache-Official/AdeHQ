import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireAuthUser, requireWorkspaceMembership } from "@/lib/supabase/auth-server";
import { assertCanAccessRoom } from "@/lib/server/room-access";
import { getWorkspaceIdForRoom } from "@/lib/server/room-messages";
import { assertTopicInRoom } from "@/lib/server/topic-helpers";
import type { ConversationPlan } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_RUNNING_MS = 2 * 60 * 1000;

function collaborationPlanFromRun(row: Record<string, unknown>): ConversationPlan | undefined {
  const meta = (row.run_metadata as Record<string, unknown> | null) ?? {};
  if (!meta.collaborationId) return undefined;
  return {
    mode: (meta.conversationMode as ConversationPlan["mode"]) ?? "lead_collaborator",
    collaborationId: String(meta.collaborationId),
    rootTriggerMessageId: row.root_trigger_message_id
      ? String(row.root_trigger_message_id)
      : undefined,
    status: (meta.collaborationStatus as ConversationPlan["status"]) ?? "active",
    participants: Array.isArray(meta.participants)
      ? (meta.participants as ConversationPlan["participants"])
      : [],
    pendingParticipants: [],
    staggerMs: typeof meta.staggerMs === "number" ? meta.staggerMs : undefined,
  };
}

function isDependencyCompleted(
  rows: Record<string, unknown>[],
  dependsOnRunId: unknown,
): boolean {
  if (!dependsOnRunId) return true;
  return rows.some(
    (r) => String(r.id) === String(dependsOnRunId) && String(r.status) === "completed",
  );
}

function isRunProcessable(row: Record<string, unknown>, rows: Record<string, unknown>[]): boolean {
  const status = String(row.status);
  const depMet = isDependencyCompleted(rows, row.depends_on_run_id);

  if (status === "running") return false;
  if (status === "queued" || status === "waiting") return depMet;
  return false;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { roomId: string; topicId: string } },
) {
  try {
    const { user, client } = await requireAuthUser(request);
    const workspaceId = await getWorkspaceIdForRoom(client, params.roomId);
    if (!workspaceId) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    const { role } = await requireWorkspaceMembership(client, workspaceId, user.id);
    await assertCanAccessRoom(client, workspaceId, params.roomId, user.id, role);
    await assertTopicInRoom(client, workspaceId, params.roomId, params.topicId);

    const sinceMs = 10 * 60 * 1000;
    const since = new Date(Date.now() - sinceMs).toISOString();
    const statusFilter = request.nextUrl.searchParams.get("status") ?? "queued,waiting,running";
    const statuses = statusFilter.split(",").map((s) => s.trim()).filter(Boolean);

    const { data, error } = await client
      .from("agent_runs")
      .select(
        "id, employee_id, status, started_at, response_reason, depends_on_run_id, root_trigger_message_id, run_metadata",
      )
      .eq("workspace_id", workspaceId)
      .eq("room_id", params.roomId)
      .eq("topic_id", params.topicId)
      .in("status", statuses)
      .gte("started_at", since)
      .order("started_at", { ascending: true });

    if (error) throw error;

    const now = Date.now();
    const rows = (data as Record<string, unknown>[] | null) ?? [];

    const employeeIds = [...new Set(rows.map((r) => String(r.employee_id)).filter(Boolean))];
    const employeeNameById = new Map<string, string>();

    if (employeeIds.length > 0) {
      const { data: employees, error: empError } = await client
        .from("ai_employees")
        .select("id, name")
        .eq("workspace_id", workspaceId)
        .in("id", employeeIds);

      if (empError) throw empError;
      for (const emp of employees ?? []) {
        employeeNameById.set(String(emp.id), String(emp.name ?? "AI Employee"));
      }
    }

    const runs = rows.map((row) => {
      const startedAt = String(row.started_at ?? "");
      const status = String(row.status);
      const stale =
        status === "running" &&
        startedAt &&
        now - +new Date(startedAt) > STALE_RUNNING_MS;
      const meta = (row.run_metadata as Record<string, unknown> | null) ?? {};
      const employeeId = String(row.employee_id);
      return {
        runId: String(row.id),
        employeeId,
        employeeName: employeeNameById.get(employeeId) ?? "AI Employee",
        status,
        reason: row.response_reason ? String(row.response_reason) : undefined,
        dependsOnRunId: row.depends_on_run_id ? String(row.depends_on_run_id) : undefined,
        collaborationRole:
          typeof meta.collaborationRole === "string" ? meta.collaborationRole : undefined,
        conversationMode:
          typeof meta.conversationMode === "string" ? meta.conversationMode : undefined,
        stale,
        processable: isRunProcessable(row, rows),
      };
    });

    const leadRun = rows.find((r) => {
      const meta = (r.run_metadata as Record<string, unknown> | null) ?? {};
      return meta.collaborationRole === "lead" && meta.collaborationStatus !== "cancelled";
    });
    const collaborationPlan = leadRun ? collaborationPlanFromRun(leadRun) : undefined;

    return NextResponse.json({ runs, collaborationPlan });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[AdeHQ agent-runs recovery]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load runs." },
      { status: 500 },
    );
  }
}
