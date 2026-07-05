import type { SupabaseClient } from "@supabase/supabase-js";
import { nowISO } from "@/lib/utils";
import {
  isTerminalSuggestionState,
  type MemorySuggestionState,
} from "@/lib/memory/suggestion-lifecycle";
import type {
  TopicSummary,
  TopicSummaryFact,
  TopicSummaryMemorySuggestion,
  TopicSummaryNextAction,
  TopicSummaryQuestion,
} from "./types";

type DbRow = Record<string, unknown>;

const LIFECYCLE_METADATA_KEY = "memorySuggestionLifecycle";
export const CHAT_CLEARED_METADATA_KEY = "chatClearedAt";

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
    memorySuggestionLifecycle: parseLifecycle(row.memory_suggestion_lifecycle),
  };
}

function parseLifecycle(value: unknown): Record<string, MemorySuggestionState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, MemorySuggestionState>;
}

function mergeLifecycleSources(
  ...sources: Array<Record<string, MemorySuggestionState> | undefined>
): Record<string, MemorySuggestionState> {
  const merged: Record<string, MemorySuggestionState> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, state] of Object.entries(source)) {
      const existing = merged[key];
      if (!existing || isTerminalSuggestionState(state)) {
        merged[key] = state;
      } else if (!isTerminalSuggestionState(existing)) {
        merged[key] = state;
      }
    }
  }
  return merged;
}

async function fetchTopicMetadataRecord(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await client
    .from("topics")
    .select("metadata")
    .eq("workspace_id", workspaceId)
    .eq("id", topicId)
    .maybeSingle();
  if (error) throw error;
  return (data?.metadata as Record<string, unknown>) ?? {};
}

async function writeTopicMetadataLifecycle(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
  lifecycle: Record<string, MemorySuggestionState>,
): Promise<void> {
  const metadata = await fetchTopicMetadataRecord(client, workspaceId, topicId);
  const { error } = await client
    .from("topics")
    .update({
      metadata: { ...metadata, [LIFECYCLE_METADATA_KEY]: lifecycle },
      updated_at: nowISO(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", topicId);
  if (error) throw error;
}

/** Clear durable suggestion lifecycle stored on the topic (survives summary row deletion). */
export async function clearTopicMemorySuggestionLifecycle(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
): Promise<void> {
  const metadata = await fetchTopicMetadataRecord(client, workspaceId, topicId);
  if (!(LIFECYCLE_METADATA_KEY in metadata)) return;
  const next = { ...metadata };
  delete next[LIFECYCLE_METADATA_KEY];
  const { error } = await client
    .from("topics")
    .update({ metadata: next, updated_at: nowISO() })
    .eq("workspace_id", workspaceId)
    .eq("id", topicId);
  if (error) throw error;
}

export async function fetchTopicChatClearedAt(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
): Promise<string | null> {
  const metadata = await fetchTopicMetadataRecord(client, workspaceId, topicId);
  const value = metadata[CHAT_CLEARED_METADATA_KEY];
  return typeof value === "string" && value.trim() ? value : null;
}

export async function markTopicChatCleared(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
): Promise<void> {
  const metadata = await fetchTopicMetadataRecord(client, workspaceId, topicId);
  const timestamp = nowISO();
  const { error } = await client
    .from("topics")
    .update({
      metadata: { ...metadata, [CHAT_CLEARED_METADATA_KEY]: timestamp },
      updated_at: timestamp,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", topicId);
  if (error) throw error;
}

export async function countTopicMessages(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
): Promise<number> {
  const { count, error } = await client
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId);
  if (error) throw error;
  return count ?? 0;
}

/** When chat was cleared and no messages remain, suppress stale summary rows. */
export async function suppressSummaryIfChatCleared(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
): Promise<boolean> {
  const chatClearedAt = await fetchTopicChatClearedAt(client, workspaceId, topicId);
  if (!chatClearedAt) return false;
  const messageCount = await countTopicMessages(client, workspaceId, topicId);
  if (messageCount > 0) return false;

  await client
    .from("topic_summaries")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId)
    .then(({ error }) => {
      if (error && !String(error.message).includes("does not exist")) throw error;
    });

  await client
    .from("topics")
    .update({ summary: null, pinned_summary: null, updated_at: nowISO() })
    .eq("workspace_id", workspaceId)
    .eq("id", topicId);

  return true;
}

export async function fetchTopicSummary(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
): Promise<TopicSummary | null> {
  if (await suppressSummaryIfChatCleared(client, workspaceId, topicId)) {
    return null;
  }

  const [summaryResult, metadata] = await Promise.all([
    client
      .from("topic_summaries")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("topic_id", topicId)
      .maybeSingle(),
    fetchTopicMetadataRecord(client, workspaceId, topicId),
  ]);

  if (summaryResult.error) throw summaryResult.error;
  if (!summaryResult.data) return null;

  const summary = topicSummaryFromRow(summaryResult.data as DbRow);
  const metadataLifecycle = parseLifecycle(metadata[LIFECYCLE_METADATA_KEY]);
  return {
    ...summary,
    memorySuggestionLifecycle: mergeLifecycleSources(
      metadataLifecycle,
      summary.memorySuggestionLifecycle,
    ),
  };
}

export async function upsertTopicSummary(
  client: SupabaseClient,
  summary: TopicSummary,
): Promise<TopicSummary> {
  const timestamp = nowISO();
  const metadata = await fetchTopicMetadataRecord(
    client,
    summary.workspaceId,
    summary.topicId,
  );
  const metadataLifecycle = parseLifecycle(metadata[LIFECYCLE_METADATA_KEY]);
  const mergedLifecycle = mergeLifecycleSources(
    metadataLifecycle,
    summary.memorySuggestionLifecycle ?? {},
  );

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
    memory_suggestion_lifecycle: mergedLifecycle,
    updated_at: timestamp,
  };

  const { data, error } = await client
    .from("topic_summaries")
    .upsert(row, { onConflict: "workspace_id,topic_id" })
    .select("*")
    .single();

  if (error) throw error;

  await writeTopicMetadataLifecycle(
    client,
    summary.workspaceId,
    summary.topicId,
    mergedLifecycle,
  );

  await client
    .from("topics")
    .update({
      summary: summary.summary,
      updated_at: timestamp,
    })
    .eq("workspace_id", summary.workspaceId)
    .eq("id", summary.topicId);

  return {
    ...topicSummaryFromRow(data as DbRow),
    memorySuggestionLifecycle: mergedLifecycle,
  };
}

export async function updateMemorySuggestionLifecycle(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    topicId: string;
    suggestionKey: string;
    state: MemorySuggestionState;
  },
): Promise<Record<string, MemorySuggestionState>> {
  const metadata = await fetchTopicMetadataRecord(
    client,
    params.workspaceId,
    params.topicId,
  );
  const metadataLifecycle = mergeLifecycleSources(
    parseLifecycle(metadata[LIFECYCLE_METADATA_KEY]),
    { [params.suggestionKey]: params.state },
  );

  await writeTopicMetadataLifecycle(
    client,
    params.workspaceId,
    params.topicId,
    metadataLifecycle,
  );

  const { data: summaryRow, error: summaryLookupError } = await client
    .from("topic_summaries")
    .select("memory_suggestion_lifecycle")
    .eq("workspace_id", params.workspaceId)
    .eq("topic_id", params.topicId)
    .maybeSingle();
  if (summaryLookupError) throw summaryLookupError;

  if (summaryRow) {
    const summaryLifecycle = mergeLifecycleSources(
      parseLifecycle(summaryRow.memory_suggestion_lifecycle),
      { [params.suggestionKey]: params.state },
    );
    const { error } = await client
      .from("topic_summaries")
      .update({
        memory_suggestion_lifecycle: summaryLifecycle,
        updated_at: nowISO(),
      })
      .eq("workspace_id", params.workspaceId)
      .eq("topic_id", params.topicId);
    if (error) throw error;
    return mergeLifecycleSources(metadataLifecycle, summaryLifecycle);
  }

  return metadataLifecycle;
}
