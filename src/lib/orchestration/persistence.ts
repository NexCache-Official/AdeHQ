import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrchestrationPlan, TopicStewardSuggestion } from "./types";

type DbRow = Record<string, unknown>;

export async function persistOrchestrationPlan(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId?: string | null;
    triggerMessageId: string;
    createdBy: string;
    plan: OrchestrationPlan;
  },
): Promise<string> {
  const { data, error } = await client
    .from("conversation_orchestrations")
    .insert({
      workspace_id: params.workspaceId,
      room_id: params.roomId,
      topic_id: params.topicId ?? null,
      trigger_message_id: params.triggerMessageId,
      created_by: params.createdBy,
      intent: params.plan.intent,
      confidence: params.plan.confidence,
      reason: params.plan.reason,
      selected_employee_ids: params.plan.selectedEmployeeIds,
      lead_employee_id: params.plan.leadEmployeeId ?? null,
      collaborator_employee_ids: params.plan.collaboratorEmployeeIds ?? [],
      response_order: params.plan.responseOrder,
      suggested_actions: params.plan.suggestedActions,
      work_log_required: params.plan.workLogRequired,
      work_log_reason: params.plan.workLogReason ?? null,
      status: params.plan.shouldRespond ? "running" : "completed",
    })
    .select("id")
    .single();

  if (error) throw error;
  return String(data.id);
}

export async function persistTopicSuggestions(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId?: string | null;
    orchestrationId?: string | null;
    triggerMessageId: string;
    createdBy: string;
    suggestions: TopicStewardSuggestion[];
  },
): Promise<DbRow[]> {
  if (!params.suggestions.length) return [];

  const rows = params.suggestions.map((suggestion) => ({
    workspace_id: params.workspaceId,
    room_id: params.roomId,
    topic_id: params.topicId ?? null,
    orchestration_id: params.orchestrationId ?? null,
    trigger_message_id: params.triggerMessageId,
    type: suggestion.type,
    title: suggestion.type === "move_to_existing_topic" ? null : suggestion.title,
    target_topic_id:
      suggestion.type === "move_to_existing_topic" ? suggestion.topicId : null,
    reason: suggestion.reason,
    confidence: suggestion.confidence,
    message_ids: suggestion.messageIds,
    status: "pending",
    created_by: params.createdBy,
  }));

  const { data, error } = await client.from("topic_suggestions").insert(rows).select("*");
  if (error) throw error;
  return (data as DbRow[]) ?? [];
}

export async function logOrchestrationWorkLog(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    employeeId: string;
    action: string;
    summary: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  },
): Promise<void> {
  const id = `wl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await client.from("work_log_events").insert({
    workspace_id: params.workspaceId,
    id,
    room_id: params.roomId,
    employee_id: params.employeeId,
    action: params.action,
    summary: params.summary,
    status: "success",
    related_entity_type: params.relatedEntityType ?? null,
    related_entity_id: params.relatedEntityId ?? null,
    created_at: new Date().toISOString(),
  });
  if (error) console.warn("[AdeHQ orchestrator] work log insert failed", error);
}

export async function dismissTopicSuggestion(
  client: SupabaseClient,
  workspaceId: string,
  suggestionId: string,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from("topic_suggestions")
    .update({
      status: "dismissed",
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", suggestionId);
  if (error) throw error;
}

export async function acceptTopicSuggestion(
  client: SupabaseClient,
  workspaceId: string,
  suggestionId: string,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from("topic_suggestions")
    .update({
      status: "accepted",
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", suggestionId);
  if (error) throw error;
}

export async function fetchPendingTopicSuggestions(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
): Promise<DbRow[]> {
  const { data, error } = await client
    .from("topic_suggestions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("room_id", roomId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  return (data as DbRow[]) ?? [];
}
