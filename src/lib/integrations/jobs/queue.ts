// ===========================================================================
// Integration jobs queue — heavy work never runs inside sync API requests.
// Pattern: tool call → enqueue job → return job_id; the worker completes,
// updates the tool run + work log, and the client polls the job endpoint.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationJobRecord } from "@/lib/integrations/types";
import { nowISO } from "@/lib/utils";

type DbRow = Record<string, unknown>;

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

export type EnqueueJobParams = {
  workspaceId: string;
  employeeId?: string;
  jobType: string;
  toolRunId?: string;
  payload: Record<string, unknown>;
  scheduledAt?: string;
};

export async function enqueueIntegrationJob(
  client: SupabaseClient,
  params: EnqueueJobParams,
): Promise<IntegrationJobRecord> {
  const { data, error } = await client
    .from("integration_jobs")
    .insert({
      workspace_id: params.workspaceId,
      employee_id: params.employeeId ?? null,
      job_type: params.jobType,
      tool_run_id: params.toolRunId ?? null,
      status: "queued",
      payload: params.payload,
      scheduled_at: params.scheduledAt ?? nowISO(),
    })
    .select("*")
    .single();
  if (error) throw error;

  const job = jobFromRow(data as DbRow);

  // Serverless-friendly nudge: try processing in the background of this
  // request. The jobs GET endpoint also nudges, so polling drains the queue
  // even if this fire-and-forget attempt is cut short.
  void import("./worker")
    .then(({ processIntegrationJob }) => processIntegrationJob(client, job.workspaceId, job.id))
    .catch((err) => console.warn("[AdeHQ integrations] inline job processing failed", err));

  return job;
}

export async function getIntegrationJob(
  client: SupabaseClient,
  workspaceId: string,
  jobId: string,
): Promise<IntegrationJobRecord | null> {
  const { data, error } = await client
    .from("integration_jobs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data ? jobFromRow(data as DbRow) : null;
}
