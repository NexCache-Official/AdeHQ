import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadWorkspaceAiSettings,
  createAgentRun,
  reserveUsage,
  newAgentRunId,
  newUsageId,
  buildRunEstimate,
} from "@/lib/supabase/ai-runtime";
import { getOutputTokenCap, type ModelMode } from "@/lib/ai/model-catalog";
import type { ResponderDecision } from "@/lib/server/conversation-orchestrator";
import { GREETING_MAX_OUTPUT_TOKENS } from "@/lib/server/room-governance";
import { createSupabaseSecretClient } from "@/lib/supabase/server";
import { classifyWorkClass } from "@/lib/tasks/work-classes";
import { evaluateEmployeeAdmission } from "@/lib/tasks/admission";
import { logAssignmentTask } from "@/lib/tasks/task-book";

export type QueuedRun = {
  runId: string;
  usageId: string;
  employeeId: string;
  employeeName: string;
  reason: ResponderDecision["reason"];
  conversationMode?: string;
  collaborationId?: string;
  collaborationRole?: string;
  staggerIndex?: number;
  taskBookTaskId?: string;
};

export async function queueAgentRuns(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId: string;
    triggerMessageId: string;
    rootTriggerMessageId?: string;
    parentRunId?: string;
    dependsOnRunId?: string;
    handoffDepth?: number;
    responders: ResponderDecision[];
    content: string;
    /** Skip capacity gate (collaborators, leftover promotion, human-ask). */
    skipAdmission?: boolean;
    /** Who created this assignment for the task book. */
    createdByType?: "human" | "ai_employee" | "steward";
    createdById?: string;
  },
): Promise<{ queued: QueuedRun[]; blocked: { employeeId: string; reason: string }[] }> {
  const settings = await loadWorkspaceAiSettings(client, params.workspaceId);
  const aiClient = (() => {
    try {
      return createSupabaseSecretClient();
    } catch {
      return client;
    }
  })();
  const queued: QueuedRun[] = [];
  const blocked: { employeeId: string; reason: string }[] = [];

  if (!settings.aiEnabled) {
    return {
      queued: [],
      blocked: params.responders.map((r) => ({
        employeeId: r.employee.id,
        reason: "AI is disabled for this workspace.",
      })),
    };
  }

  const { checkWorkspaceAiCapacity } = await import("@/lib/billing/usage/periods");
  const capacity = await checkWorkspaceAiCapacity(aiClient, params.workspaceId);
  if (!capacity.allowed) {
    return {
      queued: [],
      blocked: params.responders.map((r) => ({
        employeeId: r.employee.id,
        reason: capacity.reason ?? "AI Work Hours are exhausted for this period.",
      })),
    };
  }

  const rootTriggerMessageId =
    params.rootTriggerMessageId ?? params.triggerMessageId;

  for (const decision of params.responders) {
    const { employee, reason, isGreetingRun } = decision;
    const workClass = classifyWorkClass({
      message: params.content,
      intent:
        typeof decision.runMetadata?.intent === "string"
          ? decision.runMetadata.intent
          : undefined,
    });

    // DMs are 1:1 human→employee work — never soft-queue them behind abandoned
    // interactive capacity (maxInteractiveRunning defaults to 1).
    const isDmRoom = params.roomId.startsWith("dm_");
    if (!params.skipAdmission && !isGreetingRun && !params.dependsOnRunId && !isDmRoom) {
      const admission = await evaluateEmployeeAdmission(aiClient, {
        workspaceId: params.workspaceId,
        employeeId: employee.id,
        workClass,
      });
      if (!admission.admit) {
        const title =
          params.content.trim().slice(0, 120) || `Work for ${employee.name}`;
        const task = await logAssignmentTask({
          client: aiClient,
          workspaceId: params.workspaceId,
          roomId: params.roomId,
          topicId: params.topicId,
          title,
          description: `Queued — ${employee.name} is at capacity (${admission.reason}).`,
          assigneeEmployeeId: employee.id,
          createdByType: params.createdByType ?? "steward",
          createdById: params.createdById ?? "steward",
          sourceMessageId: params.triggerMessageId,
          workClass,
          status: "open",
          blockedReason: "capacity",
          queuePosition: admission.queuePosition,
        });
        blocked.push({
          employeeId: employee.id,
          reason: task
            ? `At capacity — logged in task book (#${admission.queuePosition} in queue).`
            : "Employee is at capacity.",
        });
        continue;
      }
    }

    const modelMode: ModelMode = employee.modelMode ?? "balanced";
    const provider = employee.provider.toLowerCase();
    const modeCap = getOutputTokenCap(modelMode);
    const maxOutputTokens = isGreetingRun
      ? Math.min(GREETING_MAX_OUTPUT_TOKENS, modeCap, settings.maxOutputTokens)
      : Math.min(modeCap, settings.maxOutputTokens);
    const estimate = buildRunEstimate(
      provider,
      modelMode,
      params.content.length,
      maxOutputTokens,
    );

    const runId = newAgentRunId();
    const usageId = newUsageId();
    const runMetadata: Record<string, unknown> = {
      ...(isGreetingRun ? { isGreetingRun: true } : {}),
      ...(decision.runMetadata ?? {}),
      workClass,
    };

    try {
      await createAgentRun(aiClient, {
        workspaceId: params.workspaceId,
        runId,
        employeeId: employee.id,
        roomId: params.roomId,
        topicId: params.topicId,
        triggerMessageId: params.triggerMessageId,
        rootTriggerMessageId,
        parentRunId: params.parentRunId,
        dependsOnRunId: params.dependsOnRunId,
        handoffDepth: params.handoffDepth ?? 0,
        responseReason: reason,
        runMetadata: Object.keys(runMetadata).length ? runMetadata : undefined,
        provider,
        model: estimate.model,
        modelMode,
        status: params.dependsOnRunId ? "waiting" : "queued",
        estimatedCostUsd: estimate.cost,
      });

      await reserveUsage(aiClient, {
        workspaceId: params.workspaceId,
        usageId,
        agentRunId: runId,
        employeeId: employee.id,
        roomId: params.roomId,
        topicId: params.topicId,
        triggerMessageId: params.triggerMessageId,
        provider,
        model: estimate.model,
        modelMode,
        estimatedInputTokens: Math.max(50, Math.ceil(params.content.length / 4)),
        estimatedMaxOutputTokens: maxOutputTokens,
        estimatedCostUsd: estimate.cost,
      });

      let taskBookTaskId: string | undefined;
      if (!isGreetingRun) {
        const task = await logAssignmentTask({
          client: aiClient,
          workspaceId: params.workspaceId,
          roomId: params.roomId,
          topicId: params.topicId,
          title: params.content.trim().slice(0, 120) || `Work for ${employee.name}`,
          description: `Assigned to ${employee.name} (${reason}).`,
          assigneeEmployeeId: employee.id,
          createdByType: params.createdByType ?? "steward",
          createdById: params.createdById,
          sourceMessageId: params.triggerMessageId,
          agentRunId: runId,
          workClass,
          status: "in_progress",
        });
        taskBookTaskId = task?.id;
        if (taskBookTaskId) {
          runMetadata.taskBookTaskId = taskBookTaskId;
        }
      }

      queued.push({
        runId,
        usageId,
        employeeId: employee.id,
        employeeName: employee.name,
        reason,
        conversationMode:
          typeof runMetadata.conversationMode === "string"
            ? runMetadata.conversationMode
            : undefined,
        collaborationId:
          typeof runMetadata.collaborationId === "string"
            ? runMetadata.collaborationId
            : undefined,
        collaborationRole:
          typeof runMetadata.collaborationRole === "string"
            ? runMetadata.collaborationRole
            : undefined,
        staggerIndex:
          typeof runMetadata.staggerIndex === "number" ? runMetadata.staggerIndex : undefined,
        taskBookTaskId,
      });
    } catch (err) {
      blocked.push({
        employeeId: employee.id,
        reason: err instanceof Error ? err.message : "Could not queue run.",
      });
    }
  }

  return { queued, blocked };
}
