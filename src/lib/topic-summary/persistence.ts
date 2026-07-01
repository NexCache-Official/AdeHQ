import type { SupabaseClient } from "@supabase/supabase-js";
import { nowISO } from "@/lib/utils";
import type {
  TopicSummary,
  TopicSummaryFact,
  TopicSummaryMemorySuggestion,
  TopicSummaryNextAction,
  TopicSummaryQuestion,
} from "./types";

type DbRow = Record<string, unknown>;

function parseJsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function topicSummaryFromRow(row: DbRow): TopicSummary {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    roomId: String(row.room_id),
    topicId: String(row.topic_id),
    summary: String(row.summary ?? ""),
    whatHappened: String(row.what_happened ?? ""),
    currentDecision: row.current_decision ? String(row.current_decision) : null,
    openQuestions: parseJsonArray<TopicSummaryQuestion>(row.open_questions),
    keyFacts: parseJsonArray<TopicSummaryFact>(row.key_facts),
    nextActions: parseJsonArray<TopicSummaryNextAction>(row.next_actions),
    suggestedMemory: parseJsonArray<TopicSummaryMemorySuggestion>(row.suggested_memory),
    sourceMessageIds: Array.isArray(row.source_message_ids)
      ? row.source_message_ids.map(String)
      : [],
    sourceWorkLogIds: Array.isArray(row.source_work_log_ids)
      ? row.source_work_log_ids.map(String)
      : [],
    lastRefreshedAt: row.last_refreshed_at ? String(row.last_refreshed_at) : null,
  };
}

export async function fetchTopicSummary(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
): Promise<TopicSummary | null> {
  const { data, error } = await client
    .from("topic_summaries")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId)
    .maybeSingle();

  if (error || !data) return null;
  return topicSummaryFromRow(data as DbRow);
}

export async function upsertTopicSummary(
  client: SupabaseClient,
  summary: TopicSummary,
): Promise<TopicSummary> {
  const timestamp = nowISO();
  const row = {
    workspace_id: summary.workspaceId,
    room_id: summary.roomId,
    topic_id: summary.topicId,
    summary: summary.summary,
    what_happened: summary.whatHappened,
    current_decision: summary.currentDecision,
    open_questions: summary.openQuestions,
    key_facts: summary.keyFacts,
    next_actions: summary.nextActions,
    suggested_memory: summary.suggestedMemory,
    source_message_ids: summary.sourceMessageIds,
    source_work_log_ids: summary.sourceWorkLogIds,
    last_refreshed_at: summary.lastRefreshedAt ?? timestamp,
    updated_at: timestamp,
  };

  const { data, error } = await client
    .from("topic_summaries")
    .upsert(row, { onConflict: "workspace_id,topic_id" })
    .select("*")
    .single();

  if (error) throw error;

  await client
    .from("channel_topics")
    .update({
      summary: summary.summary,
      updated_at: timestamp,
    })
    .eq("workspace_id", summary.workspaceId)
    .eq("id", summary.topicId);

  return topicSummaryFromRow(data as DbRow);
}
