import type { SupabaseClient } from "@supabase/supabase-js";
import { logOrchestrationWorkLog } from "@/lib/orchestration/persistence";
import { resolveMemoryInsert } from "@/lib/memory/dedupe";
import { suggestionKeyForTopicSummary } from "@/lib/memory/fingerprint";
import {
  buildMemoryEntryFields,
  memoryEntryToRow,
  memoryRowToEntry,
} from "@/lib/memory/build-entry";
import type { MemoryEntry, MemoryScope } from "@/lib/types";
import { nowISO, uid } from "@/lib/utils";
import { fetchTopicSummary, updateMemorySuggestionLifecycle } from "./persistence";
import { normalizeMemoryScope, scopeUsesTopicId } from "@/lib/memory/scope-rules";
import type { TopicSummaryMemorySuggestion } from "./types";

export type SaveMemoryResult = {
  memoryId: string;
  duplicate: boolean;
  memory?: MemoryEntry;
};

export { memoryRowToEntry };

export async function saveTopicSummaryToMemory(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId: string;
    topicTitle: string;
    userId: string;
    employeeId?: string;
  },
): Promise<SaveMemoryResult> {
  const summary = await fetchTopicSummary(client, params.workspaceId, params.topicId);
  if (!summary?.summary.trim()) {
    throw new Error("No topic summary to save.");
  }

  const summaryText = [
    summary.summary,
    summary.whatHappened ? `\n\nWhat happened:\n${summary.whatHappened}` : "",
    summary.currentDecision ? `\n\nDirection:\n${summary.currentDecision}` : "",
    summary.openQuestions.length
      ? `\n\nOpen questions:\n${summary.openQuestions.map((q) => `- ${q.text}`).join("\n")}`
      : "",
    summary.keyFacts.length
      ? `\n\nKey facts:\n${summary.keyFacts.map((f) => `- ${f.text}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const fields = buildMemoryEntryFields({
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.topicId,
    topicTitle: params.topicTitle,
    userId: params.userId,
    isTopicSummary: true,
    summaryText,
    dedupeKey: "",
  });

  const dedupeInput = {
    workspaceId: params.workspaceId,
    title: fields.title,
    content: fields.content,
    scope: "topic" as const,
    roomId: params.roomId,
    topicId: params.topicId,
    suggestionKey: `topic-summary-full:${params.topicId}:${summary.lastRefreshedAt ?? "none"}`,
  };

  const { dedupeKey, existing } = await resolveMemoryInsert(client, params.workspaceId, dedupeInput);
  if (existing) {
    return { memoryId: existing.id, duplicate: true, memory: existing };
  }

  const memoryId = uid("mem");
  const createdAt = nowISO();
  const row = memoryEntryToRow(params.workspaceId, memoryId, fields, {
    roomId: params.roomId,
    topicId: params.topicId,
    dedupeKey,
    createdAt,
  });

  const { data, error } = await client.from("memory_entries").insert(row).select("*").single();
  if (error) throw error;

  await logOrchestrationWorkLog(client, {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.topicId,
    employeeId: params.employeeId ?? params.userId,
    action: "topic_summary_saved_to_memory",
    summary: `Saved topic summary to memory: ${params.topicTitle}`,
    relatedEntityType: "memory",
    relatedEntityId: memoryId,
  });

  return { memoryId, duplicate: false, memory: memoryRowToEntry(data as Record<string, unknown>) };
}

export async function saveSuggestedMemoryToMemory(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId: string;
    userId: string;
    suggestion: TopicSummaryMemorySuggestion;
    suggestionIndex: number;
    employeeId?: string;
    scopeOverride?: MemoryScope;
    dmEmployeeId?: string;
  },
): Promise<SaveMemoryResult> {
  const scope = normalizeMemoryScope(params.scopeOverride ?? params.suggestion.scope);
  const topicScoped = scopeUsesTopicId(scope);

  const fields = buildMemoryEntryFields({
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: topicScoped ? params.topicId : null,
    userId: params.userId,
    suggestion: params.suggestion,
    suggestionIndex: params.suggestionIndex,
    scopeOverride: scope,
    dmEmployeeId: params.dmEmployeeId,
    dedupeKey: "",
  });

  const suggestionKey = suggestionKeyForTopicSummary(params.topicId, {
    title: params.suggestion.title,
    content: params.suggestion.content,
    text: params.suggestion.text,
    sourceMessageId: params.suggestion.sourceMessageId,
  });

  const dedupeInput = {
    workspaceId: params.workspaceId,
    title: fields.title,
    content: fields.content,
    scope,
    roomId: params.roomId,
    topicId: topicScoped ? params.topicId : null,
    sourceMessageId: params.suggestion.sourceMessageId,
    suggestionKey,
  };

  const { dedupeKey, existing } = await resolveMemoryInsert(client, params.workspaceId, dedupeInput);
  if (existing) {
    await updateMemorySuggestionLifecycle(client, {
      workspaceId: params.workspaceId,
      topicId: params.topicId,
      suggestionKey,
      state: "already_saved",
    }).catch(() => undefined);
    return { memoryId: existing.id, duplicate: true, memory: existing };
  }

  const memoryId = uid("mem");
  const createdAt = nowISO();
  const row = memoryEntryToRow(params.workspaceId, memoryId, fields, {
    roomId: params.roomId,
    topicId: topicScoped ? params.topicId : null,
    dedupeKey,
    createdAt,
  });

  const { data, error } = await client.from("memory_entries").insert(row).select("*").single();
  if (error) throw error;

  await logOrchestrationWorkLog(client, {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.topicId,
    employeeId: params.employeeId ?? params.userId,
    action: "memory_saved",
    summary: fields.content || fields.title,
    relatedEntityType: params.suggestion.sourceMessageId ? "message" : "memory",
    relatedEntityId: params.suggestion.sourceMessageId ?? memoryId,
  });

  await updateMemorySuggestionLifecycle(client, {
    workspaceId: params.workspaceId,
    topicId: params.topicId,
    suggestionKey,
    state: "saved",
  }).catch(() => undefined);

  return { memoryId, duplicate: false, memory: memoryRowToEntry(data as Record<string, unknown>) };
}
