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
import { recordRouteOutcome } from "@/lib/ai/runtime/route-health";

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
  const modelMode = resolveDirectEmployeeModelMode(
    (options.modelMode ?? input.employee.modelMode) as ModelMode | undefined,
    input.employee.roleKey,
  );
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
      },
    });

    const parsed = ModelResponseSchema.safeParse(result.object);
    if (!parsed.success) {
      throw new Error("Runtime employee direct response failed schema validation.");
    }

    if (ctx.client && ctx.workspaceId && workUnitId) {
      await completeAiWorkUnit(ctx.client, ctx.workspaceId, workUnitId, {
        actualCostUsd: result.usage.totalCostUsd,
        actualWorkMinutes: result.workMinutesEstimated,
        modelId: result.usage.modelId,
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
          modelId: result.usage.modelId,
          modelMode,
          intelligenceMode: intelligenceModeFromModelMode(modelMode),
          agentRunId: ctx.agentRunId,
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

/**
 * Dispatch direct employee respond: runtime-on with fallback, shadow/legacy-guarded/old → legacy path.
 */
export async function dispatchEmployeeDirectResponse(
  input: EmployeeDirectRouteInput,
  options: EmployeeDirectRouteOptions = {},
): Promise<EmployeeDirectRouteResult> {
  const dispatch = getEmployeeDirectRuntimeDispatch();

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
