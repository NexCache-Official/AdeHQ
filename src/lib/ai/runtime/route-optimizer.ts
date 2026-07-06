import { DEFAULT_EMBEDDING_MODEL } from "@/lib/config/features";
import type { RoutingPreference } from "@/lib/ai/intelligence-policy";
import { estimateCost } from "@/lib/ai/model-catalog";
import { staticCatalogOffers } from "./catalog/loader";
import { resolveEndpointKey } from "./pricing/endpoint-key";
import type { EmbeddingProfile, ModelEndpointOffer } from "./pricing/types";
import { getRouteHealth, healthPenaltyScore, type RouteHealthSnapshot } from "./route-health";
import type { AiCapability, ProviderRoute, RuntimeMode, RuntimeProviderPref } from "./types";

export type OptimizerInput = {
  capability: AiCapability;
  runtimeMode: RuntimeMode;
  routingPreference: RoutingPreference;
  providerPreference: RuntimeProviderPref;
  requiredContextTokens?: number;
  requiresJson?: boolean;
  requiresTools?: boolean;
  requiresEmbedding?: boolean;
  riskLevel?: "low" | "medium" | "high";
  currentRoute?: {
    providerRoute: ProviderRoute;
    modelId: string;
    gatewayProviderSlug?: string;
    endpointKey?: string;
  };
  promptTokenEstimate?: number;
  maxOutputTokens?: number;
  embeddingProfile?: EmbeddingProfile;
};

export type ScoredOffer = {
  offer: ModelEndpointOffer;
  score: number;
  estimatedCostUsd: number;
  costRank: number;
  qualityRank: number;
  latencyRank: number;
  reliabilityRank: number;
  healthPenalty: number;
  stalePricePenalty: number;
  unverifiedPenalty: number;
  health?: RouteHealthSnapshot;
  priceFresh: boolean;
};

export type RouteOptimizerDecision = {
  selected: ModelEndpointOffer;
  fallbackCandidates: ModelEndpointOffer[];
  reason: string;
  estimatedCostUsd: number;
  estimatedWorkMinutes?: number;
  decisionFactors: {
    costRank: number;
    qualityRank: number;
    latencyRank: number;
    reliabilityRank: number;
    healthPenalty: number;
    stalePricePenalty: number;
    antiFlapApplied: boolean;
  };
  priceSource: string;
  priceFreshness: "fresh" | "stale" | "missing";
  healthNote?: string;
  usedStaticFallback: boolean;
};

const BLACKBOX_MAX_CONTEXT = 128_000;

export function readPriceMaxAgeHours(): number {
  const raw = Number(process.env.AI_MODEL_PRICE_MAX_AGE_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : 72;
}

export function readMinSavingsToSwitch(): number {
  const raw = Number(process.env.AI_ROUTE_OPTIMIZER_MIN_SAVINGS_TO_SWITCH);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0.15;
}

export function isMockFallbackAllowed(): boolean {
  if (process.env.AI_RUNTIME_V2_PROVIDER_PREF?.trim().toLowerCase() === "mock") return true;
  if (process.env.AI_RUNTIME_ALLOW_MOCK_FALLBACK?.trim().toLowerCase() === "true") return true;
  if (process.env.NODE_ENV === "test") return true;
  return false;
}

function isPriceFresh(offer: ModelEndpointOffer): boolean {
  if (!offer.priceFetchedAt) {
    return offer.source === "manual_override" || offer.source === "vercel_api" || offer.source === "siliconflow_api";
  }
  const ageMs = Date.now() - new Date(offer.priceFetchedAt).getTime();
  return ageMs <= readPriceMaxAgeHours() * 3_600_000;
}

function priceFreshness(offer: ModelEndpointOffer): RouteOptimizerDecision["priceFreshness"] {
  if (offer.inputCostPerMillion == null || offer.outputCostPerMillion == null) return "missing";
  return isPriceFresh(offer) ? "fresh" : "stale";
}

function stalePricePenalty(offer: ModelEndpointOffer, hasFresherEndpointRows: boolean): number {
  const freshness = priceFreshness(offer);
  let penalty = 0;
  if (freshness === "stale") penalty += 0.12;
  if (freshness === "missing") penalty += 0.2;
  if (offer.source === "manual_seed" && hasFresherEndpointRows) penalty += 0.15;
  return penalty;
}

function unverifiedCapabilityPenalty(offer: ModelEndpointOffer, requiresJson: boolean): number {
  if (!requiresJson) return 0;
  if (offer.supportsJsonVerifiedAt) return 0;
  return 0.08;
}

/** Cost estimate uses input + output only — never assumes cache pricing. */
export function estimateOfferCost(offer: ModelEndpointOffer, input: number, output: number): number {
  if (offer.inputCostPerMillion != null && offer.outputCostPerMillion != null) {
    return (
      (input / 1_000_000) * offer.inputCostPerMillion +
      (output / 1_000_000) * offer.outputCostPerMillion
    );
  }
  return estimateCost(offer.modelId, input, output);
}

function hasFresherEndpointRows(offers: ModelEndpointOffer[]): boolean {
  return offers.some(
    (o) =>
      o.source === "manual_override" ||
      o.source === "vercel_api" ||
      o.source === "siliconflow_api",
  );
}

function passesContextEligibility(offer: ModelEndpointOffer, input: OptimizerInput): boolean {
  const required = input.requiredContextTokens;
  const maxOut = input.maxOutputTokens ?? 800;

  if (required != null && required > 0) {
    if (offer.contextWindow == null) return false;
    if (offer.contextWindow < required + maxOut) return false;
  }

  if (input.capability === "long_context" || input.runtimeMode === "long_context") {
    if (offer.gatewayProviderSlug === "blackbox" && required != null && required > BLACKBOX_MAX_CONTEXT) {
      return false;
    }
    if (!offer.supportsLongContext && (offer.contextWindow ?? 0) < 128_000) return false;
  }

  return true;
}

function passesEmbeddingLock(offer: ModelEndpointOffer, input: OptimizerInput): boolean {
  if (input.capability !== "embedding" && !input.requiresEmbedding) return true;

  const profile = input.embeddingProfile ?? "pinned_bge";
  if (profile === "allow_gateway") return true;

  return offer.modelId === DEFAULT_EMBEDDING_MODEL;
}

export function listCandidateOffers(
  offers: ModelEndpointOffer[],
  input: OptimizerInput,
): ModelEndpointOffer[] {
  const allowMock = isMockFallbackAllowed();
  const fresherRows = hasFresherEndpointRows(offers);

  return offers.filter((offer) => {
    if (!offer.enabled) return false;
    if (offer.providerRoute === "mock" && !allowMock) return false;

    if (input.providerPreference === "siliconflow" && offer.providerRoute !== "siliconflow_direct") {
      return false;
    }
    if (input.providerPreference === "vercel" && offer.providerRoute !== "vercel_gateway") {
      return false;
    }
    if (input.providerPreference === "mock" && offer.providerRoute !== "mock") return false;

    if (!passesEmbeddingLock(offer, input)) return false;

    if (!offer.capabilities.includes(input.capability)) return false;
    if (!offer.runtimeModes.includes(input.runtimeMode)) return false;

    if (!passesContextEligibility(offer, input)) return false;

    if (input.requiresJson && !offer.supportsJson) return false;
    if (input.requiresTools && !offer.supportsTools) return false;
    if (input.requiresEmbedding && !offer.supportsEmbeddings) return false;

    if (input.riskLevel === "high") {
      const quality = offer.qualityScore ?? 0;
      if (quality < 8) return false;
    }

    // Deprioritize stale manual_seed when fresher endpoint rows exist (filter only if alternatives exist)
    if (offer.source === "manual_seed" && fresherRows) {
      const sameFamily = offers.some(
        (o) =>
          o.normalizedModelFamily === offer.normalizedModelFamily &&
          o.endpointKey !== offer.endpointKey &&
          (o.source === "manual_override" || o.source === "vercel_api" || o.source === "siliconflow_api"),
      );
      if (sameFamily) return false;
    }

    return true;
  });
}

function rankValues<T>(items: T[], valueFn: (item: T) => number, higherIsBetter = false): Map<T, number> {
  const sorted = [...items].sort((a, b) => {
    const diff = valueFn(a) - valueFn(b);
    return higherIsBetter ? -diff : diff;
  });
  return new Map(sorted.map((item, index) => [item, index + 1]));
}

export function scoreModelOffer(
  offer: ModelEndpointOffer,
  input: OptimizerInput,
  ranks: {
    costRank: number;
    qualityRank: number;
    latencyRank: number;
    reliabilityRank: number;
  },
  allOffers: ModelEndpointOffer[],
): ScoredOffer {
  const inputTokens = input.promptTokenEstimate ?? 256;
  const outputTokens = input.maxOutputTokens ?? 800;
  const estimatedCostUsd = estimateOfferCost(offer, inputTokens, outputTokens);
  const health = getRouteHealth(resolveEndpointKey(offer));
  const hPenalty = healthPenaltyScore(health, input.requiresJson);
  const sPenalty = stalePricePenalty(offer, hasFresherEndpointRows(allOffers));
  const uPenalty = unverifiedCapabilityPenalty(offer, input.requiresJson ?? false);

  const costNorm = 1 / Math.max(ranks.costRank, 1);
  const qualityNorm = 1 / Math.max(ranks.qualityRank, 1);
  const latencyNorm = offer.latencyP95Ms
    ? 1 / Math.max(ranks.latencyRank, 1)
    : 0.5 / Math.max(ranks.latencyRank, 1);
  const reliabilityNorm = 1 / Math.max(ranks.reliabilityRank, 1);

  let score =
    0.3 * costNorm +
    0.25 * qualityNorm +
    0.2 * reliabilityNorm +
    0.15 * latencyNorm -
    hPenalty -
    sPenalty -
    uPenalty;

  if (input.routingPreference === "cost_saver") {
    score = -estimatedCostUsd - hPenalty * 0.5 - sPenalty;
  } else if (input.routingPreference === "quality_first") {
    score = (offer.qualityScore ?? 5) - estimatedCostUsd * 0.001 - hPenalty;
  } else if (input.routingPreference === "fastest") {
    score = -(offer.latencyP95Ms ?? offer.latencyP50Ms ?? 5000) - hPenalty * 100;
  }

  return {
    offer,
    score,
    estimatedCostUsd,
    costRank: ranks.costRank,
    qualityRank: ranks.qualityRank,
    latencyRank: ranks.latencyRank,
    reliabilityRank: ranks.reliabilityRank,
    healthPenalty: hPenalty,
    stalePricePenalty: sPenalty,
    unverifiedPenalty: uPenalty,
    health,
    priceFresh: isPriceFresh(offer),
  };
}

function scoreAllOffers(candidates: ModelEndpointOffer[], input: OptimizerInput, allOffers: ModelEndpointOffer[]): ScoredOffer[] {
  const inputTokens = input.promptTokenEstimate ?? 256;
  const outputTokens = input.maxOutputTokens ?? 800;

  const costRank = rankValues(candidates, (o) => estimateOfferCost(o, inputTokens, outputTokens));
  const qualityRank = rankValues(candidates, (o) => o.qualityScore ?? 5, true);
  const latencyRank = rankValues(
    candidates,
    (o) => o.latencyP95Ms ?? o.latencyP50Ms ?? 50_000,
  );
  const reliabilityRank = rankValues(candidates, (o) => o.reliabilityScore ?? 5, true);

  return candidates.map((offer) =>
    scoreModelOffer(offer, input, {
      costRank: costRank.get(offer) ?? candidates.length,
      qualityRank: qualityRank.get(offer) ?? candidates.length,
      latencyRank: latencyRank.get(offer) ?? candidates.length,
      reliabilityRank: reliabilityRank.get(offer) ?? candidates.length,
    }, allOffers),
  );
}

function routesMatch(
  a: { endpointKey?: string; providerRoute: ProviderRoute; modelId: string; gatewayProviderSlug?: string },
  b: ModelEndpointOffer,
): boolean {
  if (a.endpointKey && b.endpointKey) return a.endpointKey === b.endpointKey;
  return (
    a.providerRoute === b.providerRoute &&
    a.modelId === b.modelId &&
    (a.gatewayProviderSlug ?? "default") === (b.gatewayProviderSlug ?? "default")
  );
}

function applyAntiFlapping(
  scored: ScoredOffer[],
  input: OptimizerInput,
): { selected: ScoredOffer; antiFlapApplied: boolean } {
  if (!input.currentRoute || scored.length === 0) {
    const best = [...scored].sort((a, b) => b.score - a.score)[0]!;
    return { selected: best, antiFlapApplied: false };
  }

  const current = scored.find((s) => routesMatch(input.currentRoute!, s.offer));
  const best = [...scored].sort((a, b) => b.score - a.score)[0]!;

  if (!current) return { selected: best, antiFlapApplied: false };
  if (routesMatch(input.currentRoute!, best.offer)) {
    return { selected: best, antiFlapApplied: false };
  }

  const minSavings = readMinSavingsToSwitch();
  const savings =
    current.estimatedCostUsd > 0
      ? (current.estimatedCostUsd - best.estimatedCostUsd) / current.estimatedCostUsd
      : 0;

  const qualityGain = (best.offer.qualityScore ?? 0) - (current.offer.qualityScore ?? 0);
  const latencyGain =
    (current.offer.latencyP95Ms ?? 99999) - (best.offer.latencyP95Ms ?? 99999);

  if (input.routingPreference === "fastest" && latencyGain > 200) {
    return { selected: best, antiFlapApplied: false };
  }

  if (qualityGain >= 1.5) {
    return { selected: best, antiFlapApplied: false };
  }

  if (savings >= minSavings) {
    return { selected: best, antiFlapApplied: false };
  }

  return { selected: current, antiFlapApplied: true };
}

function buildReason(selected: ScoredOffer, input: OptimizerInput, antiFlap: boolean): string {
  const parts: string[] = [];
  if (antiFlap) parts.push("kept current route (anti-flapping)");
  else if (input.routingPreference === "cost_saver") parts.push("cheapest capable endpoint");
  else if (input.routingPreference === "quality_first") parts.push("highest quality capable endpoint");
  else if (input.routingPreference === "fastest") parts.push("fastest capable endpoint");
  else parts.push("balanced weighted score");

  if (selected.offer.endpointKey) parts.push(`endpoint ${selected.offer.endpointKey}`);
  if (input.requiresJson) parts.push("JSON support required");
  if (selected.healthPenalty > 0.1) parts.push("health penalty applied to alternatives");
  if (selected.stalePricePenalty > 0) parts.push("stale pricing penalized on some candidates");

  return parts.join("; ");
}

function allPricingStaleOrMissing(candidates: ModelEndpointOffer[]): boolean {
  if (!candidates.length) return true;
  return candidates.every((o) => priceFreshness(o) !== "fresh");
}

export function selectBestModelOffer(
  input: OptimizerInput,
  offers: ModelEndpointOffer[],
): RouteOptimizerDecision | null {
  let pool = offers;
  let usedStaticFallback = false;

  let candidates = listCandidateOffers(pool, input);
  if (!candidates.length) return null;

  if (allPricingStaleOrMissing(candidates)) {
    pool = staticCatalogOffers();
    candidates = listCandidateOffers(pool, input);
    usedStaticFallback = true;
    if (!candidates.length) return null;
  }

  const sorted = scoreAllOffers(candidates, input, pool).sort((a, b) => b.score - a.score);
  const { selected, antiFlapApplied } = applyAntiFlapping(sorted, input);

  const fallbacks = sorted
    .filter((s) => s.offer.endpointKey !== selected.offer.endpointKey)
    .map((s) => s.offer)
    .filter((o) => o.providerRoute !== "mock" || isMockFallbackAllowed())
    .slice(0, 5);

  const healthNote =
    selected.health && selected.health.totalSamples >= readHealthMinSamples()
      ? `${(selected.health.successRate * 100).toFixed(1)}% success, ${(selected.health.fallbackRate * 100).toFixed(1)}% fallback` +
        (selected.health.p95LatencyMs ? `, p95 ${selected.health.p95LatencyMs}ms` : "") +
        ` (${selected.health.totalSamples} samples)`
      : undefined;

  return {
    selected: selected.offer,
    fallbackCandidates: fallbacks,
    reason: buildReason(selected, input, antiFlapApplied),
    estimatedCostUsd: selected.estimatedCostUsd,
    decisionFactors: {
      costRank: selected.costRank,
      qualityRank: selected.qualityRank,
      latencyRank: selected.latencyRank,
      reliabilityRank: selected.reliabilityRank,
      healthPenalty: selected.healthPenalty,
      stalePricePenalty: selected.stalePricePenalty,
      antiFlapApplied,
    },
    priceSource: selected.offer.source,
    priceFreshness: priceFreshness(selected.offer),
    healthNote,
    usedStaticFallback,
  };
}

function readHealthMinSamples(): number {
  const raw = Number(process.env.AI_ROUTE_HEALTH_MIN_SAMPLES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 10;
}
