import type { IntegrationJobRecord } from "@/lib/integrations/types";
import { nowISO } from "@/lib/utils";

type DbRow = Record<string, unknown>;

/** Map a DB row to an integration job — safe for client bundles (no worker imports). */
export function jobFromRow(row: DbRow): IntegrationJobRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    employeeId: row.employee_id ? String(row.employee_id) : undefined,
    jobType: String(row.job_type),
    toolRunId: row.tool_run_id ? String(row.tool_run_id) : undefined,
    status: row.status as IntegrationJobRecord["status"],
    payload: (row.payload as Record<string, unknown>) ?? {},
    result: (row.result as Record<string, unknown> | null) ?? undefined,
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 3),
    scheduledAt: String(row.scheduled_at ?? nowISO()),
    startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    createdAt: String(row.created_at ?? nowISO()),
  };
}
