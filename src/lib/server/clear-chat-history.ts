import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshTopicStats } from "@/lib/server/topic-stats";
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

/** Permanently remove chat messages for a topic while keeping the topic (and tasks, memory, etc.). */
export async function clearTopicChatHistory(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
  topicId: string,
): Promise<{ deletedMessageCount: number }> {
  const { data: messages, error: messagesLookupError } = await client
    .from("messages")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId);
  if (messagesLookupError) throw messagesLookupError;

  const messageIds = (messages ?? []).map((row) => String(row.id));

  if (messageIds.length) {
    const { error: reactionsError } = await client
      .from("message_reactions")
      .delete()
      .eq("workspace_id", workspaceId)
      .in("message_id", messageIds);
    if (reactionsError) throw reactionsError;

    const { error: attachmentsError } = await client
      .from("message_attachments")
      .delete()
      .eq("workspace_id", workspaceId)
      .in("message_id", messageIds);
    if (attachmentsError && !isMissingRelationError(attachmentsError)) throw attachmentsError;
  }

  const { error: messagesDeleteError } = await client
    .from("messages")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId);
  if (messagesDeleteError) throw messagesDeleteError;

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

  await refreshTopicStats(client, topicId);

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
