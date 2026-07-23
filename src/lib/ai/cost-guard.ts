import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadWorkspaceAiSettings,
  createAgentRun,
  reserveUsage,
  finalizeUsage,
  completeAgentRun,
  sumTodayUsage,
  expireStaleReservedUsage,
  newAgentRunId,
  newUsageId,
  buildRunEstimate,
  appendRunStep,
} from "@/lib/supabase/ai-runtime";
import { getOutputTokenCap, type ModelMode } from "@/lib/ai/model-catalog";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { resolveRouteIdForModel } from "@/lib/brain/catalog";
import { evaluatePlanCostPolicy, loadWorkspaceCostPolicy } from "@/lib/brain/cost-policy";
import { recordBrainUsage } from "@/lib/brain/metering/record-brain-usage";
import { checkWorkspaceAiCapacity } from "@/lib/billing/usage/periods";

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
  /**
   * When set (e.g. live voice turns cap at ~280), reserve/estimate against this
   * instead of the full workspace/model output cap so interrupted calls cannot
   * strand multi-k token reservations per turn.
   */
  maxOutputTokensOverride?: number;
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
  const maxOutputTokens = Math.min(
    modeCap,
    settings.maxOutputTokens,
    ctx.maxOutputTokensOverride ?? Number.POSITIVE_INFINITY,
  );
  const estimate = buildRunEstimate(
    ctx.provider,
    ctx.modelMode,
    ctx.promptLength,
    maxOutputTokens,
  );

  // CostPolicy hard block at plan time (PR-6). Soft confirm/manager paths are UI-gated.
  const costPolicy = await loadWorkspaceCostPolicy(ctx.client, ctx.workspaceId);
  const planCost = evaluatePlanCostPolicy({
    estimatedLikelyCostUsd: estimate.cost,
    policy: costPolicy,
  });
  if (planCost.action === "hard_block") {
    return {
      ok: false,
      reason: planCost.reason ?? "Estimated Work Hours exceed the workspace hard block.",
    };
  }

  // Drop abandoned reservations before budgeting so interrupted voice turns
  // cannot permanently exhaust the employee daily token cap.
  await expireStaleReservedUsage(ctx.client, ctx.workspaceId, {
    employeeId: ctx.employeeId,
  });

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
  /**
   * When the work-unit path already meters this call, skip the finalize mirror
   * (defect E). Prefer passing the shared usageId on work-unit metadata instead.
   */
  skipCommercialLedger?: boolean;
  workUnitId?: string | null;
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

  // Customer Usage reads ai_cost_ledger_entries. Mirror successful runs unless the
  // work-unit path is the canonical meter for this call (defect E).
  if (!params.failed && !params.skipCommercialLedger) {
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

  const routeId =
    resolveRouteIdForModel({ modelId, providerRoute, capability: "reasoning" }) ??
    "route_text_v4flash_sf";

  // Shared key so a work-unit complete with metadata.usageId cannot double-charge (defect E).
  const idempotencyKey = `usage_event:${params.usageId}:llm`;

  const { isMayaBillableExempt } = await import("@/lib/billing/costing/maya-exempt");
  const billableToWorkspace = !isMayaBillableExempt({
    employeeId,
    workType: "employee_reply",
  });

  const entry = await recordBrainUsage({
    client: params.client,
    workspaceId: params.workspaceId,
    idempotencyKey,
    employeeId,
    workUnitId: params.workUnitId ?? null,
    roomId: run?.room_id ? String(run.room_id) : null,
    topicId: run?.topic_id ? String(run.topic_id) : null,
    messageId: params.responseMessageId ?? null,
    sourceType: "llm",
    routeId,
    usage: {
      inputTokens,
      cachedInputTokens: cachedTokens,
      outputTokens,
      // Do not trust caller actualCostUsd — often our own estimate (defect B).
    },
    status: "succeeded",
    billableToWorkspace,
    platformOverhead: !billableToWorkspace,
    workType: "employee_reply",
    capability: "reasoning",
    providerCalled: true,
    metadata: {
      agentRunId: params.runId,
      usageId: params.usageId,
      mirroredFrom: "finalizeAiRun",
    },
  });

  // Attach WH receipt summary on the response message for member UI (PR-7).
  if (entry && params.responseMessageId && entry.workHoursCharged > 0) {
    try {
      const { data: msg } = await params.client
        .from("messages")
        .select("metadata")
        .eq("workspace_id", params.workspaceId)
        .eq("id", params.responseMessageId)
        .maybeSingle();
      const prev =
        msg?.metadata && typeof msg.metadata === "object"
          ? (msg.metadata as Record<string, unknown>)
          : {};
      await params.client
        .from("messages")
        .update({
          metadata: {
            ...prev,
            workHoursCharged: entry.workHoursCharged,
            whReceipt: {
              totalWorkHours: entry.workHoursCharged,
              lines: [
                {
                  capability: "reasoning",
                  workType: "employee_reply",
                  workHours: entry.workHoursCharged,
                },
              ],
            },
          },
        })
        .eq("workspace_id", params.workspaceId)
        .eq("id", params.responseMessageId);
    } catch (error) {
      console.warn("[AdeHQ cost ledger] WH receipt metadata update failed", error);
    }
  }
}

export async function loadMaxParallelRuns(
  client: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const settings = await loadWorkspaceAiSettings(client, workspaceId);
  return Math.min(settings.maxParallelRuns, 3);
}
