import {
  costUsdFromSnapshot,
  getLiveSeedSnapshot,
  getBrainRoute,
  missingPricingSnapshotId,
  type BrainPricingSnapshot,
} from "@/lib/brain/catalog";
import { resolveTokenRates } from "@/lib/billing/costing/token-rates";
import type { CostSource } from "@/lib/billing/costing/types";

export type RawBrainUsageUnits = {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  imageCount?: number;
  videoCount?: number;
  ttsUtf8Bytes?: number;
  searchRequests?: number;
  browserSessionSeconds?: number;
  /** When the provider bills a total directly. */
  providerReportedCostUsd?: number;
};

export type ComputedUsageCost = {
  costUsd: number;
  costSource: CostSource;
  pricingSnapshotId: string;
  snapshot: BrainPricingSnapshot | null;
  usedFallbackRates: boolean;
};

const EMPTY_TELEMETRY_FLOOR_USD = 0.0001;

function hasAnyUnits(usage: RawBrainUsageUnits): boolean {
  return (
    (usage.inputTokens ?? 0) > 0 ||
    (usage.cachedInputTokens ?? 0) > 0 ||
    (usage.outputTokens ?? 0) > 0 ||
    (usage.imageCount ?? 0) > 0 ||
    (usage.videoCount ?? 0) > 0 ||
    (usage.ttsUtf8Bytes ?? 0) > 0 ||
    (usage.searchRequests ?? 0) > 0 ||
    (usage.browserSessionSeconds ?? 0) > 0
  );
}

/**
 * Deterministic USD resolution for Brain metering (Part 4 algorithm).
 * 1. providerReportedCostUsd → provider_usage
 * 2. any units → snapshot / fallback rates → token_rates
 * 3. empty telemetry + provider called → $0.0001 floor → estimated
 */
export function computeUsageCost(input: {
  routeId: string;
  usage: RawBrainUsageUnits;
  /** When true and units are empty, apply empty-telemetry floor. */
  providerCalled?: boolean;
  liveSnapshot?: BrainPricingSnapshot | null;
}): ComputedUsageCost {
  const { usage } = input;
  const route = getBrainRoute(input.routeId);
  const snapshot = input.liveSnapshot ?? getLiveSeedSnapshot(input.routeId);

  if (usage.providerReportedCostUsd != null && usage.providerReportedCostUsd > 0) {
    return {
      costUsd: usage.providerReportedCostUsd,
      costSource: "provider_usage",
      pricingSnapshotId: snapshot?.id ?? missingPricingSnapshotId(),
      snapshot,
      usedFallbackRates: !snapshot,
    };
  }

  if (hasAnyUnits(usage)) {
    if (snapshot) {
      return {
        costUsd: costUsdFromSnapshot(snapshot, usage),
        costSource: "token_rates",
        pricingSnapshotId: snapshot.id,
        snapshot,
        usedFallbackRates: false,
      };
    }

    // Missing snapshot: charge via resolveTokenRates fallback; never drop the charge.
    const modelId = route?.model ?? "";
    const rates = resolveTokenRates(modelId, { providerRoute: route?.providerRoute });
    const totalInput = Math.max(0, usage.inputTokens ?? 0);
    const cached = Math.min(Math.max(0, usage.cachedInputTokens ?? 0), totalInput);
    const uncached = Math.max(0, totalInput - cached);
    const output = Math.max(0, usage.outputTokens ?? 0);
    let costUsd =
      (uncached / 1_000_000) * rates.inputPerMillion +
      (cached / 1_000_000) * rates.cachedInputPerMillion +
      (output / 1_000_000) * rates.outputPerMillion;
    // Media without snapshot: leave at 0 unless provider reported (handled above).
    if (costUsd <= 0 && ((usage.imageCount ?? 0) > 0 || (usage.videoCount ?? 0) > 0)) {
      costUsd = EMPTY_TELEMETRY_FLOOR_USD;
    }
    return {
      costUsd,
      costSource: "estimated",
      pricingSnapshotId: missingPricingSnapshotId(),
      snapshot: null,
      usedFallbackRates: true,
    };
  }

  if (input.providerCalled !== false) {
    return {
      costUsd: EMPTY_TELEMETRY_FLOOR_USD,
      costSource: "estimated",
      pricingSnapshotId: snapshot?.id ?? missingPricingSnapshotId(),
      snapshot,
      usedFallbackRates: !snapshot,
    };
  }

  return {
    costUsd: 0,
    costSource: "estimated",
    pricingSnapshotId: snapshot?.id ?? missingPricingSnapshotId(),
    snapshot,
    usedFallbackRates: !snapshot,
  };
}
