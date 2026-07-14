import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationJobRecord, ToolCallResult } from "@/lib/integrations/types";
import { cleanChatFileTitle } from "@/lib/chat/file-preview-kind";
import { getIntegrationJob } from "./queue";
import { processIntegrationJob } from "./worker";

function artifactSummary(tool: string, payload: Record<string, unknown>): string {
  const title = cleanChatFileTitle(payload.title ? String(payload.title) : "file");
  if (tool === "artifact.createSpreadsheet") {
    const rows = payload.rowCount != null ? Number(payload.rowCount) : null;
    return `Generated spreadsheet "${title}"${rows != null ? ` (${rows} rows)` : ""} — saved to Drive.`;
  }
  if (tool === "artifact.createPdfReport") {
    return `Generated report "${title}" — saved to Drive.`;
  }
  if (tool === "artifact.createDocx") {
    return `Generated document "${title}" — saved to Drive.`;
  }
  if (tool === "artifact.createPresentation") {
    const slides = payload.slideCount != null ? Number(payload.slideCount) : null;
    return `Generated presentation "${title}"${slides != null ? ` (${slides} slides)` : ""} — saved to Drive.`;
  }
  if (tool === "artifact.convertFile") {
    const format = payload.targetFormat ? String(payload.targetFormat).toUpperCase() : "file";
    return `Converted "${title}" to ${format} — saved to Drive.`;
  }
  if (tool === "artifact.saveToDrive") {
    return `Saved "${title}" to Drive.`;
  }
  if (tool === "artifact.updateSpreadsheet") {
    return `Updated spreadsheet "${title}" — saved to Drive.`;
  }
  return `Generated ${title} — saved to Drive.`;
}

/** Turn a completed integration job into a success tool result for chat receipts. */
export function toolResultFromCompletedJob(
  prior: ToolCallResult,
  job: IntegrationJobRecord,
): ToolCallResult {
  const payload = (job.result ?? {}) as Record<string, unknown>;
  const artifactId = payload.artifactId ? String(payload.artifactId) : undefined;
  return {
    status: "success",
    tool: prior.tool,
    mode: prior.mode,
    toolRunId: prior.toolRunId ?? job.toolRunId,
    jobId: job.id,
    output: {
      summary: artifactSummary(prior.tool, payload),
      payload,
      objectId: artifactId,
    },
    costUsd: 0,
    workMinutes: 0,
    messageArtifacts: [],
  };
}

/** Process a queued async tool job inline so chat artifacts reflect the final outcome. */
export async function drainQueuedToolResult(
  client: SupabaseClient,
  workspaceId: string,
  result: ToolCallResult,
): Promise<ToolCallResult> {
  if (result.status !== "queued" || !result.jobId) return result;

  let job = await processIntegrationJob(client, workspaceId, result.jobId);
  if (!job) {
    job = await getIntegrationJob(client, workspaceId, result.jobId);
  }
  if (!job) return result;

  if (job.status === "success") {
    return toolResultFromCompletedJob(result, job);
  }
  if (job.status === "failed") {
    return {
      ...result,
      status: "failed",
      error: job.errorMessage ?? "Background job failed.",
    };
  }

  return result;
}
