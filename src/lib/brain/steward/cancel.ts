import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelBrainRun } from "@/lib/brain/reliability/lifecycle";
import { cancelActiveTopicWork } from "@/lib/server/cancel-active-topic-work";
import { releaseLeasesForRun } from "./leases";

/**
 * Cancel a Steward collaboration: leases, brain steps/run, and linked topic agent runs.
 */
export async function cancelStewardCollaboration(
  client: SupabaseClient,
  input: {
    workspaceId: string;
    brainRunId: string;
    roomId: string;
    topicId: string;
    reason?: string;
  },
): Promise<{ cancelledAgentRunIds: string[] }> {
  await releaseLeasesForRun(client, input.brainRunId);

  try {
    await cancelBrainRun(client, input.brainRunId);
  } catch (err) {
    console.warn("[AdeHQ steward] cancelBrainRun", err);
  }

  await client
    .from("brain_runs")
    .update({
      steward_progress: {
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        reason: input.reason ?? "user_requested_stop",
      },
      lifecycle_status: "cancelled",
      status: "cancelled",
      completed_at: new Date().toISOString(),
    })
    .eq("id", input.brainRunId);

  // Cancel agent runs stamped with this brain run
  const { data: linked } = await client
    .from("agent_runs")
    .select("id, run_metadata, status")
    .eq("workspace_id", input.workspaceId)
    .eq("topic_id", input.topicId)
    .in("status", ["queued", "waiting", "running"]);

  const cancelledAgentRunIds: string[] = [];
  for (const row of linked ?? []) {
    const meta = (row.run_metadata as Record<string, unknown> | null) ?? {};
    if (meta.stewardBrainRunId !== input.brainRunId && meta.brainRunId !== input.brainRunId) {
      continue;
    }
    const { error } = await client
      .from("agent_runs")
      .update({
        status: "cancelled",
        error_message: input.reason ?? "Collaboration cancelled.",
        run_metadata: {
          ...meta,
          collaborationStatus: "cancelled",
          cancelReason: "steward_cancelled",
        },
        completed_at: new Date().toISOString(),
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", row.id);
    if (!error) cancelledAgentRunIds.push(String(row.id));
  }

  // Also sweep any other active topic work when user stops
  try {
    const sweep = await cancelActiveTopicWork(client, {
      workspaceId: input.workspaceId,
      roomId: input.roomId,
      topicId: input.topicId,
      reason: input.reason ?? "Collaboration cancelled.",
      cancelReasonCode: "steward_cancelled",
    });
    for (const id of sweep.cancelledAgentRunIds) {
      if (!cancelledAgentRunIds.includes(id)) cancelledAgentRunIds.push(id);
    }
  } catch (err) {
    console.warn("[AdeHQ steward] topic cancel sweep", err);
  }

  return { cancelledAgentRunIds };
}
