import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  OrchestrationIntent,
  OrchestrationPlan,
  OrchestrationWorkLogAction,
  PersistedOrchestrationEmployeeStatus,
  StoredOrchestrationRecord,
  TopicStewardSuggestion,
} from "./types";

type DbRow = Record<string, unknown>;

function nowIso() {
  return new Date().toISOString();
}

export function buildInitialEmployeeStatuses(
  plan: OrchestrationPlan,
): PersistedOrchestrationEmployeeStatus[] {
  return plan.responseOrder.map((entry) => ({
    employeeId: entry.employeeId,
    phase: "planned",
    updatedAt: nowIso(),
  }));
}

function rowToRecord(row: DbRow): StoredOrchestrationRecord {
  const statuses = Array.isArray(row.employee_statuses)
    ? (row.employee_statuses as PersistedOrchestrationEmployeeStatus[])
    : [];

  return {
    id: String(row.id),
    roomId: String(row.room_id),
    topicId: row.topic_id ? String(row.topic_id) : null,
    triggerMessageId: String(row.trigger_message_id),
    intent: row.intent as OrchestrationIntent,
    confidence: Number(row.confidence ?? 0),
    reason: String(row.reason ?? ""),
    selectedEmployeeIds: (row.selected_employee_ids as string[]) ?? [],
    leadEmployeeId: row.lead_employee_id ? String(row.lead_employee_id) : null,
    collaboratorEmployeeIds: (row.collaborator_employee_ids as string[]) ?? [],
    responseOrder:
      (row.response_order as OrchestrationPlan["responseOrder"]) ?? [],
    workLogRequired: Boolean(row.work_log_required),
    workLogReason: row.work_log_reason ? String(row.work_log_reason) : null,
    status: (row.status as StoredOrchestrationRecord["status"]) ?? "planned",
    employeeStatuses: statuses,
    completionWorkLogAt: row.completion_work_log_at
      ? String(row.completion_work_log_at)
      : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function recordToOrchestrationPlan(
  record: StoredOrchestrationRecord,
): OrchestrationPlan {
  return {
    intent: record.intent,
    confidence: record.confidence,
    reason: record.reason,
    selectedEmployeeIds: record.selectedEmployeeIds,
    leadEmployeeId: record.leadEmployeeId,
    collaboratorEmployeeIds: record.collaboratorEmployeeIds,
    shouldRespond: record.selectedEmployeeIds.length > 0,
    responseOrder: record.responseOrder,
    suggestedActions: [],
    workLogRequired: record.workLogRequired,
    workLogReason: record.workLogReason,
  };
}

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
  const employeeStatuses = buildInitialEmployeeStatuses(params.plan);

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
      employee_statuses: employeeStatuses,
      status: params.plan.shouldRespond ? "running" : "completed",
    })
    .select("id")
    .single();

  if (error) throw error;
  return String(data.id);
}

export async function attachRunIdsToOrchestration(
  client: SupabaseClient,
  workspaceId: string,
  orchestrationId: string,
  runIdsByEmployee: Record<string, string>,
): Promise<void> {
  const { data, error } = await client
    .from("conversation_orchestrations")
    .select("employee_statuses")
    .eq("workspace_id", workspaceId)
    .eq("id", orchestrationId)
    .maybeSingle();

  if (error || !data) return;

  const statuses = (
    (data.employee_statuses as PersistedOrchestrationEmployeeStatus[]) ?? []
  ).map((entry) => ({
    ...entry,
    runId: runIdsByEmployee[entry.employeeId] ?? entry.runId ?? null,
    updatedAt: nowIso(),
  }));

  await client
    .from("conversation_orchestrations")
    .update({ employee_statuses: statuses })
    .eq("workspace_id", workspaceId)
    .eq("id", orchestrationId);
}

export async function updateOrchestrationEmployeeStatus(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    orchestrationId: string;
    employeeId: string;
    phase: PersistedOrchestrationEmployeeStatus["phase"];
    detail?: string | null;
    waitingOnEmployeeName?: string | null;
    runId?: string | null;
  },
): Promise<PersistedOrchestrationEmployeeStatus[] | null> {
  const { data, error } = await client
    .from("conversation_orchestrations")
    .select("employee_statuses, status")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.orchestrationId)
    .maybeSingle();

  if (error || !data) return null;

  const statuses = (
    (data.employee_statuses as PersistedOrchestrationEmployeeStatus[]) ?? []
  ).map((entry) => {
    if (entry.employeeId !== params.employeeId) return entry;
    return {
      ...entry,
      phase: params.phase,
      detail: params.detail ?? entry.detail ?? null,
      waitingOnEmployeeName:
        params.waitingOnEmployeeName ?? entry.waitingOnEmployeeName ?? null,
      runId: params.runId ?? entry.runId ?? null,
      updatedAt: nowIso(),
    };
  });

  const allTerminal = statuses.every(
    (s) => s.phase === "completed" || s.phase === "failed",
  );
  const anyFailed = statuses.some((s) => s.phase === "failed");
  const nextStatus = allTerminal
    ? anyFailed
      ? "failed"
      : "completed"
    : "running";

  const { error: updateError } = await client
    .from("conversation_orchestrations")
    .update({
      employee_statuses: statuses,
      status: nextStatus,
    })
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.orchestrationId);

  if (updateError) {
    console.warn("[AdeHQ orchestrator] status update failed", updateError);
    return null;
  }

  return statuses;
}

const COMPLETION_ACTION_BY_INTENT: Partial<
  Record<OrchestrationIntent, OrchestrationWorkLogAction>
> = {
  panel_response: "panel_response_completed",
  lead_collaborator: "collaboration_completed",
  ambient_smart_assist: "collaboration_completed",
  handoff: "handoff_completed",
};

const COMPLETION_SUMMARY: Partial<Record<OrchestrationWorkLogAction, string>> = {
  panel_response_completed: "Completed panel review",
  collaboration_completed: "Completed collaboration",
  handoff_completed: "Completed handoff",
};

export async function maybeLogOrchestrationCompletion(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    orchestrationId: string;
    roomId: string;
    topicId?: string | null;
    intent: OrchestrationIntent;
    workLogRequired: boolean;
    workLogReason?: string | null;
    leadEmployeeId?: string | null;
    selectedEmployeeIds: string[];
    employeeStatuses: PersistedOrchestrationEmployeeStatus[];
  },
): Promise<boolean> {
  if (!params.workLogRequired) return false;

  const allTerminal = params.employeeStatuses.every(
    (s) => s.phase === "completed" || s.phase === "failed",
  );
  if (!allTerminal) return false;

  const action =
    (params.workLogReason as OrchestrationWorkLogAction | null) ??
    COMPLETION_ACTION_BY_INTENT[params.intent];
  if (!action || action === "topic_suggested") return false;

  const { data: claimed, error: claimError } = await client
    .from("conversation_orchestrations")
    .update({ completion_work_log_at: nowIso() })
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.orchestrationId)
    .is("completion_work_log_at", null)
    .select("id")
    .maybeSingle();

  if (claimError || !claimed) return false;

  const employeeId =
    params.leadEmployeeId ??
    params.selectedEmployeeIds[0] ??
    params.employeeStatuses[0]?.employeeId ??
    "system";

  await logOrchestrationWorkLog(client, {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.topicId,
    employeeId,
    action,
    summary: COMPLETION_SUMMARY[action] ?? action.replace(/_/g, " "),
    relatedEntityType: "orchestration",
    relatedEntityId: params.orchestrationId,
  });

  return true;
}

export async function fetchLatestOrchestrationForTopic(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
  maxAgeHours = 48,
): Promise<StoredOrchestrationRecord | null> {
  const since = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();

  const { data, error } = await client
    .from("conversation_orchestrations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("topic_id", topicId)
    .gte("created_at", since)
    .neq("intent", "silent_note")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const record = rowToRecord(data as DbRow);
  if (!record.selectedEmployeeIds.length) return null;
  return record;
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
    topicId?: string | null;
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
    topic_id: params.topicId ?? null,
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

/** After a terminal status update, write completion work log if appropriate. */
export async function finalizeOrchestrationIfComplete(
  client: SupabaseClient,
  workspaceId: string,
  orchestrationId: string,
): Promise<void> {
  const { data, error } = await client
    .from("conversation_orchestrations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", orchestrationId)
    .maybeSingle();

  if (error || !data) return;

  const record = rowToRecord(data as DbRow);
  await maybeLogOrchestrationCompletion(client, {
    workspaceId,
    orchestrationId,
    roomId: record.roomId,
    topicId: record.topicId,
    intent: record.intent,
    workLogRequired: record.workLogRequired,
    workLogReason: record.workLogReason,
    leadEmployeeId: record.leadEmployeeId,
    selectedEmployeeIds: record.selectedEmployeeIds,
    employeeStatuses: record.employeeStatuses,
  });
}