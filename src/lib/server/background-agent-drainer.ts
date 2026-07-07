import type { SupabaseClient } from "@supabase/supabase-js";
import { AgentRunClaimError, processQueuedAgentRun } from "@/lib/server/process-queued-run";

type DbRow = Record<string, unknown>;

export type DrainQueuedAgentRunsResult = {
  processedRunIds: string[];
  skippedRunIds: string[];
};

/**
 * Drive a bounded chain of queued AI follow-ups for a single root message.
 * Governance limits still live in queue-follow-up-runs; this only removes the
 * need for a human to open the room before already-queued work continues.
 */
export async function drainQueuedAgentRunsForRoot(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    rootTriggerMessageId: string;
    maxRuns?: number;
  },
): Promise<DrainQueuedAgentRunsResult> {
  const maxRuns = Math.max(0, Math.min(12, params.maxRuns ?? 6));
  const processedRunIds: string[] = [];
  const skippedRunIds: string[] = [];
  const attempted = new Set<string>();

  for (let i = 0; i < maxRuns; i += 1) {
    const { data, error } = await client
      .from("agent_runs")
      .select("id, status, started_at")
      .eq("workspace_id", params.workspaceId)
      .eq("root_trigger_message_id", params.rootTriggerMessageId)
      .in("status", ["queued", "waiting"])
      .order("started_at", { ascending: true })
      .limit(20);
    if (error) throw error;

    const next = ((data as DbRow[] | null) ?? []).find((row) => !attempted.has(String(row.id)));
    if (!next) break;

    const runId = String(next.id);
    attempted.add(runId);
    try {
      await processQueuedAgentRun(client, params.workspaceId, runId, {});
      processedRunIds.push(runId);
    } catch (error) {
      skippedRunIds.push(runId);
      if (!(error instanceof AgentRunClaimError)) {
        console.warn("[AdeHQ background-drainer] queued run failed", error);
      }
    }
  }

  return { processedRunIds, skippedRunIds };
}
