import type { SupabaseClient } from "@supabase/supabase-js";
import { type TopicSuggestionGovernanceContext } from "./topic-governance";
import { scheduleTopicSummaryRefresh } from "@/lib/topic-summary/refresh";
import type {
  OrchestrationIntent,
  OrchestrationPlan,
  OrchestrationWorkLogAction,
  PersistedOrchestrationEmployeeStatus,
  StoredOrchestrationRecord,
  TopicStewardSuggestion,
} from "./types";

export type TopicOrchestrationHydration = {
  active: StoredOrchestrationRecord | null;
  history: StoredOrchestrationRecord[];
};

const HYDRATION_PERF_MAX_AGE_DAYS = 90;

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

function isHydratableOrchestration(record: StoredOrchestrationRecord): boolean {
  return record.selectedEmployeeIds.length > 0;
}

function isHistoryOrchestration(record: StoredOrchestrationRecord): boolean {
  if (record.intent === "social_broadcast") return false;
  return isHydratableOrchestration(record);
}

export async function fetchOrchestrationsForTopicHydration(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
  opts?: { maxAgeDays?: number; excludeIds?: string[] },
): Promise<TopicOrchestrationHydration> {
  const maxAgeDays = opts?.maxAgeDays ?? HYDRATION_PERF_MAX_AGE_DAYS;
  const since = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
  const exclude = new Set(opts?.excludeIds ?? []);

  const [activeResult, historyResult] = await Promise.all([
    client
      .from("conversation_orchestrations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("topic_id", topicId)
      .in("status", ["planned", "running"])
      .neq("intent", "silent_note")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("conversation_orchestrations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("topic_id", topicId)
      .in("status", ["completed", "failed"])
      .neq("intent", "silent_note")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  let active: StoredOrchestrationRecord | null = null;
  if (activeResult.data && !activeResult.error) {
    const record = rowToRecord(activeResult.data as DbRow);
    if (isHydratableOrchestration(record) && !exclude.has(record.id)) {
      active = record;
    }
  }

  const history = ((historyResult.data ?? []) as DbRow[])
    .map((row) => rowToRecord(row))
    .filter(
      (record) =>
        isHistoryOrchestration(record) &&
        !exclude.has(record.id) &&
        (!active || record.id !== active.id),
    )
    .slice(0, 5);

  return { active, history };
}

/** @deprecated Use fetchOrchestrationsForTopicHydration */
export async function fetchLatestOrchestrationForTopic(
  client: SupabaseClient,
  workspaceId: string,
  topicId: string,
): Promise<StoredOrchestrationRecord | null> {
  const { active, history } = await fetchOrchestrationsForTopicHydration(
    client,
    workspaceId,
    topicId,
  );
  return active ?? history[0] ?? null;
}

export async function fetchTopicSuggestionGovernance(
  client: SupabaseClient,
  workspaceId: string,
  roomId: string,
): Promise<TopicSuggestionGovernanceContext> {
  const since24h = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();

  const [dismissedResult, recentResult] = await Promise.all([
    client
      .from("topic_suggestions")
      .select("title, target_topic_id, trigger_message_id, resolved_at, type")
      .eq("workspace_id", workspaceId)
      .eq("room_id", roomId)
      .eq("status", "dismissed"),
    client
      .from("topic_suggestions")
      .select("title, target_topic_id, type, created_at")
      .eq("workspace_id", workspaceId)
      .eq("room_id", roomId)
      .gte("created_at", since24h),
  ]);

  const topicIds = new Set<string>();
  for (const row of [...(dismissedResult.data ?? []), ...(recentResult.data ?? [])]) {
    const targetId = row.target_topic_id ? String(row.target_topic_id) : null;
    if (targetId) topicIds.add(targetId);
  }

  const topicTitleById = new Map<string, string>();
  if (topicIds.size) {
    const { data: topics } = await client
      .from("topics")
      .select("id, title")
      .eq("workspace_id", workspaceId)
      .in("id", Array.from(topicIds));
    for (const topic of topics ?? []) {
      topicTitleById.set(String(topic.id), String(topic.title));
    }
  }

  const resolveTitle = (row: Record<string, unknown>) => {
    if (row.title) return String(row.title);
    const targetId = row.target_topic_id ? String(row.target_topic_id) : "";
    return topicTitleById.get(targetId) ?? "";
  };

  const dismissedTitles = ((dismissedResult.data ?? []) as Record<string, unknown>[])
    .map((row) => ({
      title: resolveTitle(row),
      dismissedAt: String(row.resolved_at ?? new Date().toISOString()),
    }))
    .filter((entry) => entry.title.trim());

  const recentSuggestedTitles = ((recentResult.data ?? []) as Record<string, unknown>[])
    .map((row) => ({
      title: resolveTitle(row),
      suggestedAt: String(row.created_at),
    }))
    .filter((entry) => entry.title.trim());

  const dismissedTriggerMessageIds = Array.from(
    new Set(
      ((dismissedResult.data ?? []) as Record<string, unknown>[])
        .map((row) => (row.trigger_message_id ? String(row.trigger_message_id) : ""))
        .filter(Boolean),
    ),
  );

  return { dismissedTitles, recentSuggestedTitles, dismissedTriggerMessageIds };
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

  if (record.topicId) {
    const trigger =
      record.intent === "handoff"
        ? "handoff_completed"
        : record.intent === "panel_response" || record.intent === "lead_collaborator"
          ? "panel_collaboration_completed"
          : null;
    if (trigger) {
      const { data: topicRow } = await client
        .from("topics")
        .select("title, description")
        .eq("workspace_id", workspaceId)
        .eq("id", record.topicId)
        .maybeSingle();
      if (topicRow) {
        scheduleTopicSummaryRefresh(client, {
          workspaceId,
          roomId: record.roomId,
          topicId: record.topicId,
          topicTitle: String(topicRow.title),
          topicDescription: topicRow.description ? String(topicRow.description) : null,
          trigger,
          employeeId: record.leadEmployeeId ?? record.selectedEmployeeIds[0],
        });
      }
    }
  }
}