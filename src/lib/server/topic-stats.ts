import type { SupabaseClient } from "@supabase/supabase-js";
import { nowISO } from "@/lib/utils";

/** Recompute denormalized counters on room_topics after writes. */
export async function refreshTopicStats(
  client: SupabaseClient,
  topicId: string,
): Promise<void> {
  const [
    messagesResult,
    tasksResult,
    openTasksResult,
    memoryResult,
    approvalsResult,
    runsResult,
    lastMessageResult,
  ] = await Promise.all([
    client
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("topic_id", topicId),
    client
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("topic_id", topicId),
    client
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("topic_id", topicId)
      .in("status", ["open", "in_progress", "waiting_approval", "blocked"]),
    client
      .from("memory_entries")
      .select("id", { count: "exact", head: true })
      .eq("topic_id", topicId),
    client
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("topic_id", topicId)
      .eq("status", "pending"),
    client
      .from("agent_runs")
      .select("id", { count: "exact", head: true })
      .eq("topic_id", topicId),
    client
      .from("messages")
      .select("created_at")
      .eq("topic_id", topicId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const errors = [
    messagesResult.error,
    tasksResult.error,
    openTasksResult.error,
    memoryResult.error,
    approvalsResult.error,
    runsResult.error,
    lastMessageResult.error,
  ].filter(Boolean);
  if (errors.length) throw errors[0];

  const lastMessageAt = lastMessageResult.data?.created_at
    ? String(lastMessageResult.data.created_at)
    : null;

  const { error } = await client
    .from("room_topics")
    .update({
      message_count: messagesResult.count ?? 0,
      task_count: tasksResult.count ?? 0,
      open_task_count: openTasksResult.count ?? 0,
      memory_count: memoryResult.count ?? 0,
      approval_count: approvalsResult.count ?? 0,
      agent_run_count: runsResult.count ?? 0,
      last_message_at: lastMessageAt,
      last_activity_at: lastMessageAt ?? nowISO(),
      updated_at: nowISO(),
    })
    .eq("id", topicId);
  if (error) throw error;
}
