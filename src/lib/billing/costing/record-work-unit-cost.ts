import type { SupabaseClient } from "@supabase/supabase-js";
import { intelligenceModeFromModelMode } from "@/lib/ai/intelligence-policy";
import type { AiWorkUnit } from "@/lib/supabase/ai-work-units";
import { calculateModelCost } from "./calculate-model-cost";
import { recordCostEvent } from "./record-cost-event";
import type { CostSourceType } from "./types";

/** Work types that are internal orchestration overhead — recorded but not billed to the workspace. */
const PLATFORM_OVERHEAD_WORK_TYPES = new Set([
  "orchestration_classify",
  "room_steward",
  "dm_steward",
]);

function isPlatformOverhead(workType: string): boolean {
  if (PLATFORM_OVERHEAD_WORK_TYPES.has(workType)) return true;
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

/** Resolve Efficient / Balanced / Strong (etc.) for Usage breakdowns. */
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

/**
 * Derive a billable cost event from a completed work unit and write it to the cost ledger.
 * This is the primary capture hook — every path that completes a work unit records cost here.
 * Fire-and-forget: callers should not block on ledger writes.
 */
export async function recordCostFromWorkUnit(
  client: SupabaseClient,
  workUnit: AiWorkUnit,
  result?: {
    actualCostUsd?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    cachedInputTokens?: number | null;
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
  const intelligenceMode = intelligenceModeFromMeta(meta);

  const { costUsd, costSource } = calculateModelCost({
    modelId,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    providerRoute:
      stringFromMeta(meta, "providerRoute") ?? workUnit.providerRoute ?? null,
    actualCostUsd: result?.actualCostUsd ?? workUnit.actualCostUsd,
    estimatedCostUsd: workUnit.estimatedCostUsd,
  });

  // Skip zero-cost events (e.g. mock provider) to keep the ledger meaningful.
  if (costUsd <= 0) return;

  const platformOverhead = isPlatformOverhead(workUnit.workType);

  await recordCostEvent(client, {
    workspaceId: workUnit.workspaceId,
    userId: workUnit.userId ?? null,
    employeeId: workUnit.employeeId ?? null,
    workUnitId: workUnit.id,
    roomId: workUnit.roomId ?? null,
    topicId: workUnit.topicId ?? null,
    sourceType: sourceTypeFor(workUnit),
    providerRoute:
      stringFromMeta(meta, "providerRoute") ?? workUnit.providerRoute ?? null,
    providerName:
      stringFromMeta(meta, "providerName") ?? workUnit.providerName ?? null,
    modelId,
    providerCredentialId: stringFromMeta(meta, "providerCredentialId"),
    providerAllocationId: stringFromMeta(meta, "providerAllocationId"),
    providerProjectId: stringFromMeta(meta, "providerProjectId"),
    runtimeMode:
      stringFromMeta(meta, "runtimeMode") ?? workUnit.runtimeMode ?? null,
    capability: workUnit.capability ?? null,
    workType: workUnit.workType,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    actualCostUsd: costSource === "provider_usage" ? costUsd : undefined,
    estimatedCostUsd: costSource === "estimated" ? costUsd : undefined,
    costSource,
    platformOverhead,
    billableToWorkspace: !platformOverhead,
    metadata: {
      workType: workUnit.workType,
      workUnitStatus: workUnit.status,
      ...(intelligenceMode ? { intelligenceMode } : {}),
      ...(modelId ? { modelId } : {}),
    },
  });
}
