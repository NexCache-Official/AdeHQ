import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeModelMode,
  resolveModel,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import { normalizeLiveProvider } from "@/lib/config/features";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { planRoute } from "@/lib/ai/runtime";
import { getRuntimeFlags, isEmployeeDirectRuntimeExecutionEnabled, isEmployeeQueuedRuntimeExecutionEnabled } from "@/lib/ai/runtime/flags";
import type { AiCapability, CapabilityRouteDecision } from "@/lib/ai/runtime/types";
import { completeAiWorkUnit, createAiWorkUnit } from "@/lib/supabase/ai-work-units";

export type EmployeeHotPathRuntimeDispatch = "old" | "shadow" | "on-blocked" | "runtime-on";

export type EmployeeReplyShadowSource =
  | "employee_direct_response_shadow"
  | "employee_queued_response_shadow";

export type EmployeeReplyShadowPlanParams = {
  client?: SupabaseClient;
  workspaceId: string;
  employeeId: string;
  employeeName: string;
  roleKey: string;
  roomId?: string;
  topicId?: string;
  dmId?: string;
  messageId?: string;
  userMessage: string;
  oldProvider: string;
  oldModel: string;
  oldModelMode: ModelMode;
  /** What resolveRunModelMode would choose — shadow metadata only. */
  resolvedRunModelMode?: ModelMode;
  conversationMode?: string;
  isGreetingRun?: boolean;
  artifactIntent?: boolean | { type?: string } | null;
  estimatedCostUsd?: number;
  agentRunId?: string;
  runId?: string;
  usageId?: string;
  collaborationId?: string;
  collaborationRole?: string;
  source: EmployeeReplyShadowSource;
};

export type EmployeeReplyShadowResultParams = EmployeeReplyShadowPlanParams & {
  workUnitId?: string;
  routing?: CapabilityRouteDecision;
  actualProvider?: string;
  actualModel?: string;
  actualModelMode?: ModelMode;
  actualCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  aiMode?: string;
  failed?: boolean;
};

export type EmployeeReplyShadowPlanResult = {
  workUnitId?: string;
  routing: CapabilityRouteDecision;
  shadowCapability: AiCapability;
  shadowRuntimeMode: string;
  dispatch: EmployeeHotPathRuntimeDispatch;
  runtimeOnBlocked: boolean;
};

export type HotPathShadowTestHooks = {
  forcePlanFailure?: boolean | Error;
  onPlan?: (result: EmployeeReplyShadowPlanResult | null) => void;
  onResult?: (params: EmployeeReplyShadowResultParams) => void;
  onFailure?: (error: unknown) => void;
};

let hotPathShadowTestHooks: HotPathShadowTestHooks | null = null;

/** @internal Test-only hook — do not use in production callers. */
export function setHotPathShadowTestHooks(hooks: HotPathShadowTestHooks | null): void {
  hotPathShadowTestHooks = hooks;
}

/** Hot path dispatch for shadow instrumentation (queued stays on-blocked until d-3). */
export function getEmployeeHotPathRuntimeDispatch(
  source: EmployeeReplyShadowSource = "employee_direct_response_shadow",
): EmployeeHotPathRuntimeDispatch {
  const { mode } = getRuntimeFlags();
  if (mode === "off") return "old";
  if (mode === "shadow") return "shadow";
  if (source === "employee_direct_response_shadow" && isEmployeeDirectRuntimeExecutionEnabled()) {
    return "runtime-on" as EmployeeHotPathRuntimeDispatch;
  }
  if (source === "employee_queued_response_shadow" && isEmployeeQueuedRuntimeExecutionEnabled()) {
    return "runtime-on" as EmployeeHotPathRuntimeDispatch;
  }
  return "on-blocked";
}

/** True when shadow planning should run for the given source. */
export function shouldShadowEmployeeHotPath(
  source: EmployeeReplyShadowSource = "employee_direct_response_shadow",
): boolean {
  const { mode } = getRuntimeFlags();
  if (mode === "off") return false;
  if (mode === "shadow") return true;
  if (source === "employee_direct_response_shadow") {
    return !isEmployeeDirectRuntimeExecutionEnabled();
  }
  if (source === "employee_queued_response_shadow") {
    return !isEmployeeQueuedRuntimeExecutionEnabled();
  }
  return true;
}

/** Queued hot path — runtime execution when mode=on and explicit flag. */
export function shouldExecuteRuntimeForEmployeeQueuedPath(): boolean {
  return isEmployeeQueuedRuntimeExecutionEnabled();
}

/** Direct hot path — runtime execution when mode=on and explicit flag. */
export function shouldExecuteRuntimeForEmployeeDirectPath(): boolean {
  return isEmployeeDirectRuntimeExecutionEnabled();
}

const SIMPLE_ACK_PATTERN =
  /^(hi|hello|hey|thanks|thank you|ok|okay|got it|sounds good|cool|great|perfect)[!.?\s]*$/i;

export function inferEmployeeReplyCapability(params: {
  userMessage: string;
  artifactIntent?: boolean | { type?: string } | null;
  isGreetingRun?: boolean;
  conversationMode?: string;
}): AiCapability {
  if (params.artifactIntent) return "artifact_generation";
  if (params.isGreetingRun || params.conversationMode === "broadcast_social") {
    return "quick_reply";
  }
  const text = params.userMessage.trim();
  if (SIMPLE_ACK_PATTERN.test(text)) return "quick_reply";
  if (text.length < 48 && /^(hi|hello|hey|thanks|ok)\b/i.test(text)) {
    return "quick_reply";
  }
  return "structured_chat";
}

function shadowFallbackReason(source: EmployeeReplyShadowSource): string {
  return source === "employee_queued_response_shadow"
    ? "employee_queued_response_shadow_plan"
    : "employee_direct_response_shadow_plan";
}

function workTypeForSource(source: EmployeeReplyShadowSource): string {
  return source === "employee_queued_response_shadow"
    ? "employee_queued_response_shadow"
    : "employee_direct_response_shadow";
}

/** Plan what Runtime V2 would do — no provider call, never throws. */
export async function planEmployeeReplyShadowRun(
  params: EmployeeReplyShadowPlanParams,
): Promise<EmployeeReplyShadowPlanResult | null> {
  if (!shouldShadowEmployeeHotPath(params.source)) {
    hotPathShadowTestHooks?.onPlan?.(null);
    return null;
  }

  try {
    if (hotPathShadowTestHooks?.forcePlanFailure) {
      throw hotPathShadowTestHooks.forcePlanFailure instanceof Error
        ? hotPathShadowTestHooks.forcePlanFailure
        : new Error("Forced employee hot path shadow plan failure (test hook)");
    }

    const dispatch = getEmployeeHotPathRuntimeDispatch(params.source);
    const runtimeOnBlocked = dispatch === "on-blocked";
    const guardReason =
      params.source === "employee_direct_response_shadow"
        ? "employee_direct_runtime_execution_disabled"
        : "employee_queued_runtime_execution_disabled";
    const shadowCapability = inferEmployeeReplyCapability(params);
    const modelModeForRoute =
      params.resolvedRunModelMode ?? normalizeModelMode(params.oldModelMode);

    const routing = planRoute(
      {
        workspaceId: params.workspaceId,
        employeeId: params.employeeId,
        capability: shadowCapability,
        modelMode: modelModeForRoute,
        message: params.userMessage.slice(0, 500),
      },
      { forceMode: "shadow" },
    );

    recordAiRuntime({
      workspaceId: params.workspaceId,
      roomId: params.roomId,
      employeeId: params.employeeId,
      agentRunId: params.agentRunId ?? params.runId,
      provider: routing.providerName,
      model: routing.modelId,
      modelMode: modelModeForRoute,
      mode: "fallback",
      fallbackReason: runtimeOnBlocked ? guardReason : shadowFallbackReason(params.source),
      estimatedCostUsd: routing.estimatedCostUsd,
    });

    let workUnitId: string | undefined;

    if (params.client && params.workspaceId) {
      const workUnit = await createAiWorkUnit(params.client, {
        workspaceId: params.workspaceId,
        roomId: params.roomId,
        topicId: params.topicId,
        dmId: params.dmId,
        employeeId: params.employeeId,
        workType: workTypeForSource(params.source),
        capability: shadowCapability,
        objective: "Shadow plan for employee reply hot path",
        status: "planned",
        runtimeMode: routing.runtimeMode,
        providerRoute: routing.providerRoute,
        providerName: routing.providerName,
        modelId: routing.modelId,
        estimatedCostUsd: routing.estimatedCostUsd,
        estimatedWorkMinutes: routing.estimatedWorkMinutes,
        metadata: {
          shadow: true,
          source: params.source,
          employeeName: params.employeeName,
          roleKey: params.roleKey,
          messageId: params.messageId,
          conversationMode: params.conversationMode,
          oldProvider: params.oldProvider,
          oldModel: params.oldModel,
          oldModelMode: params.oldModelMode,
          resolvedRunModelMode: params.resolvedRunModelMode,
          shadowCapability,
          shadowRuntimeMode: routing.runtimeMode,
          runId: params.runId,
          usageId: params.usageId,
          collaborationId: params.collaborationId,
          collaborationRole: params.collaborationRole,
          runtimeOnBlocked,
          guardReason: runtimeOnBlocked ? guardReason : undefined,
        },
      });
      workUnitId = workUnit.id;
    }

    const result: EmployeeReplyShadowPlanResult = {
      workUnitId,
      routing,
      shadowCapability,
      shadowRuntimeMode: routing.runtimeMode,
      dispatch,
      runtimeOnBlocked,
    };
    hotPathShadowTestHooks?.onPlan?.(result);
    return result;
  } catch (error) {
    recordEmployeeReplyShadowFailure(params, error);
    hotPathShadowTestHooks?.onPlan?.(null);
    return null;
  }
}

/** Record actual legacy-path outcome for shadow comparison — never throws. */
export async function recordEmployeeReplyShadowResult(
  params: EmployeeReplyShadowResultParams,
): Promise<void> {
  if (!shouldShadowEmployeeHotPath(params.source)) return;

  try {
    hotPathShadowTestHooks?.onResult?.(params);

    recordAiRuntime({
      workspaceId: params.workspaceId,
      roomId: params.roomId,
      employeeId: params.employeeId,
      agentRunId: params.agentRunId ?? params.runId,
      provider: params.actualProvider ?? params.oldProvider,
      model: params.actualModel ?? params.oldModel,
      modelMode: params.actualModelMode ?? params.oldModelMode,
      mode: params.failed ? "fallback" : "live",
      fallbackReason: `${params.source}_actual`,
      estimatedCostUsd: params.actualCostUsd ?? params.estimatedCostUsd,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      durationMs: params.durationMs,
    });

    if (params.client && params.workspaceId && params.workUnitId) {
      await completeAiWorkUnit(params.client, params.workspaceId, params.workUnitId, {
        actualCostUsd: params.actualCostUsd,
        metadata: {
          shadow: true,
          shadowObservation: true,
          source: params.source,
          aiMode: params.aiMode,
          oldProvider: params.oldProvider,
          oldModel: params.oldModel,
          oldModelMode: params.oldModelMode,
          actualProvider: params.actualProvider,
          actualModel: params.actualModel,
          actualModelMode: params.actualModelMode,
          shadowCapability: params.routing?.capability,
          shadowRuntimeMode: params.routing?.runtimeMode,
          shadowModelId: params.routing?.modelId,
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
          durationMs: params.durationMs,
          failed: params.failed,
        },
      });
    }
  } catch (error) {
    recordEmployeeReplyShadowFailure(params, error);
  }
}

/** Swallow shadow instrumentation errors — never affects user output. */
export function recordEmployeeReplyShadowFailure(
  params: Pick<
    EmployeeReplyShadowPlanParams,
    "workspaceId" | "roomId" | "employeeId" | "agentRunId" | "runId" | "source"
  >,
  error: unknown,
): void {
  hotPathShadowTestHooks?.onFailure?.(error);
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[AdeHQ employee hot path shadow] ${params.source}`, error);
  recordAiRuntime({
    workspaceId: params.workspaceId,
    roomId: params.roomId,
    employeeId: params.employeeId,
    agentRunId: params.agentRunId ?? params.runId,
    provider: "shadow",
    model: "shadow-plan",
    mode: "fallback",
    fallbackReason: `${params.source}_failed`,
    error: message,
  });
}

/** Resolve old-path model identifiers for shadow metadata (no behavior change). */
export function resolveEmployeeShadowOldModel(params: {
  provider: string;
  modelMode: ModelMode;
  explicitModel?: string | null;
}): { oldProvider: string; oldModel: string; oldModelMode: ModelMode } {
  const oldProvider = normalizeLiveProvider(params.provider);
  const oldModelMode = normalizeModelMode(params.modelMode);
  const oldModel = resolveModel(oldProvider, oldModelMode, params.explicitModel);
  return { oldProvider, oldModel, oldModelMode };
}
