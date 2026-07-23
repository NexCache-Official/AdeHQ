import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ENABLE_DEMO_MODE,
  isSiliconFlowConfigured,
  normalizeLiveProvider,
  type LiveProvider,
} from "@/lib/config/features";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { callSiliconFlowEmployee } from "@/lib/ai/siliconflow-call";
import { sanitizeReplyForChat } from "@/lib/ai/normalize-model-response";
import {
  buildEmployeePrompts,
  resolveRouteGenerationParams,
  toEmployeeResponseFromReplyAndEffect,
  type EmployeeRouteInput,
  type EmployeePromptBuildOptions,
  type LiveCallMetrics,
} from "@/lib/ai/employee-response-contract";
import {
  estimateCost,
  normalizeModelMode,
  resolveModel,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import { appendRunStep } from "@/lib/supabase/ai-runtime";
import { sendMessageToEmployee } from "./employee-engine";
import type { EmployeeResponse, SendMessageInput } from "./types";

type RouteContext = {
  workspaceId?: string;
  roomId?: string;
  topicId?: string;
  agentRunId?: string;
  client?: SupabaseClient;
};

export type RouteOptions = {
  mode?: "mock" | "live";
  provider?: string;
  modelMode?: ModelMode;
  /** Composer intensity chip — drives Brain Auto routing when enabled. */
  workMode?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  isGreetingRun?: boolean;
  collaborationRole?: string;
  leadEmployeeName?: string;
  leadReply?: string;
  conversationMode?: string;
  promptTier?: EmployeePromptBuildOptions["promptTier"];
  /** Live phone-call path: prefer streamed spoken answers after pre-search. */
  voiceCall?: boolean;
  context?: RouteContext;
};

export type { LiveCallMetrics };

function errorResponse(
  input: SendMessageInput,
  reason: string,
  ctx: RouteContext,
  provider: string,
  model: string,
  modelMode: string,
  error?: string,
): { response: EmployeeResponse; aiMode: string } {
  recordAiRuntime({
    workspaceId: ctx.workspaceId,
    roomId: ctx.roomId,
    employeeId: input.employee.id,
    agentRunId: ctx.agentRunId,
    provider,
    model,
    modelMode,
    mode: "fallback",
    fallbackReason: reason,
    error,
  });

  const isTimeout = /took too long to respond|timed out/i.test(error ?? "");

  return {
    response: {
      employeeId: input.employee.id,
      employeeName: input.employee.name,
      reply: isTimeout
        ? "That took longer than expected and I had to stop — want me to try again?"
        : `I couldn't complete a live model response right now.\n\n` +
          `**Reason:** ${error ?? reason}\n\n` +
          `Check **Settings → AI Runtime** to verify provider keys and model configuration.`,
      effect: {
        workLog: [
          {
            action: "Model error",
            summary: error ?? reason,
            status: "failed",
          },
        ],
        tasks: [],
        memory: [],
        approvals: [],
        statusChange: "idle",
      },
    },
    aiMode: "error",
  };
}

async function scriptedFallback(
  input: SendMessageInput,
  reason: string,
  ctx: RouteContext,
  provider: string,
  model: string,
  modelMode: string,
  error?: string,
): Promise<{ response: EmployeeResponse; aiMode: string }> {
  const resolved = await sendMessageToEmployee(input);
  resolved.effect.workLog.push({
    action: "Model fallback",
    summary: reason,
    status: "failed",
  });
  recordAiRuntime({
    workspaceId: ctx.workspaceId,
    roomId: ctx.roomId,
    employeeId: input.employee.id,
    agentRunId: ctx.agentRunId,
    provider,
    model,
    modelMode,
    mode: "fallback",
    fallbackReason: reason,
    error,
  });
  return { response: resolved, aiMode: "fallback" };
}

/**
 * Legacy employee reply route — SiliconFlow / mock / scripted fallback.
 * Runtime V2 hot paths fall back here when gated execution fails or is disabled.
 */
export async function routeEmployeeResponse(
  input: EmployeeRouteInput,
  options: RouteOptions = {},
): Promise<{
  response: EmployeeResponse;
  aiMode: string;
  metrics?: LiveCallMetrics;
  failed?: boolean;
  errorMessage?: string;
}> {
  const ctx = options.context ?? {};
  const provider: LiveProvider = normalizeLiveProvider(
    options.provider ?? input.employee.provider,
  );
  const modelMode = normalizeModelMode(
    options.modelMode ?? input.employee.modelMode,
  );
  const model = resolveModel(provider, modelMode, input.employee.model);
  const { maxOutputTokens, temperature, timeoutMs } = resolveRouteGenerationParams(
    input.message,
    options,
  );

  if (provider === "mock" || options.mode === "mock") {
    const response = await sendMessageToEmployee(input);
    recordAiRuntime({
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      employeeId: input.employee.id,
      agentRunId: ctx.agentRunId,
      provider: "mock",
      model: "scripted",
      modelMode,
      mode: "mock",
    });
    return { response, aiMode: "mock" };
  }

  if (!isSiliconFlowConfigured()) {
    return errorResponse(
      input,
      "SILICONFLOW_API_KEY is not configured on the server.",
      ctx,
      provider,
      model,
      modelMode,
    );
  }

  const started = Date.now();
  try {
    const { system, prompt } = buildEmployeePrompts(input, options);

    if (ctx.client && ctx.agentRunId && ctx.workspaceId && ctx.roomId) {
      await appendRunStep(ctx.client, {
        workspaceId: ctx.workspaceId,
        agentRunId: ctx.agentRunId,
        roomId: ctx.roomId,
        employeeId: input.employee.id,
        stepType: "model_call",
        title: "Calling model",
        summary: `${provider}/${model}`,
        status: "running",
      });
    }

    const result = await callSiliconFlowEmployee(
      system,
      prompt,
      model,
      maxOutputTokens,
      timeoutMs,
      temperature,
    );

    const durationMs = Date.now() - started;
    const inputTokens = result.inputTokens ?? 0;
    const outputTokens = result.outputTokens ?? 0;
    const estimatedCostUsd = estimateCost(result.model, inputTokens, outputTokens);
    const fallbackUsed = !result.structuredOutputUsed || (result.fallbackTier ?? 1) > 1;

    recordAiRuntime({
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      employeeId: input.employee.id,
      agentRunId: ctx.agentRunId,
      provider,
      model: result.model,
      modelMode,
      mode: "live",
      durationMs,
      inputTokens,
      outputTokens,
      cachedTokens: result.cachedTokens,
      estimatedCostUsd,
      fallbackTier: result.fallbackTier,
    });

    if (result.response.effect.handoffTo?.length && ctx.client && ctx.agentRunId) {
      await appendRunStep(ctx.client, {
        workspaceId: ctx.workspaceId!,
        agentRunId: ctx.agentRunId,
        roomId: ctx.roomId!,
        employeeId: input.employee.id,
        stepType: "thinking",
        title: "Handoff suggested",
        summary: `Suggested: ${result.response.effect.handoffTo.join(", ")} (not auto-executed)`,
        status: "skipped",
      });
    }

    return {
      response: toEmployeeResponseFromReplyAndEffect(
        input.employee.id,
        input.employee.name,
        sanitizeReplyForChat(result.response.reply),
        result.response.effect,
      ),
      aiMode: provider,
      metrics: {
        model: result.model,
        inputTokens,
        outputTokens,
        cachedTokens: result.cachedTokens,
        fallbackTier: result.fallbackTier,
        fallbackUsed,
        estimatedCostUsd,
        durationMs,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model request failed";
    if (ENABLE_DEMO_MODE) {
      return scriptedFallback(
        input,
        "Live call failed; used fallback response.",
        ctx,
        provider,
        model,
        modelMode,
        message,
      );
    }
    const err = errorResponse(input, "Model call failed.", ctx, provider, model, modelMode, message);
    return { ...err, failed: true, errorMessage: message };
  }
}
