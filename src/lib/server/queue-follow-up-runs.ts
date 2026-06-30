import type { SupabaseClient } from "@supabase/supabase-js";
import type { AIEmployee, ResponseReason, RoomTopic } from "@/lib/types";
import { extractMentions } from "@/lib/utils";
import {
  isActionOriented,
  isLowActionMessage,
  MAX_AI_TO_AI_HOPS,
  MAX_FOLLOW_UP_RUNS_PER_ROOT,
  MAX_SAME_EMPLOYEE_REENTRY,
} from "@/lib/server/channel-governance";
import { isAiQueueingBlocked, isEmployeeBlockedInTopic } from "@/lib/topic-ai-control";
import type { ResponderDecision } from "@/lib/server/decide-responders";
import { queueAgentRuns, type QueuedRun } from "@/lib/server/queue-agent-runs";

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

  const responders: ResponderDecision[] = [];

  for (const employee of targets) {
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

    responders.push({
      employee,
      reason,
      runMetadata: collaborationRunId
        ? { collaborationRunId, collaborationOnly: true }
        : undefined,
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
  });

  return { followUpRuns: queued, skipped };
}
