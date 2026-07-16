import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIEmployee, ResponseReason, RoomTopic } from "@/lib/types";
import { extractMentions } from "@/lib/utils";
import {
  isActionOriented,
  isDeferredWorkPromise,
  isLowActionMessage,
  MAX_AI_TO_AI_HOPS,
  MAX_FOLLOW_UP_RUNS_PER_ROOT,
  MAX_SAME_EMPLOYEE_REENTRY,
  MAX_SELF_CONTINUATIONS_PER_ROOT,
} from "@/lib/server/room-governance";
import { isAiQueueingBlocked, isEmployeeBlockedInTopic } from "@/lib/topic-ai-control";
import type { ResponderDecision } from "@/lib/server/conversation-orchestrator";
import { queueAgentRuns, type QueuedRun } from "@/lib/server/queue-agent-runs";
import { messageLikelyNeedsStructuredEffects } from "@/lib/ai/message-intent";

type DbRow = Record<string, unknown>;

export type FollowUpParams = {
  workspaceId: string;
  roomId: string;
  topic: RoomTopic;
  employees: AIEmployee[];
  aiMessageId: string;
  aiReply: string;
  sourceEmployee: AIEmployee;
  parentRunId: string;
  rootTriggerMessageId: string;
  handoffTo?: string[];
  handoffDepth: number;
  isGreetingRun?: boolean;
  runMetadata?: Record<string, unknown>;
};

function resolveHandoffTargets(
  content: string,
  handoffTo: string[] | undefined,
  employees: AIEmployee[],
  sourceEmployeeId: string,
): AIEmployee[] {
  const ids = new Set<string>();

  if (handoffTo?.length) {
    for (const name of handoffTo) {
      const match = employees.find(
        (e) =>
          e.id !== sourceEmployeeId &&
          (e.name.toLowerCase() === name.toLowerCase() ||
            e.name.toLowerCase().includes(name.toLowerCase())),
      );
      if (match) ids.add(match.id);
    }
  }

  for (const id of extractMentions(
    content,
    employees.map((e) => ({ id: e.id, name: e.name })),
  )) {
    if (id !== sourceEmployeeId) ids.add(id);
  }

  return employees.filter((e) => ids.has(e.id));
}

async function loadChainState(
  client: SupabaseClient,
  workspaceId: string,
  rootTriggerMessageId: string,
): Promise<{
  followUpCount: number;
  respondedEmployeeIds: Set<string>;
  employeeEntryCounts: Map<string, number>;
}> {
  const { data } = await client
    .from("agent_runs")
    .select("employee_id, response_reason, handoff_depth")
    .eq("workspace_id", workspaceId)
    .eq("root_trigger_message_id", rootTriggerMessageId);

  const rows = (data as DbRow[] | null) ?? [];
  const respondedEmployeeIds = new Set(rows.map((r) => String(r.employee_id)));
  const employeeEntryCounts = new Map<string, number>();
  for (const row of rows) {
    const id = String(row.employee_id);
    employeeEntryCounts.set(id, (employeeEntryCounts.get(id) ?? 0) + 1);
  }

  const followUpCount = rows.filter((r) => {
    const reason = String(r.response_reason ?? "");
    return reason === "ai_mention" || reason === "handoff";
  }).length;

  return { followUpCount, respondedEmployeeIds, employeeEntryCounts };
}

async function hasExistingFollowUp(
  client: SupabaseClient,
  workspaceId: string,
  rootTriggerMessageId: string,
  triggerMessageId: string,
  employeeId: string,
  reason: ResponseReason,
): Promise<boolean> {
  const { data } = await client
    .from("agent_runs")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("root_trigger_message_id", rootTriggerMessageId)
    .eq("trigger_message_id", triggerMessageId)
    .eq("employee_id", employeeId)
    .eq("response_reason", reason)
    .in("status", ["queued", "running", "completed"])
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

export async function queueFollowUpRuns(
  client: SupabaseClient,
  params: FollowUpParams,
): Promise<{ followUpRuns: QueuedRun[]; skipped: string[] }> {
  const skipped: string[] = [];
  if (params.isGreetingRun) {
    return { followUpRuns: [], skipped: ["greeting_run"] };
  }
  if (isAiQueueingBlocked(params.topic)) {
    return { followUpRuns: [], skipped: ["ai_stopped"] };
  }
  if (!params.sourceEmployee.permissions.messageEmployees) {
    return { followUpRuns: [], skipped: ["messageEmployees_disabled"] };
  }
  if (params.handoffDepth >= MAX_AI_TO_AI_HOPS) {
    return { followUpRuns: [], skipped: ["max_hops"] };
  }
  if (isLowActionMessage(params.aiReply)) {
    return { followUpRuns: [], skipped: ["low_action"] };
  }

  const chain = await loadChainState(
    client,
    params.workspaceId,
    params.rootTriggerMessageId,
  );
  if (chain.followUpCount >= MAX_FOLLOW_UP_RUNS_PER_ROOT) {
    return { followUpRuns: [], skipped: ["max_follow_ups"] };
  }

  const targets = resolveHandoffTargets(
    params.aiReply,
    params.handoffTo,
    params.employees,
    params.sourceEmployee.id,
  ).filter((e) => !isEmployeeBlockedInTopic(params.topic, e.id));

  const orchestrated = new Set(
    Array.isArray(params.runMetadata?.orchestratedCollaborators)
      ? (params.runMetadata.orchestratedCollaborators as string[])
      : [],
  );

  const responders: ResponderDecision[] = [];

  for (const employee of targets) {
    if (orchestrated.has(employee.id)) {
      skipped.push(`${employee.id}:orchestrated_collaborator`);
      continue;
    }
    if (chain.respondedEmployeeIds.has(employee.id)) {
      skipped.push(`${employee.id}:already_responded`);
      continue;
    }
    if ((chain.employeeEntryCounts.get(employee.id) ?? 0) >= MAX_SAME_EMPLOYEE_REENTRY) {
      skipped.push(`${employee.id}:reentry_limit`);
      continue;
    }

    const hasHandoff = params.handoffTo?.some(
      (name) =>
        employee.name.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(employee.name.toLowerCase()),
    );
    const reason: ResponseReason = hasHandoff ? "handoff" : "ai_mention";

    const exists = await hasExistingFollowUp(
      client,
      params.workspaceId,
      params.rootTriggerMessageId,
      params.aiMessageId,
      employee.id,
      reason,
    );
    if (exists) {
      skipped.push(`${employee.id}:duplicate`);
      continue;
    }

    const collaborationRunId =
      reason === "handoff" && !isActionOriented(params.aiReply)
        ? `collab_${params.rootTriggerMessageId}`
        : undefined;
    const inheritedCoordination =
      params.runMetadata?.coordinationDepth !== undefined
        ? {
            coordinationDepth: params.runMetadata.coordinationDepth,
            coordinationSourceEmployeeId: params.runMetadata.coordinationSourceEmployeeId,
            coordinationSourceEmployeeName: params.runMetadata.coordinationSourceEmployeeName,
          }
        : undefined;
    const runMetadata = collaborationRunId
      ? { ...inheritedCoordination, collaborationRunId, collaborationOnly: true }
      : inheritedCoordination;

    responders.push({
      employee,
      reason,
      runMetadata,
    });
  }

  if (!responders.length) {
    return { followUpRuns: [], skipped };
  }

  const { queued } = await queueAgentRuns(client, {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.topic.id,
    triggerMessageId: params.aiMessageId,
    rootTriggerMessageId: params.rootTriggerMessageId,
    responders,
    content: params.aiReply,
    parentRunId: params.parentRunId,
    handoffDepth: params.handoffDepth + 1,
    skipAdmission: true,
    createdByType: "ai_employee",
    createdById: params.sourceEmployee.id,
  });

  // Task-book transfers for AI→AI handoffs (visible as Wren → Emily).
  try {
    const { logAssignmentTask } = await import("@/lib/tasks/task-book");
    for (const run of queued) {
      await logAssignmentTask({
        client,
        workspaceId: params.workspaceId,
        roomId: params.roomId,
        topicId: params.topic.id,
        title: `${params.sourceEmployee.name} → ${run.employeeName}`,
        description: params.aiReply.slice(0, 240),
        assigneeEmployeeId: run.employeeId,
        createdByType: "ai_employee",
        createdById: params.sourceEmployee.id,
        sourceMessageId: params.aiMessageId,
        agentRunId: run.runId,
        workClass: "interactive",
        status: "in_progress",
      });
    }
  } catch (err) {
    console.warn("[queue-follow-up] task book transfer log failed", err);
  }

  return { followUpRuns: queued, skipped };
}

export type SelfContinuationParams = {
  workspaceId: string;
  roomId: string;
  topic: RoomTopic;
  employee: AIEmployee;
  aiMessageId: string;
  aiReply: string;
  humanTriggerContent: string;
  parentRunId: string;
  rootTriggerMessageId: string;
  handoffDepth: number;
  isGreetingRun?: boolean;
  runMetadata?: Record<string, unknown>;
  /** True when this completed run already executed tools / approvals. */
  hadDeliverable: boolean;
};

/**
 * When an employee stalls ("give me a sec") without delivering, queue one
 * same-employee continuation so work actually completes without a human nudge.
 */
export async function queueSelfContinuationIfNeeded(
  client: SupabaseClient,
  params: SelfContinuationParams,
): Promise<{ followUpRuns: QueuedRun[]; skipped: string[] }> {
  const skipped: string[] = [];
  if (params.isGreetingRun) {
    return { followUpRuns: [], skipped: ["greeting_run"] };
  }
  if (isAiQueueingBlocked(params.topic)) {
    return { followUpRuns: [], skipped: ["ai_stopped"] };
  }
  if (params.runMetadata?.workType === "self_continuation") {
    return { followUpRuns: [], skipped: ["already_continuation"] };
  }
  if (params.hadDeliverable) {
    return { followUpRuns: [], skipped: ["already_delivered"] };
  }
  if (!isDeferredWorkPromise(params.aiReply)) {
    return { followUpRuns: [], skipped: ["not_deferred_promise"] };
  }

  const humanNeededWork =
    isActionOriented(params.humanTriggerContent) ||
    messageLikelyNeedsStructuredEffects(params.humanTriggerContent);
  if (!humanNeededWork) {
    return { followUpRuns: [], skipped: ["human_not_action_oriented"] };
  }

  if (isEmployeeBlockedInTopic(params.topic, params.employee.id)) {
    return { followUpRuns: [], skipped: ["employee_blocked"] };
  }

  const { data: priorContinuations } = await client
    .from("agent_runs")
    .select("id")
    .eq("workspace_id", params.workspaceId)
    .eq("root_trigger_message_id", params.rootTriggerMessageId)
    .eq("employee_id", params.employee.id)
    .eq("response_reason", "task_follow_up")
    .in("status", ["queued", "waiting", "running", "completed"])
    .limit(MAX_SELF_CONTINUATIONS_PER_ROOT);

  if ((priorContinuations?.length ?? 0) >= MAX_SELF_CONTINUATIONS_PER_ROOT) {
    return { followUpRuns: [], skipped: ["max_self_continuations"] };
  }

  const exists = await hasExistingFollowUp(
    client,
    params.workspaceId,
    params.rootTriggerMessageId,
    params.aiMessageId,
    params.employee.id,
    "task_follow_up",
  );
  if (exists) {
    return { followUpRuns: [], skipped: ["duplicate"] };
  }

  const nudge = [
    `[System continuation — do not address the human as if this is a new chat.]`,
    `Your previous reply only promised to look/work ("${params.aiReply.trim().slice(0, 120)}").`,
    `The human's request still needs a real answer or tool action now.`,
    `Do the work in this turn. Do NOT say "give me a sec", "checking now", "pulling that up", "one moment", "I'll check", or "I'll report back" again.`,
    `If the ask was to check/read mail, emit email.listRecent (then email.getThread for a specific thread) and answer from the real result.`,
    `If other tools are required (email draft/send, tasks.createTask for reminders, CRM), emit effects.toolCalls immediately with complete args.`,
  ].join(" ");

  const { queued } = await queueAgentRuns(client, {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.topic.id,
    triggerMessageId: params.aiMessageId,
    rootTriggerMessageId: params.rootTriggerMessageId,
    responders: [
      {
        employee: params.employee,
        reason: "task_follow_up",
        runMetadata: {
          ...(params.runMetadata ?? {}),
          workType: "self_continuation",
          continuationOf: params.parentRunId,
          humanTriggerContent: params.humanTriggerContent.slice(0, 2000),
        },
      },
    ],
    content: nudge,
    parentRunId: params.parentRunId,
    handoffDepth: params.handoffDepth,
    skipAdmission: true,
    createdByType: "steward",
    createdById: "self_continuation",
  });

  if (!queued.length) {
    skipped.push("queue_empty");
  }

  return { followUpRuns: queued, skipped };
}

export type CollaboratorActivationParams = {
  workspaceId: string;
  roomId: string;
  topic: RoomTopic;
  employees: AIEmployee[];
  leadRunId: string;
  leadEmployee: AIEmployee;
  leadReply: string;
  leadAiMessageId: string;
  rootTriggerMessageId: string;
  runMetadata: Record<string, unknown>;
};

async function hasCollaboratorRun(
  client: SupabaseClient,
  workspaceId: string,
  collaborationId: string,
  employeeId: string,
  dependsOnRunId: string,
): Promise<boolean> {
  const { data } = await client
    .from("agent_runs")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("employee_id", employeeId)
    .eq("depends_on_run_id", dependsOnRunId)
    .in("response_reason", [
      "collaboration_collaborator",
      "ambient_collaboration_collaborator",
      "panel_response",
    ])
    .in("status", ["queued", "waiting", "running", "completed"])
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

export async function queueCollaboratorRuns(
  client: SupabaseClient,
  params: CollaboratorActivationParams,
): Promise<{ activatedRuns: QueuedRun[]; skipped: string[] }> {
  const skipped: string[] = [];
  if (isAiQueueingBlocked(params.topic)) {
    return { activatedRuns: [], skipped: ["ai_stopped"] };
  }

  const collaborationId = String(params.runMetadata.collaborationId ?? "");
  const pendingIds = Array.isArray(params.runMetadata.pendingCollaboratorIds)
    ? (params.runMetadata.pendingCollaboratorIds as string[])
    : [];

  if (!pendingIds.length) {
    return { activatedRuns: [], skipped: ["no_pending_collaborators"] };
  }

  const participants = Array.isArray(params.runMetadata.participants)
    ? (params.runMetadata.participants as { employeeId: string; employeeName?: string }[])
    : [];

  const responders: ResponderDecision[] = [];

  for (const employeeId of pendingIds) {
    if (isEmployeeBlockedInTopic(params.topic, employeeId)) {
      skipped.push(`${employeeId}:blocked`);
      continue;
    }

    const employee = params.employees.find((e) => e.id === employeeId);
    if (!employee) {
      skipped.push(`${employeeId}:not_found`);
      continue;
    }

    if (
      await hasCollaboratorRun(
        client,
        params.workspaceId,
        collaborationId,
        employeeId,
        params.leadRunId,
      )
    ) {
      skipped.push(`${employeeId}:duplicate`);
      continue;
    }

    const conversationMode = params.runMetadata.conversationMode ?? "lead_collaborator";
    const isPanel = conversationMode === "panel_response";
    const collabReason: ResponseReason = isPanel
      ? "panel_response"
      : conversationMode === "ambient_collaboration"
        ? "ambient_collaboration_collaborator"
        : "collaboration_collaborator";

    responders.push({
      employee,
      reason: collabReason,
      runMetadata: {
        collaborationId,
        conversationMode,
        collaborationRole: isPanel ? "panelist" : "collaborator",
        collaborationStatus: "active",
        participants,
        leadEmployeeId: params.leadEmployee.id,
        leadEmployeeName: params.leadEmployee.name,
        leadReply: params.leadReply,
        leadAiMessageId: params.leadAiMessageId,
        orchestratedCollaborators: pendingIds,
        dependsOnRunId: params.leadRunId,
      },
    });
  }

  if (!responders.length) {
    return { activatedRuns: [], skipped };
  }

  const isPanelFollowUp = params.runMetadata.conversationMode === "panel_response";

  const { queued } = await queueAgentRuns(client, {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.topic.id,
    triggerMessageId: params.leadAiMessageId,
    rootTriggerMessageId: params.rootTriggerMessageId,
    parentRunId: params.leadRunId,
    dependsOnRunId: params.leadRunId,
    handoffDepth: 1,
    responders,
    content: isPanelFollowUp
      ? `${params.leadReply}\n\n(Adding your panel perspective after ${params.leadEmployee.name}.)`
      : `${params.leadReply}\n\n(Collaborating after ${params.leadEmployee.name}'s analysis.)`,
    skipAdmission: true,
    createdByType: "steward",
    createdById: "steward",
  });

  return { activatedRuns: queued, skipped };
}
