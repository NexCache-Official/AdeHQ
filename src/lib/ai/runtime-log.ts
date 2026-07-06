import { staticCatalogOffers, resolveCatalogOfferForRoute, catalogPriceFreshness } from "@/lib/ai/runtime/catalog/loader";
import { buildCatalogMatchPreview } from "@/lib/ai/runtime/catalog/preview-match";
import { routeCapability } from "@/lib/ai/runtime/capability-router";
import { getRuntimeFlags } from "@/lib/ai/runtime/flags";
import { readPriceMaxAgeHours } from "@/lib/ai/runtime/route-optimizer";
import type { ModelEndpointOffer } from "@/lib/ai/runtime/pricing/types";
import type { AiCapability } from "@/lib/ai/runtime/types";
import {
  DEFAULT_PROVIDER,
  DEFAULT_SILICONFLOW_MODEL,
  isSiliconFlowConfigured,
} from "@/lib/config/features";
import { isVercelGatewayConfigured } from "@/lib/ai/runtime/adapters/vercel-models";

export type AiRuntimeLogEntry = {
  id: string;
  at: string;
  workspaceId?: string;
  roomId?: string;
  employeeId?: string;
  provider: string;
  model: string;
  modelMode?: string;
  mode: "live" | "fallback" | "mock" | "blocked";
  fallbackReason?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
  agentRunId?: string;
  fallbackTier?: number;
};

const MAX_ENTRIES = 40;
const entries: AiRuntimeLogEntry[] = [];
let lastEntry: AiRuntimeLogEntry | null = null;

function uid() {
  return `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function recordAiRuntime(entry: Omit<AiRuntimeLogEntry, "id" | "at">) {
  const row: AiRuntimeLogEntry = {
    id: uid(),
    at: new Date().toISOString(),
    ...entry,
  };
  entries.unshift(row);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  lastEntry = row;

  console.info("[AdeHQ AI runtime]", {
    provider: row.provider,
    model: row.model,
    modelMode: row.modelMode,
    mode: row.mode,
    workspaceId: row.workspaceId,
    roomId: row.roomId,
    employeeId: row.employeeId,
    agentRunId: row.agentRunId,
    fallbackReason: row.fallbackReason,
    error: row.error,
    durationMs: row.durationMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedTokens: row.cachedTokens,
    estimatedCostUsd: row.estimatedCostUsd,
    fallbackTier: row.fallbackTier,
  });
}

function buildRoutingPreview() {
  const flags = getRuntimeFlags();
  const capabilities: AiCapability[] = [
    "structured_chat",
    "summarization",
    "embedding",
    "classification",
  ];

  return capabilities.map((capability) => {
    const route = routeCapability({ capability, catalogOffers: staticCatalogOffers() }, flags.providerPref);
    return {
      capability,
      providerRoute: route.providerRoute,
      modelId: route.modelId,
      runtimeMode: route.runtimeMode,
      estimatedWorkMinutes: route.estimatedWorkMinutes,
      estimatedCostUsd: route.estimatedCostUsd,
      fallbackCandidates: route.fallbackCandidates.map(
        (candidate) => `${candidate.providerRoute}/${candidate.modelId}`,
      ),
      routeOptimizer: route.routeOptimizer,
    };
  });
}

export type OptimizerPreviewSnapshot = {
  selected: string;
  reason: string;
  estimatedCostUsd: number;
  fallbacks: Array<{ providerRoute: string; modelId: string; gatewayProviderSlug?: string; endpointKey?: string }>;
  priceSource: string;
  priceFreshness: string;
  healthNote?: string;
  shadowOnly?: boolean;
  optimizerWouldChoose?: string;
  optimizerReason?: string;
  optimizerEstimatedCostUsd?: number;
  catalogMatch?: {
    found: boolean;
    endpointKey?: string;
    inputCostPerMillion?: number;
    outputCostPerMillion?: number;
    source?: string;
    verifiedAt?: string;
    priceFetchedAt?: string | null;
    ambiguousEndpointCount?: number;
  };
  optimizerCatalogMatch?: OptimizerPreviewSnapshot["catalogMatch"];
  decisionFactors?: {
    costRank: number;
    qualityRank: number;
    latencyRank: number;
    reliabilityRank: number;
    healthPenalty: number;
    stalePricePenalty: number;
    antiFlapApplied: boolean;
  };
};

function formatRouteLabel(
  providerRoute: string,
  modelId: string,
  gatewayProviderSlug?: string,
): string {
  const slug = gatewayProviderSlug && gatewayProviderSlug !== "default" ? ` (${gatewayProviderSlug})` : "";
  return `${providerRoute} / ${modelId}${slug}`;
}

function enrichStaticPreview(
  route: ReturnType<typeof routeCapability>,
  offers: ModelEndpointOffer[],
  maxAgeHours: number,
): Pick<
  OptimizerPreviewSnapshot,
  "reason" | "priceSource" | "priceFreshness" | "catalogMatch"
> {
  const { offer, ambiguousCount } = resolveCatalogOfferForRoute(offers, {
    providerRoute: route.providerRoute,
    modelId: route.modelId,
    gatewayProviderSlug: route.gatewayProviderSlug,
    endpointKey: route.endpointKey,
  });

  const catalogMatch = buildCatalogMatchPreview(offers, {
    providerRoute: route.providerRoute,
    modelId: route.modelId,
    gatewayProviderSlug: route.gatewayProviderSlug,
    endpointKey: route.endpointKey,
  });

  if (!offer || !catalogMatch.found) {
    return {
      reason: "static route (optimizer off); no catalog match",
      priceSource: "manual_seed",
      priceFreshness: "missing",
      catalogMatch: { found: false },
    };
  }

  return {
    reason:
      ambiguousCount > 1
        ? `static route (optimizer off); catalog price matched (${ambiguousCount} endpoints, showing primary)`
        : "static route (optimizer off); catalog price matched",
    priceSource: offer.source,
    priceFreshness: catalogPriceFreshness(offer, maxAgeHours),
    catalogMatch,
  };
}

export function buildOptimizerPreview(
  params?: {
    capability?: AiCapability;
    runtimeMode?: string;
    routingPreference?: "auto" | "cost_saver" | "quality_first" | "fastest";
  },
  catalogOffers?: ModelEndpointOffer[],
): OptimizerPreviewSnapshot {
  const capability = params?.capability ?? "structured_chat";
  const offers = catalogOffers?.length ? catalogOffers : staticCatalogOffers();
  const maxAgeHours = readPriceMaxAgeHours();
  const route = routeCapability(
    {
      capability,
      runtimeMode: (params?.runtimeMode as "balanced") ?? "balanced",
      routingPreference: params?.routingPreference ?? "auto",
      catalogOffers: offers,
    },
    getRuntimeFlags().providerPref,
  );

  const opt = route.routeOptimizer;
  const base = {
    selected: formatRouteLabel(route.providerRoute, route.modelId, route.gatewayProviderSlug),
    estimatedCostUsd: route.estimatedCostUsd,
    fallbacks: (opt?.fallbackCandidates ?? route.fallbackCandidates) as OptimizerPreviewSnapshot["fallbacks"],
    decisionFactors: opt?.decisionFactors,
    healthNote: opt?.healthNote,
    shadowOnly: opt?.shadowOnly ?? false,
  };

  if (opt?.shadowOnly) {
    const staticEnriched = enrichStaticPreview(route, offers, maxAgeHours);
    const optimizerCatalogMatch = buildCatalogMatchPreview(offers, {
      providerRoute: opt.selectedProviderRoute,
      modelId: opt.selectedModelId,
      gatewayProviderSlug: opt.selectedGatewayProviderSlug,
      endpointKey: opt.selectedEndpointKey,
    });
    return {
      ...base,
      reason: "static route (optimizer shadow)",
      priceSource: staticEnriched.priceSource,
      priceFreshness: staticEnriched.priceFreshness,
      catalogMatch: staticEnriched.catalogMatch,
      optimizerWouldChoose: formatRouteLabel(
        opt.selectedProviderRoute,
        opt.selectedModelId,
        opt.selectedGatewayProviderSlug,
      ),
      optimizerReason: opt.reason,
      optimizerEstimatedCostUsd: opt.estimatedCostUsd,
      optimizerCatalogMatch,
    };
  }

  if (opt && !opt.shadowOnly) {
    return {
      ...base,
      selected: formatRouteLabel(
        opt.selectedProviderRoute,
        opt.selectedModelId,
        opt.selectedGatewayProviderSlug,
      ),
      reason: opt.reason,
      estimatedCostUsd: opt.estimatedCostUsd,
      priceSource: opt.priceSource,
      priceFreshness: opt.priceFreshness,
      catalogMatch: buildCatalogMatchPreview(offers, {
        providerRoute: opt.selectedProviderRoute,
        modelId: opt.selectedModelId,
        gatewayProviderSlug: opt.selectedGatewayProviderSlug,
        endpointKey: opt.selectedEndpointKey,
      }),
    };
  }

  const staticEnriched = enrichStaticPreview(route, offers, maxAgeHours);
  return {
    ...base,
    reason: staticEnriched.reason,
    priceSource: staticEnriched.priceSource,
    priceFreshness: staticEnriched.priceFreshness,
    catalogMatch: staticEnriched.catalogMatch,
  };
}

export function getAiRuntimeSnapshot(catalogOffers?: ModelEndpointOffer[]) {
  const flags = getRuntimeFlags();
  const catalogOffersResolved = catalogOffers?.length ? catalogOffers : staticCatalogOffers();

  return {
    siliconflowConfigured: isSiliconFlowConfigured(),
    gatewayAvailable: isVercelGatewayConfigured(),
    defaultProvider: DEFAULT_PROVIDER,
    defaultSiliconflowModel: DEFAULT_SILICONFLOW_MODEL,
    environment: process.env.NODE_ENV ?? "development",
    demoModeEnabled: process.env.NEXT_PUBLIC_ENABLE_DEMO_MODE === "true",
    runtimeV2Mode: flags.mode,
    providerPref: flags.providerPref,
    routeOptimizerMode: flags.routeOptimizer,
    employeeDirectExecution: flags.employeeDirectExecution,
    employeeQueuedExecution: flags.employeeQueuedExecution,
    priceMaxAgeHours: readPriceMaxAgeHours(),
    routingPreview: buildRoutingPreview(),
    optimizerPreview: buildOptimizerPreview(undefined, catalogOffersResolved),
    catalogSummary: {
      offerCount: catalogOffersResolved.length,
      enabledCount: catalogOffersResolved.filter((o) => o.enabled).length,
    },
    last: lastEntry,
    recent: entries.slice(0, 12),
  };
}
