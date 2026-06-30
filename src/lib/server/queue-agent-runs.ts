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
import type { ResponderDecision } from "@/lib/server/decide-responders";
import { GREETING_MAX_OUTPUT_TOKENS } from "@/lib/server/channel-governance";
import { createServiceRoleClient } from "@/lib/supabase/server";

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
  },
): Promise<{ queued: QueuedRun[]; blocked: { employeeId: string; reason: string }[] }> {
  const settings = await loadWorkspaceAiSettings(client, params.workspaceId);
  const aiClient = (() => {
    try {
      return createServiceRoleClient();
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

  const rootTriggerMessageId =
    params.rootTriggerMessageId ?? params.triggerMessageId;

  for (const decision of params.responders) {
    const { employee, reason, isGreetingRun } = decision;
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
