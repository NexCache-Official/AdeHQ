import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cancelBrowserResearchRun,
  listBrowserResearchRuns,
} from "@/lib/ai/browser-research/server";
import type { BrowserResearchRun } from "@/lib/ai/browser-research/types";
import { isActiveBrowserResearchRun } from "@/lib/ai/browser-research/client-api";
import { nowISO } from "@/lib/utils";

function isMissingRelationError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: string }).message)
        : "";
  return msg.includes("does not exist") || msg.includes("Could not find the table");
}

export type CancelActiveTopicWorkParams = {
  workspaceId: string;
  roomId: string;
  topicId: string;
  employeeId?: string;
  reason?: string;
  /** When set, this agent run id is left active (the stop-ack run). */
  exceptAgentRunId?: string;
};

export type CancelActiveTopicWorkResult = {
  cancelledBrowserResearchRuns: BrowserResearchRun[];
  cancelledAgentRunIds: string[];
  hadActiveWork: boolean;
};

async function cancelTopicAgentRunsExcept(
  client: SupabaseClient,
  params: CancelActiveTopicWorkParams,
): Promise<string[]> {
  const reason = params.reason ?? "Stopped by user request.";
  let query = client
    .from("agent_runs")
    .select("id, run_metadata, status")
    .eq("workspace_id", params.workspaceId)
    .eq("topic_id", params.topicId)
    .in("status", ["queued", "waiting", "running"]);

  const { data: activeRuns, error } = await query;
  if (error && !isMissingRelationError(error)) throw error;

  const cancelledIds: string[] = [];

  for (const row of (activeRuns as Record<string, unknown>[] | null) ?? []) {
    const runId = String(row.id);
    if (params.exceptAgentRunId && runId === params.exceptAgentRunId) continue;

    const status = String(row.status);
    const meta = { ...((row.run_metadata as Record<string, unknown>) ?? {}) };
    meta.collaborationStatus = "cancelled";
    meta.cancelReason = "user_requested_stop";

    if (status === "queued" || status === "waiting") {
      const { error: cancelError } = await client
        .from("agent_runs")
        .update({
          status: "cancelled",
          error_message: reason,
          run_metadata: meta,
          completed_at: nowISO(),
        })
        .eq("workspace_id", params.workspaceId)
        .eq("id", runId);
      if (cancelError && !isMissingRelationError(cancelError)) throw cancelError;
      cancelledIds.push(runId);
    } else if (status === "running") {
      const { error: failError } = await client
        .from("agent_runs")
        .update({
          status: "failed",
          error_message: reason,
          run_metadata: meta,
          completed_at: nowISO(),
        })
        .eq("workspace_id", params.workspaceId)
        .eq("id", runId);
      if (failError && !isMissingRelationError(failError)) throw failError;
      cancelledIds.push(runId);
    }
  }

  return cancelledIds;
}

/** Cancel in-flight browser research and agent runs for a topic. */
export async function cancelActiveTopicWork(
  client: SupabaseClient,
  params: CancelActiveTopicWorkParams,
): Promise<CancelActiveTopicWorkResult> {
  const reason = params.reason ?? "Stopped by user request.";
  const cancelledBrowserResearchRuns: BrowserResearchRun[] = [];

  const runs = await listBrowserResearchRuns(client, {
    workspaceId: params.workspaceId,
    topicId: params.topicId,
    employeeId: params.employeeId,
    limit: 10,
  });

  for (const run of runs) {
    if (!isActiveBrowserResearchRun(run)) continue;
    if (params.employeeId && run.employeeId !== params.employeeId) continue;
    try {
      const cancelled = await cancelBrowserResearchRun(
        client,
        params.workspaceId,
        run.id,
        reason,
      );
      cancelledBrowserResearchRuns.push(cancelled);
    } catch (error) {
      console.warn("[AdeHQ work stop] browser research cancel failed", run.id, error);
    }
  }

  const cancelledAgentRunIds = await cancelTopicAgentRunsExcept(client, params);

  return {
    cancelledBrowserResearchRuns,
    cancelledAgentRunIds,
    hadActiveWork:
      cancelledBrowserResearchRuns.length > 0 || cancelledAgentRunIds.length > 0,
  };
}
