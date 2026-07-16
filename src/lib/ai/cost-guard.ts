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
import { estimateCost, getOutputTokenCap, type ModelMode } from "@/lib/ai/model-catalog";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { checkWorkspaceAiCapacity } from "@/lib/billing/usage/periods";
import { calculateModelCost } from "@/lib/billing/costing/calculate-model-cost";
import { recordCostEvent } from "@/lib/billing/costing/record-cost-event";
import { getWorkHourUsdRate } from "@/lib/billing/costing/work-hours";

export type BeginAiRunContext = {
  client: SupabaseClient;
  workspaceId: string;
  employeeId: string;
  roomId: string;
  topicId?: string;
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

  // Weekly AI Work Hours enforcement — pause AI employees when the workspace is exhausted.
  const capacity = await checkWorkspaceAiCapacity(ctx.client, ctx.workspaceId);
  if (!capacity.allowed) {
    return { ok: false, reason: capacity.reason ?? "Weekly AI Work Hours exhausted." };
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
    topicId: ctx.topicId,
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
    topicId: ctx.topicId,
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

  // Customer Usage reads ai_cost_ledger_entries. Shadow work-unit completion is
  // optional / often skipped — always mirror successful runs into the ledger.
  if (!params.failed) {
    try {
      await recordCommercialUsageFromFinalizedRun(params);
    } catch (error) {
      console.warn("[AdeHQ cost ledger] finalizeAiRun mirror failed", error);
    }
  }
}

async function recordCommercialUsageFromFinalizedRun(
  params: FinalizeAiRunParams,
): Promise<void> {
  const [{ data: run }, { data: usage }] = await Promise.all([
    params.client
      .from("agent_runs")
      .select("employee_id, room_id, topic_id")
      .eq("workspace_id", params.workspaceId)
      .eq("id", params.runId)
      .maybeSingle(),
    params.client
      .from("ai_usage_events")
      .select("employee_id, model, provider, estimated_cost_usd")
      .eq("id", params.usageId)
      .maybeSingle(),
  ]);

  const employeeId =
    (run?.employee_id ? String(run.employee_id) : null) ??
    (usage?.employee_id ? String(usage.employee_id) : null);
  const modelId =
    (typeof usage?.model === "string" && usage.model.trim() ? usage.model.trim() : null) ??
    null;
  const inputTokens = Math.max(0, params.inputTokens ?? 0);
  const outputTokens = Math.max(0, params.outputTokens ?? 0);
  const cachedTokens = Math.max(0, params.cachedTokens ?? 0);

  const providerName =
    typeof usage?.provider === "string" ? usage.provider.trim().toLowerCase() : null;
  const providerRoute =
    providerName === "vercel" || providerName === "vercel_gateway" || providerName?.includes("gateway")
      ? "vercel_gateway"
      : providerName === "siliconflow" || providerName === "siliconflow_direct"
        ? "siliconflow_direct"
        : modelId?.startsWith("deepseek/") || modelId?.startsWith("minimax/") || modelId?.startsWith("qwen/")
          ? "vercel_gateway"
          : modelId?.includes("/")
            ? "siliconflow_direct"
            : null;

  // Prefer token×endpoint rates over caller "actualCostUsd" — call sites often pass
  // our own estimateCost() result as actual, which historically used stale catalog rates.
  let { costUsd, costSource } = calculateModelCost({
    modelId,
    inputTokens,
    cachedInputTokens: cachedTokens,
    outputTokens,
    providerRoute,
    estimatedCostUsd:
      params.actualCostUsd ??
      (usage?.estimated_cost_usd != null ? Number(usage.estimated_cost_usd) : null),
  });

  if ((inputTokens > 0 || outputTokens > 0 || cachedTokens > 0) && modelId) {
    costUsd = estimateCost(modelId, inputTokens > 0 ? inputTokens : cachedTokens, outputTokens, {
      cachedInputTokens: inputTokens > 0 ? cachedTokens : 0,
      providerRoute,
    });
    costSource = "estimated";
  }
  // Completed employee replies with missing token/cost telemetry still consumed
  // capacity — charge a tiny floor so the Work Hours meter cannot stay stuck at 0.
  if (costUsd <= 0) {
    costUsd = 0.0001;
    costSource = "estimated";
  }
  // Customer meter floors to 2dp. If AI_WORK_HOUR_USD is high, a real short
  // reply can still convert to <0.01h and display as 0.00 — enforce a
  // visible minimum of 0.01 Work Hours per finalized employee reply.
  const minBillableCost = getWorkHourUsdRate() * 0.01;
  if (costUsd < minBillableCost) {
    costUsd = minBillableCost;
    costSource = "estimated";
  }

  await recordCostEvent(params.client, {
    workspaceId: params.workspaceId,
    employeeId,
    roomId: run?.room_id ? String(run.room_id) : null,
    topicId: run?.topic_id ? String(run.topic_id) : null,
    messageId: params.responseMessageId ?? null,
    sourceType: "llm",
    providerRoute,
    providerName: typeof usage?.provider === "string" ? usage.provider : null,
    modelId,
    workType: "employee_reply",
    inputTokens,
    cachedInputTokens: cachedTokens,
    outputTokens,
    estimatedCostUsd: costSource === "estimated" ? costUsd : undefined,
    actualCostUsd: costSource === "provider_usage" ? costUsd : undefined,
    costSource,
    status: "succeeded",
    metadata: {
      agentRunId: params.runId,
      usageId: params.usageId,
      mirroredFrom: "finalizeAiRun",
      tokenRatesApplied: true,
    },
  });
}

export async function loadMaxParallelRuns(
  client: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const settings = await loadWorkspaceAiSettings(client, workspaceId);
  return Math.min(settings.maxParallelRuns, 3);
}
