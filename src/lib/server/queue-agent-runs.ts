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
import { createServiceRoleClient } from "@/lib/supabase/server";

export type QueuedRun = {
  runId: string;
  usageId: string;
  employeeId: string;
  employeeName: string;
  reason: ResponderDecision["reason"];
};

export async function queueAgentRuns(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    roomId: string;
    topicId: string;
    triggerMessageId: string;
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

  for (const { employee, reason } of params.responders) {
    const modelMode: ModelMode = employee.modelMode ?? "balanced";
    const provider = employee.provider.toLowerCase();
    const modeCap = getOutputTokenCap(modelMode);
    const maxOutputTokens = Math.min(modeCap, settings.maxOutputTokens);
    const estimate = buildRunEstimate(
      provider,
      modelMode,
      params.content.length,
      settings.maxOutputTokens,
    );

    const runId = newAgentRunId();
    const usageId = newUsageId();

    try {
      await createAgentRun(aiClient, {
        workspaceId: params.workspaceId,
        runId,
        employeeId: employee.id,
        roomId: params.roomId,
        topicId: params.topicId,
        triggerMessageId: params.triggerMessageId,
        provider,
        model: estimate.model,
        modelMode,
        status: "queued",
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
