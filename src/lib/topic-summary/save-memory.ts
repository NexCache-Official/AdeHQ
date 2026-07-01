import type { SupabaseClient } from "@supabase/supabase-js";
import { logOrchestrationWorkLog } from "@/lib/orchestration/persistence";
import { nowISO, uid } from "@/lib/utils";
import { fetchTopicSummary } from "./persistence";
import type { TopicSummaryMemorySuggestion } from "./types";

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
): Promise<{ memoryId: string }> {
  const summary = await fetchTopicSummary(client, params.workspaceId, params.topicId);
  if (!summary?.summary.trim()) {
    throw new Error("No topic summary to save.");
  }

  const memoryId = uid("mem");
  const content = [
    summary.summary,
    summary.whatHappened ? `\n\nWhat happened:\n${summary.whatHappened}` : "",
    summary.currentDecision ? `\n\nDecision:\n${summary.currentDecision}` : "",
    summary.openQuestions.length
      ? `\n\nOpen questions:\n${summary.openQuestions.map((q) => `- ${q.text}`).join("\n")}`
      : "",
    summary.keyFacts.length
      ? `\n\nKey facts:\n${summary.keyFacts.map((f) => `- ${f.text}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const { error } = await client.from("memory_entries").insert({
    workspace_id: params.workspaceId,
    id: memoryId,
    channel_id: params.roomId,
    topic_id: params.topicId,
    type: "general",
    title: `Topic summary — ${params.topicTitle}`,
    content,
    status: "approved",
    created_by_type: "human",
    created_by_id: params.userId,
    created_at: nowISO(),
  });
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

  return { memoryId };
}

export async function saveSuggestedMemoryToMemory(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId: string;
    userId: string;
    suggestion: TopicSummaryMemorySuggestion;
    employeeId?: string;
  },
): Promise<{ memoryId: string }> {
  const memoryId = uid("mem");
  const topicScoped = params.suggestion.scope === "topic";

  const { error } = await client.from("memory_entries").insert({
    workspace_id: params.workspaceId,
    id: memoryId,
    channel_id: params.roomId,
    topic_id: topicScoped ? params.topicId : null,
    type: "general",
    title: params.suggestion.text.slice(0, 120),
    content: `${params.suggestion.text}\n\nReason: ${params.suggestion.reason}`,
    status: "approved",
    created_by_type: "human",
    created_by_id: params.userId,
    created_at: nowISO(),
  });
  if (error) throw error;

  await logOrchestrationWorkLog(client, {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.topicId,
    employeeId: params.employeeId ?? params.userId,
    action: "memory_saved",
    summary: `Saved suggested memory: ${params.suggestion.text.slice(0, 80)}`,
    relatedEntityType: "memory",
    relatedEntityId: memoryId,
  });

  return { memoryId };
}
