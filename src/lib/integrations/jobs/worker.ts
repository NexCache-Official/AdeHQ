// ===========================================================================
// Integration jobs worker — claims queued jobs and runs the handler for
// their job_type. Poll-driven (enqueue nudge + jobs GET endpoint), so it
// works on serverless without a daemon.
//
// Phase 2 registers real handlers here (artifact_xlsx, artifact_pdf, import);
// Phase 4 adds sync/publish_retry handlers.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationJobRecord } from "@/lib/integrations/types";
import { recordIntegrationJobCost } from "@/lib/billing/costing/record-integration-job-cost";
import { finalizeToolRun } from "@/lib/integrations/tool-runs";
import { workMinutesForCost } from "@/lib/integrations/cost";
import { jobFromRow } from "./queue";
import { getJobHandler } from "./registry";
import { reconcileChatArtifactsForJob } from "./reconcile-message-for-job";
import { nowISO } from "@/lib/utils";

// Register Phase 2 artifact job handlers + PR-16 image + PR-17 video jobs.
import "./artifact-handlers";
import "./image-handlers";
import "./video-handlers";

type DbRow = Record<string, unknown>;

/** Atomically claim a queued job (optimistic status flip). */
async function claimJob(
  client: SupabaseClient,
  workspaceId: string,
  jobId: string,
): Promise<IntegrationJobRecord | null> {
  const { data, error } = await client
    .from("integration_jobs")
    .update({ status: "running", started_at: nowISO() })
    .eq("workspace_id", workspaceId)
    .eq("id", jobId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ? jobFromRow(data as DbRow) : null;
}

async function finalizeJobOutcome(
  client: SupabaseClient,
  job: IntegrationJobRecord,
): Promise<IntegrationJobRecord> {
  if (job.status === "success" || job.status === "failed") {
    await reconcileChatArtifactsForJob(client, job).catch((err) =>
      console.warn("[AdeHQ integrations] chat artifact reconcile error", err),
    );
  }
  return job;
}

export async function processIntegrationJob(
  client: SupabaseClient,
  workspaceId: string,
  jobId: string,
): Promise<IntegrationJobRecord | null> {
  const job = await claimJob(client, workspaceId, jobId);
  if (!job) return null;

  const handler = getJobHandler(job.jobType);
  const attempts = job.attempts + 1;

  if (!handler) {
    const message = `No handler registered for job type "${job.jobType}".`;
    await client
      .from("integration_jobs")
      .update({
        status: "failed",
        attempts,
        completed_at: nowISO(),
        error_message: message,
      })
      .eq("workspace_id", workspaceId)
      .eq("id", job.id);
    if (job.toolRunId) {
      await finalizeToolRun(client, {
        toolRunId: job.toolRunId,
        workspaceId,
        status: "failed",
        errorMessage: message,
      }).catch(() => undefined);
    }
    return finalizeJobOutcome(client, {
      ...job,
      status: "failed",
      attempts,
      errorMessage: message,
    });
  }

  try {
    const outcome = await handler(client, job);
    const costUsd = outcome.costUsd ?? 0;
    const cancelledResult = outcome.result?.status === "cancelled";

    await client
      .from("integration_jobs")
      .update({
        status: cancelledResult ? "cancelled" : "success",
        attempts,
        result: outcome.result,
        completed_at: nowISO(),
      })
      .eq("workspace_id", workspaceId)
      .eq("id", job.id);

    if (job.toolRunId) {
      await finalizeToolRun(client, {
        toolRunId: job.toolRunId,
        workspaceId,
        status: cancelledResult ? "failed" : "success",
        outputPayload: outcome.result,
        costUsd: cancelledResult ? 0 : costUsd,
        workMinutes: cancelledResult ? 0 : workMinutesForCost(costUsd),
        errorMessage: cancelledResult ? "Cancelled by user." : undefined,
      }).catch((err) => console.warn("[AdeHQ integrations] job tool-run finalize failed", err));
    }

    // Bill artifact / integration job cost to the commercial Work Hours ledger
    // under the employee who ran it (idempotent per job id).
    if (costUsd > 0 && !cancelledResult) {
      await recordIntegrationJobCost(client, job, costUsd);
    }

    return finalizeJobOutcome(client, {
      ...job,
      status: cancelledResult ? "cancelled" : "success",
      attempts,
      result: outcome.result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error && "message" in error
          ? String((error as { message: unknown }).message)
          : "Job failed.";
    const cancelled = /^CANCELLED\b/i.test(message) || /\bcancelled\b/i.test(message);
    const exhausted = cancelled || attempts >= job.maxAttempts;

    await client
      .from("integration_jobs")
      .update({
        status: cancelled ? "cancelled" : exhausted ? "failed" : "queued",
        attempts,
        error_message: message,
        completed_at: exhausted || cancelled ? nowISO() : null,
        started_at: null,
      })
      .eq("workspace_id", workspaceId)
      .eq("id", job.id);

    if ((exhausted || cancelled) && job.toolRunId) {
      await finalizeToolRun(client, {
        toolRunId: job.toolRunId,
        workspaceId,
        status: "failed",
        errorMessage: message,
      }).catch(() => undefined);
    }

    return finalizeJobOutcome(client, {
      ...job,
      status: cancelled ? "cancelled" : exhausted ? "failed" : "queued",
      attempts,
      errorMessage: message,
    });
  }
}

/** Drain up to `limit` due jobs for a workspace — called from poll endpoints. */
export async function processQueuedIntegrationJobs(
  client: SupabaseClient,
  workspaceId: string,
  limit = 3,
): Promise<number> {
  const { data, error } = await client
    .from("integration_jobs")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("status", "queued")
    .lte("scheduled_at", nowISO())
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  let processed = 0;
  for (const row of data ?? []) {
    const outcome = await processIntegrationJob(client, workspaceId, String(row.id));
    if (outcome) processed += 1;
  }
  return processed;
}
