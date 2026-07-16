import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationJobRecord } from "@/lib/integrations/types";
import { recordBrainUsage } from "@/lib/brain/metering/record-brain-usage";

function jobContext(job: IntegrationJobRecord): {
  employeeId: string | null;
  roomId: string | null;
  topicId: string | null;
  userId: string | null;
} {
  const payload = job.payload ?? {};
  const ctx =
    typeof payload.ctx === "object" && payload.ctx !== null
      ? (payload.ctx as Record<string, unknown>)
      : {};
  const employeeId =
    job.employeeId ??
    (typeof ctx.employeeId === "string" ? ctx.employeeId : null);
  return {
    employeeId,
    roomId: typeof ctx.roomId === "string" ? ctx.roomId : null,
    topicId: typeof ctx.topicId === "string" ? ctx.topicId : null,
    userId:
      typeof ctx.requestedByUserId === "string"
        ? ctx.requestedByUserId
        : typeof ctx.userId === "string"
          ? ctx.userId
          : null,
  };
}

function workTypeForJob(jobType: string): string {
  const t = jobType.toLowerCase();
  if (t.includes("pdf")) return "artifact_create_pdf";
  if (t.includes("docx") || t.includes("document")) return "artifact_create_docx";
  if (t.includes("xlsx") || t.includes("spreadsheet")) return "artifact_create_spreadsheet";
  if (t.includes("pptx") || t.includes("presentation")) return "artifact_create_presentation";
  if (t.includes("artifact")) return "artifact_generation";
  return jobType;
}

/**
 * Integration job `costUsd` placeholders were sized for shadow work-minutes.
 * Scale them for commercial Work Hours ($0.01/WH) so binary generation is a
 * small add-on on top of the already-billed authoring LLM run.
 */
const COMMERCIAL_JOB_COST_SCALE = 0.01;

/**
 * Charge successful integration jobs via the Brain metering spine.
 */
export async function recordIntegrationJobCost(
  client: SupabaseClient,
  job: IntegrationJobRecord,
  costUsd: number,
): Promise<void> {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return;

  const billableUsd = Math.round(costUsd * COMMERCIAL_JOB_COST_SCALE * 1_000_000) / 1_000_000;
  if (billableUsd <= 0) return;

  const { employeeId, roomId, topicId, userId } = jobContext(job);
  const isArtifact = job.jobType.toLowerCase().includes("artifact");

  try {
    await recordBrainUsage({
      client,
      workspaceId: job.workspaceId,
      idempotencyKey: `integration_job:${job.id}:artifact:1`,
      userId,
      employeeId,
      workUnitId: `integration_job:${job.id}`,
      roomId,
      topicId,
      sourceType: isArtifact ? "artifact" : "system",
      // Artifact binary gen has no dedicated token route; use flash as placeholder for model fields.
      routeId: "route_text_v4flash_sf",
      usage: {
        providerReportedCostUsd: billableUsd,
      },
      status: "succeeded",
      billableToWorkspace: true,
      workType: workTypeForJob(job.jobType),
      capability: isArtifact ? "artifact_generation" : null,
      providerCalled: true,
      metadata: {
        integrationJobId: job.id,
        integrationJobType: job.jobType,
        toolRunId: job.toolRunId ?? null,
        rawJobCostUsd: costUsd,
        commercialScale: COMMERCIAL_JOB_COST_SCALE,
      },
    });
  } catch (error) {
    console.warn("[AdeHQ billing] integration job cost ledger failed", {
      jobId: job.id,
      jobType: job.jobType,
      error,
    });
  }
}
