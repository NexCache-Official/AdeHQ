import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildEmployeePrompts,
  mapModelSchemaToEmployeeResponse,
  ModelResponseSchema,
  resolveDirectEmployeeModelMode,
  resolveRouteGenerationParams,
  reasoningProfileForCapability,
  runtimeLiveMetricsFromUsage,
  type EmployeeRouteInput,
} from "@/lib/ai/employee-response-contract";
import {
  routeEmployeeResponse,
  type LiveCallMetrics,
  type RouteOptions,
} from "@/lib/ai/model-router";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { generateObject as runtimeGenerateObject } from "@/lib/ai/runtime";
import {
  getRuntimeFlags,
  isEmployeeDirectRuntimeExecutionEnabled,
} from "@/lib/ai/runtime/flags";
import type { EmployeeResponse } from "@/lib/types";
import { appendRunStep } from "@/lib/supabase/ai-runtime";
import {
  completeAiWorkUnit,
  createAiWorkUnit,
  failAiWorkUnit,
  startAiWorkUnit,
} from "@/lib/supabase/ai-work-units";
import { inferEmployeeReplyCapability } from "@/lib/ai/runtime/hot-path-shadow";
import type { ModelMode } from "@/lib/ai/model-catalog";
import {
  intelligenceModeFromModelMode,
  resolveEmployeeIntelligencePolicy,
} from "@/lib/ai/intelligence-policy";
import { resolveBrainAwareModelMode } from "@/lib/brain/resolve-auto-run";
import { recordRouteOutcome } from "@/lib/ai/runtime/route-health";
import { streamSiliconFlowText } from "@/lib/ai/siliconflow-call";
import { estimateCost, resolveModel } from "@/lib/ai/model-catalog";
import { sanitizeReplyForChat } from "@/lib/ai/normalize-model-response";
import { isEmployeeReplyStreamingEnabled } from "@/lib/config/features";
import {
  conversationLikelyNeedsStructuredEffects,
  messageLikelyNeedsBusinessTool,
} from "@/lib/ai/message-intent";

export type EmployeeDirectRuntimeDispatch = "old" | "shadow" | "legacy-guarded" | "runtime-on";

export type EmployeeDirectRouteInput = EmployeeRouteInput;
export type EmployeeDirectRouteOptions = RouteOptions;

export type EmployeeDirectRouteResult = {
  response: EmployeeResponse;
  aiMode: string;
  metrics?: LiveCallMetrics;
  failed?: boolean;
  errorMessage?: string;
  usedRuntime: boolean;
  runtimeFallback: boolean;
  workUnitId?: string;
};

export type EmployeeDirectRuntimeTestHooks = {
  forceRuntimeFailure?: boolean | Error;
  stubLegacyResult?: EmployeeDirectRouteResult;
  onRuntimeFallback?: (info: { error: string; workUnitFailed: boolean }) => void;
  onRuntimeSuccess?: (info: { workUnitId?: string }) => void;
  onLegacyRoute?: () => void;
};

export type EmployeeDirectReplyStreaming = {
  onReplyDelta: (delta: string) => void;
  abortSignal?: AbortSignal;
};

let employeeDirectRuntimeTestHooks: EmployeeDirectRuntimeTestHooks | null = null;

/** @internal Test-only hook — do not use in production callers. */
export function setEmployeeDirectRuntimeTestHooks(
  hooks: EmployeeDirectRuntimeTestHooks | null,
): void {
  employeeDirectRuntimeTestHooks = hooks;
}

export function getEmployeeDirectRuntimeDispatch(): EmployeeDirectRuntimeDispatch {
  const { mode } = getRuntimeFlags();
  if (mode === "off") return "old";
  if (mode === "shadow") return "shadow";
  if (!isEmployeeDirectRuntimeExecutionEnabled()) return "legacy-guarded";
  return "runtime-on";
}

export function shouldAttemptEmployeeDirectRuntime(): boolean {
  return getEmployeeDirectRuntimeDispatch() === "runtime-on";
}

/** Runtime V2 execution for direct employee respond — throws on failure. */
export async function generateEmployeeDirectResponseRuntime(
  input: EmployeeDirectRouteInput,
  options: EmployeeDirectRouteOptions = {},
): Promise<EmployeeDirectRouteResult> {
  const ctx = options.context ?? {};
  const heuristicModelMode = resolveDirectEmployeeModelMode(
    (options.modelMode ?? input.employee.modelMode) as ModelMode | undefined,
    input.employee.roleKey,
  );
  const workMode = options.workMode;
  const brainRun = resolveBrainAwareModelMode({
    employee: input.employee,
    heuristicModelMode,
    workMode,
  });
  const modelMode = brainRun.modelMode;
  const intensity = brainRun.intensity;
  const { maxOutputTokens, temperature, timeoutMs } = resolveRouteGenerationParams(
    input.message,
    options,
  );
  const capability = inferEmployeeReplyCapability({
    userMessage: input.message,
    artifactIntent: input.artifactIntent,
    isGreetingRun: options.isGreetingRun,
    conversationMode: options.conversationMode,
  });
  const intelligencePolicy = resolveEmployeeIntelligencePolicy(input.employee);

  let workUnitId: string | undefined;

  if (ctx.client && ctx.workspaceId) {
    const created = await createAiWorkUnit(ctx.client, {
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      topicId: ctx.topicId,
      employeeId: input.employee.id,
      workType:
        capability === "artifact_generation"
          ? "artifact_generation"
          : "employee_direct_response",
      capability,
      objective: "Direct employee reply via Runtime V2",
      status: "created",
      runtimeMode: undefined,
      metadata: {
        source: "employee_direct_response",
        messageLength: input.message.length,
        modelMode,
      },
    });
    workUnitId = created.id;
    await startAiWorkUnit(ctx.client, ctx.workspaceId, workUnitId, {
      metadata: { agentRunId: ctx.agentRunId },
    });
  }

  if (employeeDirectRuntimeTestHooks?.forceRuntimeFailure) {
    const forced =
      employeeDirectRuntimeTestHooks.forceRuntimeFailure instanceof Error
        ? employeeDirectRuntimeTestHooks.forceRuntimeFailure
        : new Error("Forced employee direct runtime failure (test hook)");
    if (ctx.client && ctx.workspaceId && workUnitId) {
      try {
        await failAiWorkUnit(ctx.client, ctx.workspaceId, workUnitId, forced.message);
      } catch {
        // observability only
      }
    }
    throw forced;
  }

  try {
    const { system, prompt } = buildEmployeePrompts(input, options);

    if (ctx.client && ctx.agentRunId && ctx.workspaceId && ctx.roomId) {
      await appendRunStep(ctx.client, {
        workspaceId: ctx.workspaceId,
        agentRunId: ctx.agentRunId,
        roomId: ctx.roomId,
        topicId: ctx.topicId,
        employeeId: input.employee.id,
        stepType: "model_call",
        title: "Calling Runtime V2",
        summary: `runtime-v2 · ${capability} · ${modelMode}`,
        status: "running",
      });
    }

    const result = await runtimeGenerateObject({
      workspaceId: ctx.workspaceId,
      employeeId: input.employee.id,
      workUnitId,
      capability,
      modelMode,
      intensity,
      routingPreference: intelligencePolicy.routingPreference as import("@/lib/ai/intelligence-policy").RoutingPreference,
      requiresJson: true,
      reasoningProfile: reasoningProfileForCapability(capability),
      schema: ModelResponseSchema,
      system,
      prompt,
      maxTokens: maxOutputTokens,
      temperature,
      timeoutMs,
      preferJsonMode: true,
      metadata: {
        agentRunId: ctx.agentRunId,
        roomId: ctx.roomId,
        topicId: ctx.topicId,
        brainAuto: brainRun.auto,
        brainIntensity: intensity,
        intelligenceMode: brainRun.intelligenceMode,
      },
    });

    const parsed = ModelResponseSchema.safeParse(result.object);
    if (!parsed.success) {
      throw new Error("Runtime employee direct response failed schema validation.");
    }

    if (ctx.client && ctx.workspaceId && workUnitId) {
      await completeAiWorkUnit(ctx.client, ctx.workspaceId, workUnitId, {
        actualWorkMinutes: result.workMinutesEstimated,
        modelId: result.usage.modelId,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedInputTokens: result.usage.cacheReadTokens,
        metadata: {
          providerRoute: result.usage.providerRoute,
          providerName: result.usage.providerName,
          providerCredentialId: result.usage.providerCredentialId,
          providerAllocationId: result.usage.providerAllocationId,
          providerProjectId: result.usage.providerProjectId,
          credentialSource: result.usage.credentialSource,
          capability,
          workUnitId,
          workMinutesEstimated: result.workMinutesEstimated,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cachedInputTokens: result.usage.cacheReadTokens,
          modelId: result.usage.modelId,
          modelMode,
          intelligenceMode: intelligenceModeFromModelMode(modelMode),
          agentRunId: ctx.agentRunId,
          routeOptimizer: result.routing?.routeOptimizer,
          providerCalled: true,
        },
      });
    }

    await recordRouteOutcome(ctx.client ?? null, {
      providerRoute: result.usage.providerRoute,
      modelId: result.usage.modelId,
      gatewayProviderSlug: result.routing?.gatewayProviderSlug,
      endpointKey: result.routing?.endpointKey,
      success: true,
      latencyMs: result.usage.latencyMs,
      estimatedCostUsd: result.routing?.estimatedCostUsd,
      actualCostUsd: result.usage.totalCostUsd,
    });

    recordAiRuntime({
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      employeeId: input.employee.id,
      agentRunId: ctx.agentRunId,
      provider: result.usage.providerName,
      model: result.usage.modelId,
      modelMode,
      mode: "live",
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedCostUsd: result.usage.totalCostUsd,
      durationMs: result.usage.latencyMs,
    });

    employeeDirectRuntimeTestHooks?.onRuntimeSuccess?.({ workUnitId });

    return {
      response: mapModelSchemaToEmployeeResponse(
        input.employee.id,
        input.employee.name,
        parsed.data,
      ),
      aiMode: "runtime-v2",
      metrics: runtimeLiveMetricsFromUsage(result.usage),
      usedRuntime: true,
      runtimeFallback: false,
      workUnitId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordRouteOutcome(ctx.client ?? null, {
      providerRoute: "siliconflow_direct",
      modelId: input.employee.model ?? "unknown",
      success: false,
      jsonFailure: message.includes("schema"),
    });
    if (ctx.client && ctx.workspaceId && workUnitId) {
      try {
        await failAiWorkUnit(ctx.client, ctx.workspaceId, workUnitId, message);
      } catch {
        // observability only
      }
    }
    throw error;
  }
}

async function callLegacyEmployeeRoute(
  input: EmployeeDirectRouteInput,
  options: EmployeeDirectRouteOptions,
): Promise<EmployeeDirectRouteResult> {
  employeeDirectRuntimeTestHooks?.onLegacyRoute?.();

  if (employeeDirectRuntimeTestHooks?.stubLegacyResult) {
    return {
      ...employeeDirectRuntimeTestHooks.stubLegacyResult,
      usedRuntime: false,
      runtimeFallback: true,
    };
  }

  const legacy = await routeEmployeeResponse(input, options);
  return {
    ...legacy,
    usedRuntime: false,
    runtimeFallback: false,
  };
}

function directCapabilityAllowsStreaming(
  input: EmployeeDirectRouteInput,
  options: EmployeeDirectRouteOptions = {},
): boolean {
  if (input.artifactIntent) return false;
  // Voice calls pre-run web search into the prompt, then need streamed speech.
  // Blocking the structured path here created 10s+ silence after the bridge
  // phrase and weak "I'll follow up" answers with no spoken findings.
  // Keep CRM/email tool turns on the structured path; stream everything else.
  if (options.voiceCall && !messageLikelyNeedsBusinessTool(input.message)) {
    return true;
  }
  // Match the queued runtime gate: CRM / email / retries must stay on the
  // structured path. Plain streaming hardcodes empty effects.
  if (
    conversationLikelyNeedsStructuredEffects(
      input.message,
      input.room?.messages as Array<{ senderType?: string; content?: string }> | undefined,
    )
  ) {
    return false;
  }
  return true;
}

async function streamEmployeeDirectResponse(
  input: EmployeeDirectRouteInput,
  options: EmployeeDirectRouteOptions,
  streaming: EmployeeDirectReplyStreaming,
): Promise<EmployeeDirectRouteResult> {
  if (!directCapabilityAllowsStreaming(input, options)) {
    throw new Error("This call turn requires the structured Brain path.");
  }
  const modelMode = resolveDirectEmployeeModelMode(
    (options.modelMode ?? input.employee.modelMode) as ModelMode | undefined,
    input.employee.roleKey,
  );
  const capability = inferEmployeeReplyCapability({
    userMessage: input.message,
    artifactIntent: input.artifactIntent,
    isGreetingRun: options.isGreetingRun,
    conversationMode: options.conversationMode,
  });
  if (!["quick_reply", "structured_chat"].includes(capability)) {
    throw new Error("This call turn requires the structured Brain path.");
  }
  const { maxOutputTokens, temperature, timeoutMs } = resolveRouteGenerationParams(
    input.message,
    options,
  );
  const { system, prompt } = buildEmployeePrompts(input, {
    ...options,
    plainProse: true,
  });
  const model = resolveModel(input.employee.provider, modelMode, input.employee.model);
  const started = Date.now();
  const result = await streamSiliconFlowText(
    system,
    prompt,
    model,
    maxOutputTokens,
    timeoutMs,
    temperature,
    streaming.onReplyDelta,
    streaming.abortSignal,
  );
  const reply = sanitizeReplyForChat(result.text);
  if (!reply) throw new Error("Streaming produced an empty employee response.");
  const inputTokens = result.inputTokens ?? 0;
  const outputTokens = result.outputTokens ?? 0;
  return {
    response: {
      employeeId: input.employee.id,
      employeeName: input.employee.name,
      reply,
      effect: { workLog: [], tasks: [], memory: [], approvals: [] },
    },
    aiMode: "siliconflow-stream",
    metrics: {
      model: result.model,
      inputTokens,
      outputTokens,
      fallbackUsed: false,
      estimatedCostUsd: estimateCost(result.model, inputTokens, outputTokens),
      durationMs: Date.now() - started,
    },
    usedRuntime: false,
    runtimeFallback: false,
  };
}

/**
 * Dispatch direct employee respond: runtime-on with fallback, shadow/legacy-guarded/old → legacy path.
 */
export async function dispatchEmployeeDirectResponse(
  input: EmployeeDirectRouteInput,
  options: EmployeeDirectRouteOptions = {},
  streaming?: EmployeeDirectReplyStreaming,
): Promise<EmployeeDirectRouteResult> {
  const dispatch = getEmployeeDirectRuntimeDispatch();

  if (
    streaming &&
    isEmployeeReplyStreamingEnabled() &&
    input.employee.provider.toLowerCase() === "siliconflow"
  ) {
    try {
      return await streamEmployeeDirectResponse(input, options, streaming);
    } catch (error) {
      if (
        streaming.abortSignal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw error;
      }
      // Structured Brain fallback preserves tools/effects when plain streaming
      // is not safe for this turn.
    }
  }

  if (dispatch === "runtime-on") {
    try {
      return await generateEmployeeDirectResponseRuntime(input, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const ctx = options.context ?? {};

      recordAiRuntime({
        workspaceId: ctx.workspaceId,
        roomId: ctx.roomId,
        employeeId: input.employee.id,
        agentRunId: ctx.agentRunId,
        provider: "runtime-v2",
        model: "runtime-v2",
        modelMode: options.modelMode,
        mode: "fallback",
        fallbackReason: "employee_direct_runtime_failed",
        error: message,
      });

      employeeDirectRuntimeTestHooks?.onRuntimeFallback?.({
        error: message,
        workUnitFailed: Boolean(ctx.client && ctx.workspaceId),
      });

      const legacy = await callLegacyEmployeeRoute(input, options);
      return { ...legacy, runtimeFallback: true };
    }
  }

  if (dispatch === "legacy-guarded") {
    const ctx = options.context ?? {};
    recordAiRuntime({
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      employeeId: input.employee.id,
      agentRunId: ctx.agentRunId,
      provider: "legacy",
      model: input.employee.model ?? "legacy",
      modelMode: options.modelMode,
      mode: "fallback",
      fallbackReason: "employee_direct_runtime_execution_disabled",
    });
  }

  return callLegacyEmployeeRoute(input, options);
}
