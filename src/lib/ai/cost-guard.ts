import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadWorkspaceAiSettings,
  createAgentRun,
  reserveUsage,
  finalizeUsage,
  completeAgentRun,
  sumTodayUsage,
  newAgentRunId,
  newUsageId,
  buildRunEstimate,
  appendRunStep,
} from "@/lib/supabase/ai-runtime";
import { getOutputTokenCap, type ModelMode } from "@/lib/ai/model-catalog";
import { recordAiRuntime } from "@/lib/ai/runtime-log";

export type BeginAiRunContext = {
  client: SupabaseClient;
  workspaceId: string;
  employeeId: string;
  roomId: string;
  triggerMessageId: string;
  provider: string;
  modelMode: ModelMode;
  promptLength: number;
  explicitModel?: string;
};

export type BeginAiRunResult =
  | {
      ok: true;
      runId: string;
      usageId: string;
      maxOutputTokens: number;
      model: string;
      onStep: (step: {
        stepType: "thinking" | "model_call" | "tool_call" | "memory_write" | "task_create" | "approval_request" | "error";
        title: string;
        summary: string;
        status: "running" | "success" | "failed" | "skipped";
        metadata?: Record<string, unknown>;
      }) => Promise<void>;
    }
  | {
      ok: false;
      reason: string;
      runId?: string;
      usageId?: string;
    };

export async function beginAiRun(ctx: BeginAiRunContext): Promise<BeginAiRunResult> {
  const settings = await loadWorkspaceAiSettings(ctx.client, ctx.workspaceId);

  if (!settings.aiEnabled) {
    return { ok: false, reason: "AI is disabled for this workspace." };
  }

  const modeCap = getOutputTokenCap(ctx.modelMode);
  const maxOutputTokens = Math.min(modeCap, settings.maxOutputTokens);
  const estimate = buildRunEstimate(
    ctx.provider,
    ctx.modelMode,
    ctx.promptLength,
    settings.maxOutputTokens,
  );

  const workspaceUsage = await sumTodayUsage(ctx.client, ctx.workspaceId, {
    includeReserved: true,
  });
  if (workspaceUsage.tokens + estimate.tokens > settings.dailyTokenLimit) {
    return { ok: false, reason: "Workspace daily token limit exceeded." };
  }
  if (workspaceUsage.cost + estimate.cost > settings.dailyCostLimitUsd) {
    return { ok: false, reason: "Workspace daily cost limit exceeded." };
  }

  const employeeUsage = await sumTodayUsage(ctx.client, ctx.workspaceId, {
    employeeId: ctx.employeeId,
    includeReserved: true,
  });
  if (employeeUsage.tokens + estimate.tokens > settings.employeeDailyTokenLimit) {
    return { ok: false, reason: "Employee daily token limit exceeded." };
  }

  const runId = newAgentRunId();
  const usageId = newUsageId();

  await createAgentRun(ctx.client, {
    workspaceId: ctx.workspaceId,
    runId,
    employeeId: ctx.employeeId,
    roomId: ctx.roomId,
    triggerMessageId: ctx.triggerMessageId,
    provider: ctx.provider,
    model: estimate.model,
    modelMode: ctx.modelMode,
    status: "running",
    estimatedCostUsd: estimate.cost,
  });

  await reserveUsage(ctx.client, {
    workspaceId: ctx.workspaceId,
    usageId,
    agentRunId: runId,
    employeeId: ctx.employeeId,
    roomId: ctx.roomId,
    triggerMessageId: ctx.triggerMessageId,
    provider: ctx.provider,
    model: estimate.model,
    modelMode: ctx.modelMode,
    estimatedInputTokens: Math.max(50, Math.ceil(ctx.promptLength / 4)),
    estimatedMaxOutputTokens: maxOutputTokens,
    estimatedCostUsd: estimate.cost,
  });

  const onStep = async (step: {
    stepType: "thinking" | "model_call" | "tool_call" | "memory_write" | "task_create" | "approval_request" | "error";
    title: string;
    summary: string;
    status: "running" | "success" | "failed" | "skipped";
    metadata?: Record<string, unknown>;
  }) => {
    await appendRunStep(ctx.client, {
      workspaceId: ctx.workspaceId,
      agentRunId: runId,
      roomId: ctx.roomId,
      employeeId: ctx.employeeId,
      stepType: step.stepType,
      title: step.title,
      summary: step.summary,
      status: step.status,
      metadata: step.metadata,
    });
  };

  return {
    ok: true,
    runId,
    usageId,
    maxOutputTokens,
    model: estimate.model,
    onStep,
  };
}

export async function blockAiRun(
  client: SupabaseClient,
  workspaceId: string,
  runId: string,
  usageId: string,
  reason: string,
  employeeId: string,
  roomId: string,
): Promise<void> {
  await finalizeUsage(client, usageId, {
    status: "blocked",
    errorMessage: reason,
  });
  await completeAgentRun(client, workspaceId, runId, {
    status: "blocked",
    errorMessage: reason,
  });
  await appendRunStep(client, {
    workspaceId,
    agentRunId: runId,
    roomId,
    employeeId,
    stepType: "error",
    title: "Run blocked",
    summary: reason,
    status: "failed",
  });
  recordAiRuntime({
    workspaceId,
    roomId,
    employeeId,
    agentRunId: runId,
    provider: "system",
    model: "none",
    mode: "blocked",
    error: reason,
  });
}

export type FinalizeAiRunParams = {
  client: SupabaseClient;
  workspaceId: string;
  runId: string;
  usageId: string;
  responseMessageId?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  actualCostUsd?: number;
  latencyMs?: number;
  fallbackUsed?: boolean;
  errorMessage?: string;
  failed?: boolean;
};

export async function finalizeAiRun(params: FinalizeAiRunParams): Promise<void> {
  const status = params.failed
    ? "failed"
    : params.fallbackUsed
      ? "fallback"
      : "success";

  await finalizeUsage(params.client, params.usageId, {
    status,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    cachedTokens: params.cachedTokens,
    actualCostUsd: params.actualCostUsd,
    latencyMs: params.latencyMs,
    fallbackUsed: params.fallbackUsed,
    errorMessage: params.errorMessage,
    responseMessageId: params.responseMessageId,
  });

  await completeAgentRun(params.client, params.workspaceId, params.runId, {
    status: params.failed ? "failed" : "completed",
    responseMessageId: params.responseMessageId,
    actualCostUsd: params.actualCostUsd,
    latencyMs: params.latencyMs,
    errorMessage: params.errorMessage,
  });
}

export async function loadMaxParallelRuns(
  client: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const settings = await loadWorkspaceAiSettings(client, workspaceId);
  return Math.min(settings.maxParallelRuns, 3);
}
