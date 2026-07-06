import type { SupabaseClient } from "@supabase/supabase-js";
import { redactSensitiveJson } from "@/lib/admin/privacy";

export type ToolRunRow = {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  employeeId: string;
  employeeName: string | null;
  toolName: string;
  capabilityDomain: string;
  mode: string;
  status: string;
  costUsd: number;
  workMinutes: number;
  errorMessage: string | null;
  externalObjectId: string | null;
  approvalId: string | null;
  jobId: string | null;
  roomId: string | null;
  topicId: string | null;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown> | null;
  previewSnapshot: Record<string, unknown> | null;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
};

export type ToolRunListFilters = {
  workspaceId?: string;
  employeeId?: string;
  toolName?: string;
  status?: string;
  limit?: number;
};

export async function listIntegrationToolRuns(
  client: SupabaseClient,
  filters: ToolRunListFilters = {},
): Promise<{ runs: ToolRunRow[]; statusCounts: Record<string, number> }> {
  const limit = Math.min(filters.limit ?? 100, 200);

  let query = client
    .from("integration_tool_runs")
    .select(
      "id, workspace_id, employee_id, tool_name, capability_domain, mode, status, cost_usd, work_minutes, error_message, external_object_id, approval_id, job_id, room_id, topic_id, input_payload, output_payload, preview_snapshot, created_at, completed_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filters.workspaceId) query = query.eq("workspace_id", filters.workspaceId);
  if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
  if (filters.toolName) query = query.eq("tool_name", filters.toolName);
  if (filters.status) query = query.eq("status", filters.status);

  const { data, error } = await query;
  if (error) throw error;

  const workspaceIds = [...new Set((data ?? []).map((r) => String(r.workspace_id)))];
  const employeeIds = [...new Set((data ?? []).map((r) => String(r.employee_id)))];

  const [workspacesRes, employeesRes] = await Promise.all([
    workspaceIds.length
      ? client.from("workspaces").select("id, name").in("id", workspaceIds)
      : Promise.resolve({ data: [], error: null }),
    employeeIds.length
      ? client
          .from("ai_employees")
          .select("id, name, workspace_id")
          .in("id", employeeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (workspacesRes.error) throw workspacesRes.error;
  if (employeesRes.error) throw employeesRes.error;

  const workspaceNames = new Map(
    (workspacesRes.data ?? []).map((w) => [String(w.id), String(w.name)]),
  );
  const employeeNames = new Map(
    (employeesRes.data ?? []).map((e) => [String(e.id), String(e.name)]),
  );

  const runs: ToolRunRow[] = (data ?? []).map((row) => {
    const createdAt = String(row.created_at);
    const completedAt = row.completed_at ? String(row.completed_at) : null;
    const durationMs =
      completedAt != null ? +new Date(completedAt) - +new Date(createdAt) : null;

    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      workspaceName: workspaceNames.get(String(row.workspace_id)) ?? null,
      employeeId: String(row.employee_id),
      employeeName: employeeNames.get(String(row.employee_id)) ?? null,
      toolName: String(row.tool_name),
      capabilityDomain: String(row.capability_domain),
      mode: String(row.mode),
      status: String(row.status),
      costUsd: Number(row.cost_usd ?? 0),
      workMinutes: Number(row.work_minutes ?? 0),
      errorMessage: row.error_message ? String(row.error_message) : null,
      externalObjectId: row.external_object_id ? String(row.external_object_id) : null,
      approvalId: row.approval_id ? String(row.approval_id) : null,
      jobId: row.job_id ? String(row.job_id) : null,
      roomId: row.room_id ? String(row.room_id) : null,
      topicId: row.topic_id ? String(row.topic_id) : null,
      inputPayload: redactSensitiveJson((row.input_payload as Record<string, unknown>) ?? {}),
      outputPayload: row.output_payload
        ? redactSensitiveJson(row.output_payload as Record<string, unknown>)
        : null,
      previewSnapshot: row.preview_snapshot
        ? redactSensitiveJson(row.preview_snapshot as Record<string, unknown>)
        : null,
      createdAt,
      completedAt,
      durationMs,
    };
  });

  const statusCounts: Record<string, number> = {};
  for (const run of runs) {
    statusCounts[run.status] = (statusCounts[run.status] ?? 0) + 1;
  }

  return { runs, statusCounts };
}
