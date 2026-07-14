import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageArtifact } from "@/lib/types";
import type { IntegrationJobRecord } from "@/lib/integrations/types";
import {
  queuedArtifactJobId,
  reconcileQueuedArtifact,
} from "@/lib/integrations/reconcile-queued-artifacts";

type DbRow = Record<string, unknown>;

/**
 * When a background artifact job finishes, the AI chat message may still show
 * "Generating…". Patch that message's artifacts so reload/realtime sees success.
 */
export async function reconcileChatArtifactsForJob(
  client: SupabaseClient,
  job: IntegrationJobRecord,
): Promise<void> {
  if (job.status !== "success" && job.status !== "failed") return;

  const payload = job.payload ?? {};
  const ctx = (payload.ctx ?? {}) as Record<string, unknown>;
  const triggerMessageId = ctx.triggerMessageId ? String(ctx.triggerMessageId) : undefined;
  const roomId = ctx.roomId ? String(ctx.roomId) : undefined;

  let query = client
    .from("messages")
    .select("id, artifacts")
    .eq("workspace_id", job.workspaceId)
    .eq("sender_type", "ai")
    .order("created_at", { ascending: false })
    .limit(12);

  if (triggerMessageId) {
    query = query.eq("trigger_message_id", triggerMessageId);
  } else if (roomId) {
    query = query.eq("room_id", roomId);
  } else {
    return;
  }

  const { data, error } = await query;
  if (error || !data?.length) return;

  for (const row of data as DbRow[]) {
    const artifacts = Array.isArray(row.artifacts)
      ? (row.artifacts as MessageArtifact[])
      : null;
    if (!artifacts?.length) continue;

    const hasQueued = artifacts.some((artifact) => queuedArtifactJobId(artifact) === job.id);
    if (!hasQueued) continue;

    const next = artifacts.map((artifact) =>
      queuedArtifactJobId(artifact) === job.id
        ? reconcileQueuedArtifact(artifact, job)
        : artifact,
    );

    const { error: updateError } = await client
      .from("messages")
      .update({ artifacts: next })
      .eq("workspace_id", job.workspaceId)
      .eq("id", String(row.id));

    if (updateError) {
      console.warn("[AdeHQ integrations] chat artifact reconcile failed", {
        jobId: job.id,
        messageId: row.id,
        error: updateError.message,
      });
    }
    return;
  }
}
