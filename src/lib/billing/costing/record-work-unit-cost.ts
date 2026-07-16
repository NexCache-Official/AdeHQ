import type { SupabaseClient } from "@supabase/supabase-js";
import { intelligenceModeFromModelMode } from "@/lib/ai/intelligence-policy";
import { resolveRouteIdForModel } from "@/lib/brain/catalog";
import { recordBrainUsage } from "@/lib/brain/metering/record-brain-usage";
import type { AiWorkUnit } from "@/lib/supabase/ai-work-units";
import type { CostSourceType } from "./types";

/** Known steward/classifier work types — unbilled but still recorded (D3). */
const PLATFORM_OVERHEAD_WORK_TYPES = new Set([
  "orchestration_classify",
  "room_steward",
  "dm_steward",
]);

function isKnownPlatformOverhead(workType: string): boolean {
  return PLATFORM_OVERHEAD_WORK_TYPES.has(workType);
}

/** Legacy fallback only — logged; prefer explicit metadata.billableToWorkspace. */
function legacyPlatformOverheadHeuristic(workType: string): boolean {
  return workType.includes("classify") || workType.includes("steward");
}

function sourceTypeFor(workUnit: AiWorkUnit): CostSourceType {
  const wt = workUnit.workType.toLowerCase();
  if (workUnit.capability === "embedding" || wt.includes("embedding")) return "embedding";
  if (wt.includes("browser")) return "browser";
  if (wt.includes("search")) return "search";
  if (wt.includes("file")) return "file_analysis";
  if (wt.includes("artifact") || wt.includes("report")) return "artifact";
  return "llm";
}

function numFromMeta(meta: Record<string, unknown>, key: string): number {
  const value = meta[key];
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function stringFromMeta(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolFromMeta(meta: Record<string, unknown>, key: string): boolean | undefined {
  const value = meta[key];
  if (typeof value === "boolean") return value;
  return undefined;
}

function intelligenceModeFromMeta(meta: Record<string, unknown>): string | null {
  const explicit = stringFromMeta(meta, "intelligenceMode");
  if (explicit) return intelligenceModeFromModelMode(explicit);
  const modelMode =
    stringFromMeta(meta, "resolvedRunModelMode") ??
    stringFromMeta(meta, "modelMode") ??
    stringFromMeta(meta, "oldModelMode");
  if (modelMode) return intelligenceModeFromModelMode(modelMode);
  return null;
}

function resolveBillable(workUnit: AiWorkUnit, meta: Record<string, unknown>): boolean {
  const explicit = boolFromMeta(meta, "billableToWorkspace");
  if (explicit !== undefined) return explicit;

  if (isKnownPlatformOverhead(workUnit.workType)) return false;

  if (legacyPlatformOverheadHeuristic(workUnit.workType)) {
    console.warn(
      `[AdeHQ cost ledger] legacy platform-overhead heuristic matched workType=${workUnit.workType}; set metadata.billableToWorkspace explicitly`,
    );
    return false;
  }
  return true;
}

/**
 * Derive a billable cost event from a completed work unit via the Brain metering spine.
 */
export async function recordCostFromWorkUnit(
  client: SupabaseClient,
  workUnit: AiWorkUnit,
  result?: {
    actualCostUsd?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    cachedInputTokens?: number | null;
    status?: "succeeded" | "failed" | "cancelled";
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const meta = (result?.metadata ?? workUnit.metadata ?? {}) as Record<string, unknown>;
  const inputTokens = result?.inputTokens ?? numFromMeta(meta, "inputTokens");
  const outputTokens = result?.outputTokens ?? numFromMeta(meta, "outputTokens");
  const cachedInputTokens = result?.cachedInputTokens ?? numFromMeta(meta, "cachedInputTokens");

  const modelId =
    stringFromMeta(meta, "modelId") ??
    workUnit.modelId ??
    null;
  const providerRoute =
    stringFromMeta(meta, "providerRoute") ?? workUnit.providerRoute ?? null;
  const intelligenceMode = intelligenceModeFromMeta(meta);
  const sourceType = sourceTypeFor(workUnit);
  const stepId = stringFromMeta(meta, "brainStepId") ?? "complete";
  const attempt = stringFromMeta(meta, "brainAttempt") ?? "1";
  const sharedKey = stringFromMeta(meta, "brainIdempotencyKey");
  const usageId = stringFromMeta(meta, "usageId");
  const idempotencyKey =
    sharedKey ??
    (usageId ? `usage_event:${usageId}:${sourceType}` : `${workUnit.id}:${stepId}:${attempt}`);

  const routeId =
    stringFromMeta(meta, "routeId") ??
    resolveRouteIdForModel({
      modelId,
      providerRoute,
      capability: (workUnit.capability as never) ?? null,
    }) ??
    "route_text_v4flash_sf";

  const billableToWorkspace = resolveBillable(workUnit, meta);
  const providerCalled =
    boolFromMeta(meta, "providerCalled") ??
    (inputTokens > 0 || outputTokens > 0 || cachedInputTokens > 0 || (result?.actualCostUsd ?? 0) > 0);

  // Pure mock with no units — skip (defect I: still record real zero-cost provider calls via spine).
  if (
    (providerRoute === "mock" || stringFromMeta(meta, "providerName") === "mock") &&
    !providerCalled
  ) {
    return;
  }

  await recordBrainUsage({
    client,
    workspaceId: workUnit.workspaceId,
    idempotencyKey,
    userId: workUnit.userId ?? null,
    employeeId: workUnit.employeeId ?? null,
    workUnitId: workUnit.id,
    brainRunId: stringFromMeta(meta, "brainRunId"),
    decisionAttemptId: stringFromMeta(meta, "decisionAttemptId"),
    roomId: workUnit.roomId ?? null,
    topicId: workUnit.topicId ?? null,
    sourceType,
    routeId,
    usage: {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      providerReportedCostUsd:
        result?.actualCostUsd != null && result.actualCostUsd > 0
          ? // Prefer token×rates when metadata says adapters precomputed a guess.
            boolFromMeta(meta, "providerReportedCost")
            ? result.actualCostUsd
            : undefined
          : undefined,
      searchRequests: numFromMeta(meta, "searchRequests"),
      browserSessionSeconds: numFromMeta(meta, "browserSessionSeconds"),
      imageCount: numFromMeta(meta, "imageCount"),
      videoCount: numFromMeta(meta, "videoCount"),
      ttsUtf8Bytes: numFromMeta(meta, "ttsUtf8Bytes"),
    },
    status:
      result?.status ??
      (workUnit.status === "cancelled"
        ? "cancelled"
        : workUnit.status === "failed"
          ? "failed"
          : "succeeded"),
    billableToWorkspace,
    platformOverhead: !billableToWorkspace,
    workType: workUnit.workType,
    capability: workUnit.capability ?? null,
    runtimeMode:
      stringFromMeta(meta, "runtimeMode") ?? workUnit.runtimeMode ?? null,
    providerCalled,
    metadata: {
      workType: workUnit.workType,
      workUnitStatus: workUnit.status,
      ...(intelligenceMode ? { intelligenceMode } : {}),
      ...(modelId ? { modelId } : {}),
    },
  });
}
