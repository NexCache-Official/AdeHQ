import { routeCapability } from "@/lib/ai/runtime/capability-router";
import type {
  CapabilityRouteDecision,
  CapabilityRouteInput,
  RuntimeProviderPref,
} from "@/lib/ai/runtime/types";
import {
  getLiveSeedSnapshot,
  resolveRouteIdForModel,
  resolveRoutingPolicy,
  type BrainIntensity,
} from "@/lib/brain/catalog";
import { costUsdFromSnapshot } from "@/lib/brain/catalog/pricing-snapshots";
import { filterEligibleRoutes, type EligibilityRejection } from "./eligibility";
import { isEscalationFailure, type BrainFailureReason } from "./failure-taxonomy";

export type RouteCapabilityV2Input = CapabilityRouteInput & {
  intensity?: BrainIntensity;
  routeAffinityKey?: string | null;
  lastAcceptedRouteId?: string | null;
  attemptReason?: "initial" | BrainFailureReason;
  maxCostUsd?: number;
};

export type RouteCapabilityV2Decision = CapabilityRouteDecision & {
  brainRouteId: string;
  eligibilityRejections: EligibilityRejection[];
  estimatedMinCostUsd: number;
  estimatedLikelyCostUsd: number;
  estimatedMaxCostUsd: number;
  stickinessApplied: boolean;
};

function intensityTokenEstimate(intensity: BrainIntensity): {
  minIn: number;
  likelyIn: number;
  maxIn: number;
  minOut: number;
  likelyOut: number;
  maxOut: number;
} {
  switch (intensity) {
    case "fast":
      return { minIn: 400, likelyIn: 900, maxIn: 2000, minOut: 80, likelyOut: 250, maxOut: 600 };
    case "deep":
      return { minIn: 2000, likelyIn: 6000, maxIn: 20000, minOut: 400, likelyOut: 1500, maxOut: 4000 };
    case "research":
      return { minIn: 4000, likelyIn: 12000, maxIn: 40000, minOut: 800, likelyOut: 3000, maxOut: 8000 };
    case "standard":
    default:
      return { minIn: 800, likelyIn: 2500, maxIn: 8000, minOut: 200, likelyOut: 700, maxOut: 2000 };
  }
}

function estimateRangeForRoute(
  routeId: string,
  intensity: BrainIntensity,
): { min: number; likely: number; max: number } {
  const snap = getLiveSeedSnapshot(routeId);
  const tok = intensityTokenEstimate(intensity);
  if (!snap) {
    return { min: 0.001, likely: 0.01, max: 0.05 };
  }
  return {
    min: costUsdFromSnapshot(snap, { inputTokens: tok.minIn, outputTokens: tok.minOut }),
    likely: costUsdFromSnapshot(snap, { inputTokens: tok.likelyIn, outputTokens: tok.likelyOut }),
    max: costUsdFromSnapshot(snap, { inputTokens: tok.maxIn, outputTokens: tok.maxOut }),
  };
}

/**
 * Eligibility filter → existing scoring core → stickiness.
 * Does not rewrite routeCapability; wraps it.
 */
export function routeCapabilityV2(
  input: RouteCapabilityV2Input,
  providerPref: RuntimeProviderPref = "auto",
): RouteCapabilityV2Decision {
  const intensity = input.intensity ?? "standard";
  const eligibility = filterEligibleRoutes({
    capability: input.capability,
    maxCostUsd: input.maxCostUsd,
  });

  const base = routeCapability(input, providerPref);

  let brainRouteId =
    resolveRouteIdForModel({
      modelId: base.modelId,
      providerRoute: base.providerRoute,
      capability: input.capability,
    }) ??
    resolveRoutingPolicy(input.capability, intensity)?.primaryRouteId ??
    "route_text_v4flash_sf";

  let stickinessApplied = false;
  const isEscalation =
    input.attemptReason != null &&
    input.attemptReason !== "initial" &&
    isEscalationFailure(input.attemptReason);

  if (
    input.lastAcceptedRouteId &&
    input.routeAffinityKey &&
    !isEscalation &&
    eligibility.survivors.some((r) => r.id === input.lastAcceptedRouteId)
  ) {
    brainRouteId = input.lastAcceptedRouteId;
    stickinessApplied = true;
  }

  // If scored model was filtered out, fall back to first survivor / policy primary.
  if (
    eligibility.survivors.length > 0 &&
    !eligibility.survivors.some((r) => r.id === brainRouteId)
  ) {
    const policy = resolveRoutingPolicy(input.capability, intensity);
    brainRouteId =
      policy?.primaryRouteId ??
      eligibility.survivors[0]!.id;
  }

  const range = estimateRangeForRoute(brainRouteId, intensity);

  return {
    ...base,
    brainRouteId,
    eligibilityRejections: eligibility.rejections,
    estimatedMinCostUsd: range.min,
    estimatedLikelyCostUsd: range.likely,
    estimatedMaxCostUsd: range.max,
    estimatedCostUsd: range.likely,
    stickinessApplied,
  };
}
