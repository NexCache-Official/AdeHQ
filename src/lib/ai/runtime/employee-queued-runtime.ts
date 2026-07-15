import {
  buildEmployeePrompts,
  mapModelSchemaToEmployeeResponse,
  ModelResponseSchema,
  resolveRouteGenerationParams,
  reasoningProfileForCapability,
  runtimeLiveMetricsFromUsage,
  toEmployeeResponseFromReplyAndEffect,
  type EmployeeRouteInput,
} from "@/lib/ai/employee-response-contract";
import {
  routeEmployeeResponse,
  type LiveCallMetrics,
  type RouteOptions,
} from "@/lib/ai/model-router";
import { estimateCost, resolveModel } from "@/lib/ai/model-catalog";
import { streamSiliconFlowText } from "@/lib/ai/siliconflow-call";
import {
  replyLeakedToolCallSyntax,
  sanitizeReplyForChat,
} from "@/lib/ai/normalize-model-response";
import { recoverToolCallsFromLeakedReply } from "@/lib/ai/recover-tool-call-leak";
import { isEmployeeReplyStreamingEnabled } from "@/lib/config/features";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { generateObject as runtimeGenerateObject } from "@/lib/ai/runtime";
import {
  getRuntimeFlags,
  isEmployeeQueuedRuntimeExecutionEnabled,
} from "@/lib/ai/runtime/flags";
import type { AiCapability } from "@/lib/ai/runtime/types";
import type { CollaborationRole, EmployeeResponse } from "@/lib/types";
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
import { recordRouteOutcome } from "@/lib/ai/runtime/route-health";
import { messageLikelyNeedsStructuredEffects } from "@/lib/ai/message-intent";

export type EmployeeQueuedRuntimeDispatch = "old" | "shadow" | "legacy-guarded" | "runtime-on";

export type EmployeeQueuedRouteInput = EmployeeRouteInput;
export type EmployeeQueuedRouteOptions = RouteOptions;

export type EmployeeQueuedRuntimeMeta = {
  runId: string;
  usageId?: string;
  messageId?: string;
  conversationMode?: string;
  collaborationId?: string;
  collaborationRole?: CollaborationRole | string;
  resolvedRunModelMode: ModelMode;
  oldProvider: string;
  oldModel: string;
  oldModelMode: ModelMode;
  /** Override ledger work_type when set (e.g. email_ask_employee). */
  workType?: string;
  emailThreadId?: string;
  emailMessageId?: string;
};

export type EmployeeQueuedRouteResult = {
  response: EmployeeResponse;
  aiMode: string;
  metrics?: LiveCallMetrics;
  failed?: boolean;
  errorMessage?: string;
  usedRuntime: boolean;
  runtimeFallback: boolean;
  workUnitId?: string;
};

export type EmployeeQueuedRuntimeTestHooks = {
  forceRuntimeFailure?: boolean | Error;
  stubLegacyResult?: EmployeeQueuedRouteResult;
  onRuntimeFallback?: (info: { error: string; workUnitFailed: boolean }) => void;
  onRuntimeSuccess?: (info: { workUnitId?: string; modelMode?: ModelMode }) => void;
  onLegacyRoute?: () => void;
};

let employeeQueuedRuntimeTestHooks: EmployeeQueuedRuntimeTestHooks | null = null;

/** @internal Test-only hook — do not use in production callers. */
export function setEmployeeQueuedRuntimeTestHooks(
  hooks: EmployeeQueuedRuntimeTestHooks | null,
): void {
  employeeQueuedRuntimeTestHooks = hooks;
}

export function getEmployeeQueuedRuntimeDispatch(): EmployeeQueuedRuntimeDispatch {
  const { mode } = getRuntimeFlags();
  if (mode === "off") return "old";
  if (mode === "shadow") return "shadow";
  if (!isEmployeeQueuedRuntimeExecutionEnabled()) return "legacy-guarded";
  return "runtime-on";
}

export function shouldAttemptEmployeeQueuedRuntime(): boolean {
  return getEmployeeQueuedRuntimeDispatch() === "runtime-on";
}

function workUnitMetadata(
  input: EmployeeQueuedRouteInput,
  meta: EmployeeQueuedRuntimeMeta,
  capability: AiCapability,
  runtimeMode?: string,
) {
  return {
    source: meta.workType ?? "employee_queued_response",
    runId: meta.runId,
    usageId: meta.usageId,
    messageId: meta.messageId,
    employeeId: input.employee.id,
    employeeName: input.employee.name,
    roleKey: input.employee.roleKey,
    roomId: input.room.id,
    topicId: input.topic?.id,
    conversationMode: meta.conversationMode,
    collaborationId: meta.collaborationId,
    collaborationRole: meta.collaborationRole,
    resolvedRunModelMode: meta.resolvedRunModelMode,
    oldProvider: meta.oldProvider,
    oldModel: meta.oldModel,
    oldModelMode: meta.oldModelMode,
    emailThreadId: meta.emailThreadId,
    emailMessageId: meta.emailMessageId,
    capability,
    runtimeMode,
  };
}

/** Runtime V2 execution for queued employee respond — throws on failure. */
export async function generateEmployeeQueuedResponseRuntime(
  input: EmployeeQueuedRouteInput,
  options: EmployeeQueuedRouteOptions,
  meta: EmployeeQueuedRuntimeMeta,
): Promise<EmployeeQueuedRouteResult> {
  const ctx = options.context ?? {};
  const modelMode = meta.resolvedRunModelMode;
  const { maxOutputTokens, temperature, timeoutMs } = resolveRouteGenerationParams(
    input.message,
    options,
  );
  const capability = inferEmployeeReplyCapability({
    userMessage: input.message,
    artifactIntent: input.artifactIntent,
    isGreetingRun: options.isGreetingRun,
    conversationMode: options.conversationMode ?? meta.conversationMode,
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
        meta.workType ??
        (capability === "artifact_generation"
          ? "artifact_generation"
          : "employee_queued_response"),
      capability,
      objective: "Queued employee reply via Runtime V2",
      status: "created",
      metadata: workUnitMetadata(input, meta, capability),
    });
    workUnitId = created.id;
    await startAiWorkUnit(ctx.client, ctx.workspaceId, workUnitId, {
      metadata: { agentRunId: meta.runId, usageId: meta.usageId },
    });
  }

  if (employeeQueuedRuntimeTestHooks?.forceRuntimeFailure) {
    const forced =
      employeeQueuedRuntimeTestHooks.forceRuntimeFailure instanceof Error
        ? employeeQueuedRuntimeTestHooks.forceRuntimeFailure
        : new Error("Forced employee queued runtime failure (test hook)");
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
    const { system, prompt } = buildEmployeePrompts(input, {
      isGreetingRun: options.isGreetingRun,
      collaborationRole: options.collaborationRole,
      leadEmployeeName: options.leadEmployeeName,
      leadReply: options.leadReply,
      conversationMode: options.conversationMode ?? meta.conversationMode,
      promptTier: options.promptTier,
    });

    if (ctx.client && ctx.agentRunId && ctx.workspaceId && ctx.roomId) {
      await appendRunStep(ctx.client, {
        workspaceId: ctx.workspaceId,
        agentRunId: ctx.agentRunId,
        roomId: ctx.roomId,
        topicId: ctx.topicId,
        employeeId: input.employee.id,
        stepType: "model_call",
        title: "Calling Runtime V2 (queued)",
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
        agentRunId: meta.runId,
        usageId: meta.usageId,
        roomId: ctx.roomId,
        topicId: ctx.topicId,
        source: "employee_queued_response",
      },
    });

    const parsed = ModelResponseSchema.safeParse(result.object);
    if (!parsed.success) {
      throw new Error("Runtime employee queued response failed schema validation.");
    }

    if (ctx.client && ctx.workspaceId && workUnitId) {
      await completeAiWorkUnit(ctx.client, ctx.workspaceId, workUnitId, {
        actualCostUsd: result.usage.totalCostUsd,
        actualWorkMinutes: result.workMinutesEstimated,
        modelId: result.usage.modelId,
        metadata: {
          ...workUnitMetadata(input, meta, capability, result.routing?.runtimeMode),
          providerRoute: result.usage.providerRoute,
          providerName: result.usage.providerName,
          providerCredentialId: result.usage.providerCredentialId,
          providerAllocationId: result.usage.providerAllocationId,
          providerProjectId: result.usage.providerProjectId,
          credentialSource: result.usage.credentialSource,
          workMinutesEstimated: result.workMinutesEstimated,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          modelId: result.usage.modelId,
          modelMode,
          intelligenceMode: intelligenceModeFromModelMode(modelMode),
          routeOptimizer: result.routing?.routeOptimizer,
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
      agentRunId: meta.runId,
      provider: result.usage.providerName,
      model: result.usage.modelId,
      modelMode,
      mode: "live",
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedCostUsd: result.usage.totalCostUsd,
      durationMs: result.usage.latencyMs,
    });

    employeeQueuedRuntimeTestHooks?.onRuntimeSuccess?.({ workUnitId, modelMode });

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

export type EmployeeReplyStreaming = {
  onReplyDelta: (delta: string) => void;
  abortSignal?: AbortSignal;
};

/** Providers whose employee composer path supports token streaming today. */
function providerSupportsStreaming(provider: string): boolean {
  return provider.trim().toLowerCase() === "siliconflow";
}

/**
 * Conversational replies (greetings + Q&A, opinions, strategy, explanations) stream
 * as plain prose. Anything that should produce structured effects — artifact drafts
 * or explicit tool work (CRM/email/task/calendar creation) — stays on the blocking
 * structured path. @mentions in the streamed prose still drive teammate follow-ups,
 * and the topic-summary refresh still captures learnings, so delegation and memory
 * are preserved without a JSON envelope.
 */
function capabilityAllowsStreaming(
  input: EmployeeQueuedRouteInput,
  options: EmployeeQueuedRouteOptions,
  meta: EmployeeQueuedRuntimeMeta,
): boolean {
  if (input.artifactIntent) return false;
  if (messageLikelyNeedsStructuredEffects(input.message)) return false;
  const capability = inferEmployeeReplyCapability({
    userMessage: input.message,
    artifactIntent: input.artifactIntent,
    isGreetingRun: options.isGreetingRun,
    conversationMode: options.conversationMode ?? meta.conversationMode,
  });
  return capability === "quick_reply" || capability === "structured_chat";
}

/**
 * Streaming composer path — plain-prose token streaming for conversational quick
 * replies. Produces the same {@link EmployeeQueuedRouteResult} shape (with empty
 * effects) as the blocking paths, plus incremental `onReplyDelta` calls, so
 * everything downstream is unchanged. Throws on failure; the dispatcher then
 * falls back to the blocking structured path.
 */
async function streamEmployeeQueuedResponse(
  input: EmployeeQueuedRouteInput,
  options: EmployeeQueuedRouteOptions,
  meta: EmployeeQueuedRuntimeMeta,
  streaming: EmployeeReplyStreaming,
): Promise<EmployeeQueuedRouteResult> {
  const ctx = options.context ?? {};
  const modelMode = meta.resolvedRunModelMode;
  const capability = inferEmployeeReplyCapability({
    userMessage: input.message,
    artifactIntent: input.artifactIntent,
    isGreetingRun: options.isGreetingRun,
    conversationMode: options.conversationMode ?? meta.conversationMode,
  });
  const { maxOutputTokens, temperature, timeoutMs } = resolveRouteGenerationParams(
    input.message,
    options,
  );
  const { system, prompt } = buildEmployeePrompts(input, {
    isGreetingRun: options.isGreetingRun,
    collaborationRole: options.collaborationRole,
    leadEmployeeName: options.leadEmployeeName,
    leadReply: options.leadReply,
    conversationMode: options.conversationMode ?? meta.conversationMode,
    promptTier: options.promptTier,
    plainProse: true,
  });
  const model = resolveModel(input.employee.provider, modelMode, input.employee.model);
  const started = Date.now();

  let workUnitId: string | undefined;
  if (ctx.client && ctx.workspaceId) {
    const created = await createAiWorkUnit(ctx.client, {
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      topicId: ctx.topicId,
      employeeId: input.employee.id,
      workType: meta.workType ?? "employee_queued_response",
      capability,
      objective: "Streamed employee reply",
      status: "created",
      providerName: input.employee.provider,
      modelId: model,
      metadata: workUnitMetadata(input, meta, capability, "stream"),
    });
    workUnitId = created.id;
    await startAiWorkUnit(ctx.client, ctx.workspaceId, workUnitId, {
      modelId: model,
      providerName: input.employee.provider,
      metadata: { agentRunId: meta.runId, usageId: meta.usageId, stream: true },
    });
  }

  try {
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

    // Streaming has no effects channel — recover executable calls from faux
    // [TOOL_CALL] DSL when present; otherwise abort so structured path retries.
    const recovered = recoverToolCallsFromLeakedReply(result.text);
    if (!recovered.length && replyLeakedToolCallSyntax(result.text)) {
      throw new Error(
        "Streaming reply leaked tool-call syntax; retrying structured path.",
      );
    }

    const reply =
      sanitizeReplyForChat(result.text) ||
      (recovered.length
        ? "On it — I'm putting that together now."
        : "");
    if (!reply.trim()) {
      throw new Error("Streaming produced an empty reply.");
    }

    const response = toEmployeeResponseFromReplyAndEffect(
      input.employee.id,
      input.employee.name,
      reply,
      {
        workLog: [],
        tasks: [],
        memory: [],
        approvals: [],
        toolCalls: recovered,
      },
    );

    const inputTokens = result.inputTokens ?? 0;
    const outputTokens = result.outputTokens ?? 0;
    const estimatedCostUsd = estimateCost(result.model, inputTokens, outputTokens);

    if (ctx.client && ctx.workspaceId && workUnitId) {
      await completeAiWorkUnit(ctx.client, ctx.workspaceId, workUnitId, {
        actualCostUsd: estimatedCostUsd,
        modelId: result.model,
        metadata: {
          ...workUnitMetadata(input, meta, capability, "stream"),
          providerName: input.employee.provider,
          workMinutesEstimated: Math.max(1, Math.round((Date.now() - started) / 60000)),
          inputTokens,
          outputTokens,
          modelId: result.model,
          modelMode,
          intelligenceMode: intelligenceModeFromModelMode(modelMode),
          stream: true,
        },
      });
    }

    return {
      response,
      aiMode: "siliconflow-stream",
      metrics: {
        model: result.model,
        inputTokens,
        outputTokens,
        fallbackUsed: false,
        estimatedCostUsd,
        durationMs: Date.now() - started,
      },
      usedRuntime: false,
      runtimeFallback: false,
    };
  } catch (error) {
    if (ctx.client && ctx.workspaceId && workUnitId) {
      try {
        await failAiWorkUnit(
          ctx.client,
          ctx.workspaceId,
          workUnitId,
          error instanceof Error ? error.message : String(error),
        );
      } catch {
        // observability only
      }
    }
    throw error;
  }
}

async function callLegacyQueuedRoute(
  input: EmployeeQueuedRouteInput,
  options: EmployeeQueuedRouteOptions,
): Promise<EmployeeQueuedRouteResult> {
  employeeQueuedRuntimeTestHooks?.onLegacyRoute?.();

  if (employeeQueuedRuntimeTestHooks?.stubLegacyResult) {
    return {
      ...employeeQueuedRuntimeTestHooks.stubLegacyResult,
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

/**
 * Dispatch queued employee respond: runtime-on with fallback, shadow/legacy-guarded/old → legacy path.
 */
export async function dispatchEmployeeQueuedResponse(
  input: EmployeeQueuedRouteInput,
  options: EmployeeQueuedRouteOptions,
  meta: EmployeeQueuedRuntimeMeta,
  streaming?: EmployeeReplyStreaming,
): Promise<EmployeeQueuedRouteResult> {
  const dispatch = getEmployeeQueuedRuntimeDispatch();

  // Streaming composer: token-streams the reply, then hands back the same result
  // shape as the blocking paths. Any failure falls through to normal dispatch.
  if (
    streaming &&
    isEmployeeReplyStreamingEnabled() &&
    providerSupportsStreaming(input.employee.provider) &&
    capabilityAllowsStreaming(input, options, meta)
  ) {
    try {
      return await streamEmployeeQueuedResponse(input, options, meta, streaming);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const ctx = options.context ?? {};
      recordAiRuntime({
        workspaceId: ctx.workspaceId,
        roomId: ctx.roomId,
        employeeId: input.employee.id,
        agentRunId: meta.runId,
        provider: "siliconflow-stream",
        model: "siliconflow-stream",
        modelMode: meta.resolvedRunModelMode,
        mode: "fallback",
        fallbackReason: "employee_reply_streaming_failed",
        error: message,
      });
      // Fall through to the standard (blocking) dispatch below.
    }
  }

  if (dispatch === "runtime-on") {
    try {
      return await generateEmployeeQueuedResponseRuntime(input, options, meta);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const ctx = options.context ?? {};

      recordAiRuntime({
        workspaceId: ctx.workspaceId,
        roomId: ctx.roomId,
        employeeId: input.employee.id,
        agentRunId: meta.runId,
        provider: "runtime-v2",
        model: "runtime-v2",
        modelMode: meta.resolvedRunModelMode,
        mode: "fallback",
        fallbackReason: "employee_queued_runtime_failed",
        error: message,
      });

      employeeQueuedRuntimeTestHooks?.onRuntimeFallback?.({
        error: message,
        workUnitFailed: Boolean(ctx.client && ctx.workspaceId),
      });

      const legacy = await callLegacyQueuedRoute(input, options);
      return { ...legacy, runtimeFallback: true };
    }
  }

  if (dispatch === "legacy-guarded") {
    const ctx = options.context ?? {};
    recordAiRuntime({
      workspaceId: ctx.workspaceId,
      roomId: ctx.roomId,
      employeeId: input.employee.id,
      agentRunId: meta.runId,
      provider: "legacy",
      model: meta.oldModel,
      modelMode: meta.resolvedRunModelMode,
      mode: "fallback",
      fallbackReason: "employee_queued_runtime_execution_disabled",
    });
  }

  return callLegacyQueuedRoute(input, options);
}
