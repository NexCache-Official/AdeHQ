import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CATALOG_VERSION,
  DECISION_VERSION,
  PACKET_VERSION,
  ROUTER_VERSION,
  getBrainRoute,
} from "@/lib/brain/catalog";
import { recordCostEvent } from "@/lib/billing/costing/record-cost-event";
import type { CostEventInput, CostLedgerEntry, CostSourceType } from "@/lib/billing/costing/types";
import { computeUsageCost, type RawBrainUsageUnits } from "./compute-usage-cost";

export type BrainUsageInput = {
  client: SupabaseClient;
  workspaceId: string;
  /** `${workUnitId ?? brainRunId}:${stepId}:${attempt}` — REQUIRED */
  idempotencyKey: string;
  employeeId?: string | null;
  userId?: string | null;
  workUnitId?: string | null;
  brainRunId?: string | null;
  decisionAttemptId?: string | null;
  roomId?: string | null;
  topicId?: string | null;
  messageId?: string | null;
  sourceType: CostSourceType;
  routeId: string;
  usage: RawBrainUsageUnits;
  status: "succeeded" | "failed" | "cancelled";
  /** Explicit — no string heuristics (defect G). */
  billableToWorkspace: boolean;
  platformOverhead?: boolean;
  workType?: string | null;
  capability?: string | null;
  runtimeMode?: string | null;
  providerCalled?: boolean;
  /** Skip pure mock / no provider call with zero units. */
  skipIfMock?: boolean;
  metadata?: Record<string, unknown>;
  packetVersion?: string;
  decisionVersion?: string;
  routerVersion?: string;
  catalogVersion?: string;
};

/**
 * Single Brain metering spine. Wraps recordCostEvent — does not fork the ledger.
 * Always records when a provider was called (defect I); billable flag is separate.
 */
export async function recordBrainUsage(input: BrainUsageInput): Promise<CostLedgerEntry | null> {
  const route = getBrainRoute(input.routeId);
  const isMock = route?.provider === "mock" || route?.providerRoute === "mock";
  if (input.skipIfMock && isMock) return null;

  const computed = computeUsageCost({
    routeId: input.routeId,
    usage: input.usage,
    providerCalled: input.providerCalled ?? true,
  });

  if (computed.usedFallbackRates) {
    console.warn(
      `[AdeHQ brain metering] missing live snapshot for route ${input.routeId}; charged via fallback rates`,
    );
  }

  // Defect I: still record diagnostic rows when unbilled / zero after mock skip.
  // Skip only when cost is 0 AND provider was not called (pure no-op).
  if (computed.costUsd <= 0 && input.providerCalled === false) {
    return null;
  }

  const inputTokens = Math.max(0, input.usage.inputTokens ?? 0);
  const cachedInputTokens = Math.max(0, input.usage.cachedInputTokens ?? 0);
  const outputTokens = Math.max(0, input.usage.outputTokens ?? 0);

  const event: CostEventInput = {
    workspaceId: input.workspaceId,
    userId: input.userId,
    employeeId: input.employeeId,
    workUnitId: input.workUnitId,
    roomId: input.roomId,
    topicId: input.topicId,
    messageId: input.messageId,
    sourceType: input.sourceType,
    providerRoute: route?.providerRoute ?? null,
    providerName: route?.provider ?? null,
    modelId: route?.model ?? null,
    runtimeMode: input.runtimeMode,
    capability: input.capability ?? route?.capability ?? null,
    workType: input.workType ?? input.sourceType,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    searchRequests: input.usage.searchRequests ?? 0,
    browserSessionSeconds: input.usage.browserSessionSeconds ?? 0,
    imageCount: input.usage.imageCount ?? 0,
    videoCount: input.usage.videoCount ?? 0,
    ttsUtf8Bytes: input.usage.ttsUtf8Bytes ?? 0,
    actualCostUsd: computed.costUsd,
    estimatedCostUsd: computed.costSource === "estimated" ? computed.costUsd : computed.costUsd,
    costSource: computed.costSource,
    billableToWorkspace: input.billableToWorkspace,
    platformOverhead: input.platformOverhead ?? !input.billableToWorkspace,
    status: input.status,
    pricingSnapshotId: computed.pricingSnapshotId,
    idempotencyKey: input.idempotencyKey,
    brainRunId: input.brainRunId,
    decisionAttemptId: input.decisionAttemptId,
    packetVersion: input.packetVersion ?? PACKET_VERSION,
    decisionVersion: input.decisionVersion ?? DECISION_VERSION,
    routerVersion: input.routerVersion ?? ROUTER_VERSION,
    catalogVersion: input.catalogVersion ?? CATALOG_VERSION,
    metadata: {
      ...(input.metadata ?? {}),
      routeId: input.routeId,
      brainMetering: true,
    },
  };

  return recordCostEvent(input.client, event);
}
