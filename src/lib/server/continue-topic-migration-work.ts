import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelMode } from "@/lib/ai/model-catalog";
import { cancelActiveTopicWork } from "@/lib/server/cancel-active-topic-work";
import { queueAgentRuns, type QueuedRun } from "@/lib/server/queue-agent-runs";
import type { AIEmployee, EmployeePermissions, ResponseReason } from "@/lib/types";

export type ContinueTopicMigrationResult = {
  cancelledAgentRunIds: string[];
  cancelledBrowserResearchCount: number;
  continuedRuns: QueuedRun[];
  triggerMessageId: string | null;
};

function minimalEmployee(row: Record<string, unknown>): AIEmployee {
  return {
    id: String(row.id),
    name: String(row.name ?? "Teammate"),
    role: String(row.role ?? "Teammate"),
    roleKey: (row.role_key as AIEmployee["roleKey"]) ?? "operations",
    provider: String(row.provider ?? "siliconflow"),
    model: String(row.model ?? ""),
    modelMode: (row.model_mode as ModelMode | undefined) ?? "balanced",
    seniority: String(row.seniority ?? "mid"),
    status: "idle",
    instructions: "",
    communicationStyle: "",
    successCriteria: "",
    tools: [],
    permissions: {} as EmployeePermissions,
    memoryCount: 0,
    tasksCompleted: 0,
    messagesSent: 0,
    approvalsRequested: 0,
    avgResponseTime: "-",
    trustScore: 75,
    accent: String(row.accent ?? "#2f6fed"),
    lastActiveAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

/**
 * When the user accepts a topic suggestion: stop in-flight work on the source
 * topic and re-queue the same responders against the migrated trigger in the
 * new topic so the AI continues where it left off.
 */
export async function continueWorkAfterTopicMigration(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    sourceTopicId: string;
    targetTopicId: string;
    migratedMessageIds: string[];
    triggerMessageId?: string | null;
  },
): Promise<ContinueTopicMigrationResult> {
  const empty: ContinueTopicMigrationResult = {
    cancelledAgentRunIds: [],
    cancelledBrowserResearchCount: 0,
    continuedRuns: [],
    triggerMessageId: params.triggerMessageId ?? null,
  };

  if (!params.sourceTopicId || params.sourceTopicId === params.targetTopicId) {
    return empty;
  }

  const migratedSet = new Set(params.migratedMessageIds.filter(Boolean));
  const preferredTrigger = params.triggerMessageId ?? null;

  const { data: activeRuns, error: activeError } = await client
    .from("agent_runs")
    .select("id, employee_id, status, trigger_message_id, response_reason, run_metadata")
    .eq("workspace_id", params.workspaceId)
    .eq("topic_id", params.sourceTopicId)
    .in("status", ["queued", "waiting", "running"]);
  if (activeError) throw activeError;

  const relevant = ((activeRuns as Record<string, unknown>[] | null) ?? []).filter((row) => {
    const triggerId = row.trigger_message_id ? String(row.trigger_message_id) : "";
    if (!triggerId) return false;
    if (preferredTrigger && triggerId === preferredTrigger) return true;
    return migratedSet.has(triggerId);
  });

  const cancelResult = await cancelActiveTopicWork(client, {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.sourceTopicId,
    reason: "Work moved to a new topic.",
  });

  if (!relevant.length) {
    return {
      cancelledAgentRunIds: cancelResult.cancelledAgentRunIds,
      cancelledBrowserResearchCount: cancelResult.cancelledBrowserResearchRuns.length,
      continuedRuns: [],
      triggerMessageId: preferredTrigger,
    };
  }

  const triggerMessageId =
    preferredTrigger &&
    (migratedSet.has(preferredTrigger) ||
      relevant.some((row) => String(row.trigger_message_id) === preferredTrigger))
      ? preferredTrigger
      : String(relevant[0].trigger_message_id);

  const { data: triggerRow } = await client
    .from("messages")
    .select("id, content")
    .eq("workspace_id", params.workspaceId)
    .eq("id", triggerMessageId)
    .maybeSingle();

  const triggerContent = String(triggerRow?.content ?? "").trim();
  if (!triggerContent) {
    return {
      cancelledAgentRunIds: cancelResult.cancelledAgentRunIds,
      cancelledBrowserResearchCount: cancelResult.cancelledBrowserResearchRuns.length,
      continuedRuns: [],
      triggerMessageId,
    };
  }

  const employeeIds = [
    ...new Set(relevant.map((row) => String(row.employee_id)).filter(Boolean)),
  ];
  const { data: employeeRows, error: employeeError } = await client
    .from("ai_employees")
    .select("id, name, role, role_key, provider, model, model_mode, seniority, accent")
    .eq("workspace_id", params.workspaceId)
    .in("id", employeeIds);
  if (employeeError) throw employeeError;

  const employeesById = new Map(
    ((employeeRows as Record<string, unknown>[] | null) ?? []).map((row) => [
      String(row.id),
      minimalEmployee(row),
    ]),
  );

  const responders = employeeIds
    .map((employeeId) => {
      const employee = employeesById.get(employeeId);
      if (!employee) return null;
      const source = relevant.find((row) => String(row.employee_id) === employeeId);
      const reason = (String(source?.response_reason ?? "task_follow_up") ||
        "task_follow_up") as ResponseReason;
      return {
        employee,
        reason: reason === "blocked_cooldown" || reason === "blocked_policy"
          ? ("task_follow_up" as const)
          : reason,
        runMetadata: {
          continuedAfterTopicMigration: true,
          previousTopicId: params.sourceTopicId,
          previousRunId: source?.id ? String(source.id) : undefined,
        },
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (!responders.length) {
    return {
      cancelledAgentRunIds: cancelResult.cancelledAgentRunIds,
      cancelledBrowserResearchCount: cancelResult.cancelledBrowserResearchRuns.length,
      continuedRuns: [],
      triggerMessageId,
    };
  }

  const continueContent = [
    "The human accepted moving this workstream into its own topic.",
    "Continue your reply here using the migrated conversation — do not ask them to repeat context.",
    "",
    `Original request:\n${triggerContent}`,
  ].join("\n");

  const { queued } = await queueAgentRuns(client, {
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    topicId: params.targetTopicId,
    triggerMessageId,
    responders,
    content: continueContent,
    skipAdmission: true,
    createdByType: "steward",
    createdById: "topic_migration",
  });

  return {
    cancelledAgentRunIds: cancelResult.cancelledAgentRunIds,
    cancelledBrowserResearchCount: cancelResult.cancelledBrowserResearchRuns.length,
    continuedRuns: queued,
    triggerMessageId,
  };
}
