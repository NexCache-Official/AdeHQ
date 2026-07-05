import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshTopicStats } from "@/lib/server/topic-stats";
import { topicFromRow } from "@/lib/server/topic-helpers";
import { isGeneralTopic } from "@/lib/topics";
import {
  clearTopicMemorySuggestionLifecycle,
  countTopicMessages,
} from "@/lib/topic-summary/persistence";
import { markTopicConversationCleared } from "@/lib/conversation-context/epochs";
import { cancelActiveTopicWork } from "@/lib/server/cancel-active-topic-work";
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

async function cancelTopicAgentRuns(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
): Promise<void> {
  const { data: activeRuns, error } = await client
    .from("agent_runs")
    .select("id, run_metadata, status")
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId)
    .in("status", ["queued", "waiting", "running"]);
  if (error && !isMissingRelationError(error)) throw error;

  for (const row of (activeRuns as Record<string, unknown>[] | null) ?? []) {
    const runId = String(row.id);
    const status = String(row.status);
    const meta = { ...((row.run_metadata as Record<string, unknown>) ?? {}) };
    meta.collaborationStatus = "cancelled";
    meta.cancelReason = "chat_history_cleared";

    if (status === "queued" || status === "waiting") {
      const { error: cancelError } = await client
        .from("agent_runs")
        .update({
          status: "cancelled",
          error_message: "Chat history cleared",
          run_metadata: meta,
          completed_at: nowISO(),
        })
        .eq("workspace_id", workspaceId)
        .eq("id", runId);
      if (cancelError && !isMissingRelationError(cancelError)) throw cancelError;
    } else if (status === "running") {
      const { error: failError } = await client
        .from("agent_runs")
        .update({
          status: "failed",
          error_message: "Chat history cleared",
          run_metadata: meta,
          completed_at: nowISO(),
        })
        .eq("workspace_id", workspaceId)
        .eq("id", runId);
      if (failError && !isMissingRelationError(failError)) throw failError;
    }
  }
}

async function collectMessageIdsForClear(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  topicId: string,
  includeRoomOrphans: boolean,
): Promise<string[]> {
  const ids = new Set<string>();

  const { data: topicMessages, error: topicMessagesError } = await client
    .from("messages")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId);
  if (topicMessagesError) throw topicMessagesError;
  for (const row of topicMessages ?? []) ids.add(String(row.id));

  if (includeRoomOrphans) {
    const { data: orphanMessages, error: orphanError } = await client
      .from("messages")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("room_id", roomId)
      .is("topic_id", null);
    if (orphanError) throw orphanError;
    for (const row of orphanMessages ?? []) ids.add(String(row.id));
  }

  return Array.from(ids);
}

async function deleteMessageGraph(
  client: SupabaseClient,
  workspaceId: string,
  messageIds: string[],
): Promise<void> {
  if (!messageIds.length) return;

  const { error: reactionsError } = await client
    .from("message_reactions")
    .delete()
    .eq("workspace_id", workspaceId)
    .in("message_id", messageIds);
  if (reactionsError && !isMissingRelationError(reactionsError)) throw reactionsError;

  const { error: attachmentsError } = await client
    .from("message_attachments")
    .delete()
    .eq("workspace_id", workspaceId)
    .in("message_id", messageIds);
  if (attachmentsError && !isMissingRelationError(attachmentsError)) throw attachmentsError;

  const { error: messagesDeleteError } = await client
    .from("messages")
    .delete()
    .eq("workspace_id", workspaceId)
    .in("id", messageIds);
  if (messagesDeleteError) throw messagesDeleteError;
}

/** Permanently remove chat messages for a topic while keeping the topic (and tasks, memory, etc.). */
export async function clearTopicChatHistory(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  topicId: string,
): Promise<{ deletedMessageCount: number }> {
  const { data: topicRow, error: topicError } = await client
    .from("topics")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", topicId)
    .maybeSingle();
  if (topicError) throw topicError;
  if (!topicRow) throw new Error("Topic not found.");

  const topic = topicFromRow(topicRow as Record<string, unknown>);
  const includeRoomOrphans = isGeneralTopic(topic);

  await cancelTopicAgentRuns(client, workspaceId, topicId);
  await cancelActiveTopicWork(client, {
    workspaceId,
    roomId,
    topicId,
    reason: "Chat history cleared.",
  }).catch((error) => {
    console.warn("[AdeHQ clear chat] cancel active work failed", error);
  });
  await markTopicConversationCleared(client, {
    workspaceId,
    roomId,
    topicId,
    scopeType: "topic",
  });

  const messageIds = await collectMessageIdsForClear(
    client,
    workspaceId,
    roomId,
    topicId,
    includeRoomOrphans,
  );
  await deleteMessageGraph(client, workspaceId, messageIds);

  await client
    .from("topic_summaries")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId)
    .then(({ error }) => {
      if (error && !isMissingRelationError(error)) throw error;
    });

  await client
    .from("browser_research_runs")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId)
    .then(({ error }) => {
      if (error && !isMissingRelationError(error)) throw error;
    });

  await client
    .from("topics")
    .update({ summary: null, pinned_summary: null, updated_at: nowISO() })
    .eq("workspace_id", workspaceId)
    .eq("id", topicId);

  await clearTopicMemorySuggestionLifecycle(client, workspaceId, topicId);
  await refreshTopicStats(client, topicId);

  const remaining = await countTopicMessages(client, workspaceId, topicId);
  if (remaining > 0) {
    throw new Error(`Clear incomplete: ${remaining} message(s) still remain for this topic.`);
  }

  if (includeRoomOrphans) {
    const { count: orphanCount, error: orphanCountError } = await client
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("room_id", roomId)
      .is("topic_id", null);
    if (orphanCountError) throw orphanCountError;
    if ((orphanCount ?? 0) > 0) {
      throw new Error(`Clear incomplete: ${orphanCount} untagged message(s) remain in this room.`);
    }
  }

  return { deletedMessageCount: messageIds.length };
}

/** Clear chat history for every topic in a room (keeps the room and topics). */
export async function clearRoomChatHistory(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
): Promise<{ deletedMessageCount: number; clearedTopicCount: number }> {
  const { data: topics, error: topicsError } = await client
    .from("topics")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("room_id", roomId);
  if (topicsError) throw topicsError;

  let deletedMessageCount = 0;
  for (const topic of topics ?? []) {
    const result = await clearTopicChatHistory(client, workspaceId, roomId, String(topic.id));
    deletedMessageCount += result.deletedMessageCount;
  }

  return { deletedMessageCount, clearedTopicCount: (topics ?? []).length };
}
