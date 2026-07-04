import type { SupabaseClient } from "@supabase/supabase-js";
import { getRuntimeFlags } from "@/lib/ai/runtime/flags";
import { planRoute } from "@/lib/ai/runtime";
import type { CapabilityRouteDecision } from "@/lib/ai/runtime/types";
import { recordAiRuntime } from "@/lib/ai/runtime-log";
import { isBrowserResearchLiveReady } from "./provider-config";
import type { BrowserResearchProvider } from "./types";

export type BrowserResearchRuntimeDispatch = "old" | "shadow" | "runtime-on";

export type BrowserResearchShadowObservationParams = {
  client: SupabaseClient;
  workspaceId: string;
  roomId?: string;
  topicId?: string;
  employeeId: string;
  query: string;
  researchProvider: BrowserResearchProvider;
  workUnitId: string;
};

export type BrowserResearchShadowTestHooks = {
  forceShadowFailure?: boolean | Error;
  onShadowObservation?: (routing: CapabilityRouteDecision) => void;
};

let browserResearchShadowTestHooks: BrowserResearchShadowTestHooks | null = null;

/** @internal Test-only hook — do not use in production callers. */
export function setBrowserResearchShadowTestHooks(
  hooks: BrowserResearchShadowTestHooks | null,
): void {
  browserResearchShadowTestHooks = hooks;
}

export function getBrowserResearchRuntimeDispatch(): BrowserResearchRuntimeDispatch {
  const { mode } = getRuntimeFlags();
  if (mode === "on") return "runtime-on";
  if (mode === "shadow") return "shadow";
  return "old";
}

export function shouldShadowBrowserResearch(): boolean {
  return getBrowserResearchRuntimeDispatch() === "shadow";
}

/** Runtime V2 on-path execution for live browser research (V20.0.2). */
export function shouldExecuteBrowserResearchViaRuntime(): boolean {
  return getBrowserResearchRuntimeDispatch() === "runtime-on" && isBrowserResearchLiveReady();
}

/**
 * Shadow observation — plans what Runtime V2 would route without changing research output.
 * Never throws; failures are logged and swallowed.
 */
export async function recordBrowserResearchRuntimeShadow(
  params: BrowserResearchShadowObservationParams,
): Promise<CapabilityRouteDecision | null> {
  if (!shouldShadowBrowserResearch()) return null;

  if (browserResearchShadowTestHooks?.forceShadowFailure) {
    throw browserResearchShadowTestHooks.forceShadowFailure instanceof Error
      ? browserResearchShadowTestHooks.forceShadowFailure
      : new Error("Forced browser research shadow failure (test hook)");
  }

  try {
    const routing = planRoute(
      {
        capability: "browser_research",
        workspaceId: params.workspaceId,
        employeeId: params.employeeId,
        message: params.query,
        needsBrowser: true,
        researchProvider: params.researchProvider,
      },
      { forceMode: "shadow" },
    );

    browserResearchShadowTestHooks?.onShadowObservation?.(routing);

    recordAiRuntime({
      provider: routing.providerName,
      model: routing.modelId,
      mode: "fallback",
      fallbackReason: "browser_research_shadow_plan",
      workspaceId: params.workspaceId,
      roomId: params.roomId,
      employeeId: params.employeeId,
      estimatedCostUsd: routing.estimatedCostUsd,
      agentRunId: params.workUnitId,
    });

    const { data: existingRow } = await params.client
      .from("ai_work_units")
      .select("metadata")
      .eq("workspace_id", params.workspaceId)
      .eq("id", params.workUnitId)
      .maybeSingle();

    const priorMetadata =
      existingRow?.metadata && typeof existingRow.metadata === "object"
        ? (existingRow.metadata as Record<string, unknown>)
        : {};

    await params.client
      .from("ai_work_units")
      .update({
        runtime_mode: routing.runtimeMode,
        reasoning_profile: routing.reasoningProfile,
        provider_route: routing.providerRoute,
        provider_name: routing.providerName,
        model_id: routing.modelId,
        estimated_cost_usd: routing.estimatedCostUsd,
        estimated_work_minutes: routing.estimatedWorkMinutes,
        metadata: {
          ...priorMetadata,
          shadow: true,
          shadowObservation: true,
          source: "browser_research",
          researchProvider: params.researchProvider,
          shadowCapability: routing.capability,
          shadowRuntimeMode: routing.runtimeMode,
          shadowProviderRoute: routing.providerRoute,
          shadowModelId: routing.modelId,
          shadowEstimatedWorkMinutes: routing.estimatedWorkMinutes,
          shadowEstimatedCostUsd: routing.estimatedCostUsd,
          shadowFallbackCandidates: routing.fallbackCandidates,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", params.workspaceId)
      .eq("id", params.workUnitId)
      .select("id");

    return routing;
  } catch (error) {
    console.warn("[AdeHQ browser research shadow]", error);
    recordAiRuntime({
      provider: "shadow",
      model: "shadow-plan",
      mode: "fallback",
      fallbackReason: "browser_research_shadow_failed",
      workspaceId: params.workspaceId,
      roomId: params.roomId,
      employeeId: params.employeeId,
      agentRunId: params.workUnitId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Swallow shadow errors at call site — research run must never fail because of shadow. */
export async function observeBrowserResearchRuntimeShadowSafely(
  params: BrowserResearchShadowObservationParams,
): Promise<CapabilityRouteDecision | null> {
  try {
    return await recordBrowserResearchRuntimeShadow(params);
  } catch (error) {
    console.warn("[AdeHQ browser research shadow]", error);
    recordAiRuntime({
      provider: "shadow",
      model: "shadow-plan",
      mode: "fallback",
      fallbackReason: "browser_research_shadow_failed",
      workspaceId: params.workspaceId,
      roomId: params.roomId,
      employeeId: params.employeeId,
      agentRunId: params.workUnitId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
