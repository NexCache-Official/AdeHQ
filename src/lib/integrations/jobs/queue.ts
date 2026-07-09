// ===========================================================================
// Integration jobs queue — heavy work never runs inside sync API requests.
// Pattern: tool call → enqueue job → return job_id; the worker completes,
// updates the tool run + work log, and the client polls the job endpoint.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationJobRecord } from "@/lib/integrations/types";
import { jobFromRow } from "./job-from-row";
import { nowISO } from "@/lib/utils";

type DbRow = Record<string, unknown>;

export { jobFromRow } from "./job-from-row";

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
