import {
  estimateCost,
  normalizeModelMode,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import {
  isVercelGatewayConfigured,
  resolveVercelGatewayModelId,
} from "./adapters/vercel-models";
import { resolveSiliconFlowRuntimeModel } from "./adapters/siliconflow";
import { staticCatalogOffers } from "./catalog/loader";
import { getRuntimeFlags, isRouteOptimizerOn, isRouteOptimizerShadow } from "./flags";
import type { ModelEndpointOffer } from "./pricing/types";
import {
  buildPinnedFallbackCandidates,
  pinnedPolicyKeyForCapability,
  resolvePinnedPolicyRouteByKey,
} from "./provider-policy";
import { isMockFallbackAllowed, selectBestModelOffer } from "./route-optimizer";
import { buildTaskRoutingBrief } from "./task-routing-brief";
import { estimateWorkMinutesFromCost } from "../work-hours/estimate";
import { getWorkMinuteUsdRate } from "../work-hours/constants";
import type {
  AiCapability,
  CapabilityRouteDecision,
  CapabilityRouteInput,
  ProviderRoute,
  ReasoningProfile,
  RuntimeMode,
  RuntimeProviderPref,
} from "./types";

const WORK_MINUTE_USD = getWorkMinuteUsdRate();

function estimateWorkMinutes(costUsd: number): number {
  const minutes = estimateWorkMinutesFromCost(costUsd);
  if (minutes > 0) return Math.max(1, Math.ceil(minutes));
  if (!Number.isFinite(WORK_MINUTE_USD) || WORK_MINUTE_USD <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(costUsd / WORK_MINUTE_USD));
}

function capabilityDefaultRuntimeMode(capability: AiCapability): RuntimeMode {
  switch (capability) {
    case "quick_reply":
    case "classification":
    case "memory_curation":
      return "efficient";
    case "summarization":
    case "structured_chat":
    case "artifact_generation":
      return "balanced";
    case "deep_reasoning":
    case "research_planning":
    case "browser_research":
      return "research";
    case "long_context":
      return "long_context";
    case "coding":
      return "coding";
    case "embedding":
      return "embedding";
    default:
      return "balanced";
  }
}

function runtimeModeToModelMode(runtimeMode: RuntimeMode, explicit?: ModelMode): ModelMode {
  if (explicit) return normalizeModelMode(explicit);
  switch (runtimeMode) {
    case "efficient":
      return "cheap";
    case "strong":
    case "research":
      return "strong";
    case "long_context":
      return "long_context";
    case "coding":
      return "coding";
    default:
      return "balanced";
  }
}

function reasoningForCapability(capability: AiCapability): ReasoningProfile {
  switch (capability) {
    case "deep_reasoning":
    case "research_planning":
    case "browser_research":
      return "medium";
    case "quick_reply":
    case "classification":
    case "embedding":
      return "none";
    default:
      return "low";
  }
}

function pickProviderRoute(
  pref: RuntimeProviderPref,
  _capability: AiCapability,
): ProviderRoute {
  if (pref === "mock") return "mock";
  if (pref === "vercel") {
    if (isVercelGatewayConfigured()) return "vercel_gateway";
    return isSiliconFlowConfigured() ? "siliconflow_direct" : "mock";
  }
  if (pref === "siliconflow") {
    return isSiliconFlowConfigured() ? "siliconflow_direct" : "mock";
  }

  // auto — SiliconFlow primary; Vercel is fallback-only in V19.9.0e.
  if (isSiliconFlowConfigured()) return "siliconflow_direct";
  if (isVercelGatewayConfigured()) return "vercel_gateway";
  return "mock";
}

function providerNameForRoute(
  providerRoute: ProviderRoute,
  capability?: AiCapability,
  researchProvider?: "mock" | "tavily" | "browserbase",
): string {
  if (capability === "browser_research" && researchProvider === "browserbase") {
    return "browserbase";
  }
  if (capability === "browser_research" && researchProvider === "tavily") {
    return "tavily";
  }
  switch (providerRoute) {
    case "vercel_gateway":
      return "vercel";
    case "siliconflow_direct":
      return "siliconflow";
    case "mock":
    default:
      return researchProvider === "tavily" ? "tavily" : "mock";
  }
}

function readTavilySearchCostUsd(): number {
  const raw = Number(process.env.TAVILY_SEARCH_COST_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.008;
}

function readTavilyMaxResults(): number {
  const raw = Number(process.env.TAVILY_MAX_RESULTS);
  return Number.isFinite(raw) && raw >= 1 && raw <= 20 ? Math.floor(raw) : 5;
}

function isTavilyConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

function readBrowserbaseSessionCostUsd(): number {
  const raw = Number(process.env.BROWSERBASE_SESSION_COST_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.05;
}

function readBrowserResearchMaxPages(): number {
  const raw = Number(process.env.BROWSER_RESEARCH_MAX_PAGES);
  return Number.isFinite(raw) && raw >= 1 && raw <= 10 ? Math.floor(raw) : 3;
}

function estimateBrowserResearchWorkMinutes(
  researchProvider: "mock" | "tavily" | "browserbase",
  costUsd: number,
  resultCount = 0,
): number {
  if (researchProvider === "browserbase") {
    const fromCost = estimateWorkMinutesFromCost(costUsd);
    const total = fromCost + Math.max(0, resultCount) * 2;
    return Math.max(1, Math.round(total * 100) / 100);
  }
  if (researchProvider === "tavily") {
    const fromCost = estimateWorkMinutesFromCost(costUsd);
    const total = fromCost + Math.max(0, resultCount) * 0.25;
    return Math.max(1, Math.round(total * 100) / 100);
  }
  return 15;
}

function routeBrowserResearchCapability(
  input: CapabilityRouteInput,
  providerPref: RuntimeProviderPref = "auto",
): CapabilityRouteDecision {
  const researchProvider = input.researchProvider ?? "mock";
  const runtimeMode = input.runtimeMode ?? capabilityDefaultRuntimeMode("browser_research");
  const reasoningProfile = reasoningForCapability("browser_research");

  if (researchProvider === "browserbase") {
    const maxPages = readBrowserResearchMaxPages();
    const llmRoute = pickProviderRoute(providerPref, "browser_research");
    const llmRuntimeMode: RuntimeMode = "balanced";
    const modelMode = runtimeModeToModelMode(llmRuntimeMode, input.modelMode);
    const modelId =
      llmRoute === "siliconflow_direct"
        ? resolveSiliconFlowRuntimeModel({ runtimeMode: llmRuntimeMode, modelMode })
        : resolveVercelGatewayModelId({
            runtimeMode: llmRuntimeMode,
            capability: "browser_research",
          });
    const promptLen = input.message?.length ?? 256;
    const inputTokens = Math.max(50, Math.ceil(promptLen / 4));
    const outputTokens = 1200;
    const llmCostUsd = estimateCost(modelId, inputTokens, outputTokens);
    const estimatedCostUsd = readBrowserbaseSessionCostUsd() + llmCostUsd * maxPages;

    const fallbackCandidates: CapabilityRouteDecision["fallbackCandidates"] = [];
    if (isTavilyConfigured()) {
      fallbackCandidates.push({
        providerRoute: "mock",
        modelId: "tavily/search-api",
      });
    }
    fallbackCandidates.push({ providerRoute: "mock", modelId: "mock/browser-research" });

    return {
      providerRoute: llmRoute,
      providerName: "browserbase",
      modelId,
      runtimeMode,
      capability: "browser_research",
      reasoningProfile,
      estimatedCostUsd,
      estimatedWorkMinutes: estimateBrowserResearchWorkMinutes(
        "browserbase",
        estimatedCostUsd,
        maxPages,
      ),
      fallbackCandidates,
    };
  }

  const providerRoute: ProviderRoute = "mock";

  if (researchProvider === "tavily") {
    const maxResults = readTavilyMaxResults();
    const estimatedCostUsd = readTavilySearchCostUsd() + maxResults * 0.0005;
    return {
      providerRoute,
      providerName: "tavily",
      modelId: "tavily/search-api",
      runtimeMode,
      capability: "browser_research",
      reasoningProfile,
      estimatedCostUsd,
      estimatedWorkMinutes: estimateBrowserResearchWorkMinutes(
        "tavily",
        estimatedCostUsd,
        maxResults,
      ),
      fallbackCandidates: [{ providerRoute: "mock", modelId: "mock/browser-research" }],
    };
  }

  return {
    providerRoute,
    providerName: "mock",
    modelId: "mock/browser-research",
    runtimeMode,
    capability: "browser_research",
    reasoningProfile,
    estimatedCostUsd: 0,
    estimatedWorkMinutes: 15,
    fallbackCandidates: [],
  };
}

function stripMockFallbacks(
  candidates: CapabilityRouteDecision["fallbackCandidates"],
): CapabilityRouteDecision["fallbackCandidates"] {
  if (isMockFallbackAllowed()) return candidates;
  return candidates.filter((c) => c.providerRoute !== "mock");
}

function mapFallbackCandidate(o: ModelEndpointOffer): CapabilityRouteDecision["fallbackCandidates"][number] {
  return {
    providerRoute: o.providerRoute,
    modelId: o.modelId,
    gatewayProviderSlug: o.gatewayProviderSlug,
    endpointKey: o.endpointKey,
  };
}

function buildPinnedBaseDecision(
  input: CapabilityRouteInput,
  providerPref: RuntimeProviderPref,
): CapabilityRouteDecision {
  const runtimeMode = input.runtimeMode ?? capabilityDefaultRuntimeMode(input.capability);
  const modelMode = runtimeModeToModelMode(runtimeMode, input.modelMode);
  const policyKey = pinnedPolicyKeyForCapability(input.capability, modelMode, runtimeMode);
  const pinned = resolvePinnedPolicyRouteByKey(policyKey, { providerPref });
  const reasoningProfile = reasoningForCapability(input.capability);

  const inputTokens = inputTokensFromInput(input);
  const outputTokens = outputTokensFromInput(input);
  const estimatedCostUsd = estimateCost(pinned.modelId, inputTokens, outputTokens);
  const estimatedWorkMinutes = estimateWorkMinutes(estimatedCostUsd);

  const fallbackCandidates = buildPinnedFallbackCandidates(policyKey, pinned);

  return {
    providerRoute: pinned.providerRoute,
    providerName: providerNameForRoute(
      pinned.providerRoute,
      input.capability,
      input.researchProvider,
    ),
    modelId: pinned.modelId,
    gatewayProviderSlug: pinned.gatewayProviderSlug ?? undefined,
    endpointKey: pinned.endpointKey,
    runtimeMode,
    capability: input.capability,
    reasoningProfile,
    estimatedCostUsd,
    estimatedWorkMinutes,
    fallbackCandidates,
    pinnedPolicy: {
      policyKey,
      reason: pinned.reason,
      gatewayFallbackApplied: pinned.gatewayFallbackApplied,
    },
  };
}

function applyRouteOptimizer(
  decision: CapabilityRouteDecision,
  input: CapabilityRouteInput,
  providerPref: RuntimeProviderPref,
): CapabilityRouteDecision {
  const flags = getRuntimeFlags();
  if (!isRouteOptimizerOn(flags.routeOptimizer) && !isRouteOptimizerShadow(flags.routeOptimizer)) {
    return {
      ...decision,
      fallbackCandidates: stripMockFallbacks(decision.fallbackCandidates),
    };
  }

  const offers = input.catalogOffers ?? staticCatalogOffers();
  const brief = buildTaskRoutingBrief(input, {
    providerPreference: providerPref,
    requiresJson: input.requiresJson,
    currentRoute: input.currentRoute,
  });
  if (input.routingPreference) {
    brief.routingPreference = input.routingPreference;
  }

  const optimized = selectBestModelOffer(brief, offers);
  if (!optimized) {
    return {
      ...decision,
      fallbackCandidates: stripMockFallbacks(decision.fallbackCandidates),
    };
  }

  const optimizerMeta: CapabilityRouteDecision["routeOptimizer"] = {
    selectedProviderRoute: optimized.selected.providerRoute,
    selectedModelId: optimized.selected.modelId,
    selectedGatewayProviderSlug: optimized.selected.gatewayProviderSlug,
    selectedEndpointKey: optimized.selected.endpointKey,
    reason: optimized.reason,
    estimatedCostUsd: optimized.estimatedCostUsd,
    decisionFactors: optimized.decisionFactors,
    priceSource: optimized.priceSource,
    priceFreshness: optimized.priceFreshness,
    healthNote: optimized.healthNote,
    fallbackCandidates: optimized.fallbackCandidates.map(mapFallbackCandidate),
    shadowOnly: isRouteOptimizerShadow(flags.routeOptimizer),
    usedStaticFallback: optimized.usedStaticFallback,
  };

  if (isRouteOptimizerShadow(flags.routeOptimizer)) {
    return {
      ...decision,
      fallbackCandidates: stripMockFallbacks(decision.fallbackCandidates),
      routeOptimizer: optimizerMeta,
    };
  }

  const estimatedCostUsd =
    optimized.estimatedCostUsd ||
    estimateCost(optimized.selected.modelId, inputTokensFromInput(input), outputTokensFromInput(input));

  return {
    providerRoute: optimized.selected.providerRoute,
    providerName: providerNameForRoute(
      optimized.selected.providerRoute,
      input.capability,
      input.researchProvider,
    ),
    modelId: optimized.selected.modelId,
    gatewayProviderSlug: optimized.selected.gatewayProviderSlug,
    endpointKey: optimized.selected.endpointKey,
    runtimeMode: decision.runtimeMode,
    capability: decision.capability,
    reasoningProfile: decision.reasoningProfile,
    estimatedCostUsd,
    estimatedWorkMinutes: estimateWorkMinutes(estimatedCostUsd),
    fallbackCandidates: stripMockFallbacks(
      optimized.fallbackCandidates.map(mapFallbackCandidate),
    ),
    routeOptimizer: optimizerMeta,
  };
}

function inputTokensFromInput(input: CapabilityRouteInput): number {
  const promptLen = input.message?.length ?? 256;
  return Math.max(50, Math.ceil(promptLen / 4));
}

function outputTokensFromInput(input: CapabilityRouteInput): number {
  return input.needsLongContext ? 2000 : 800;
}

/** Capability router — planning only in V19.9.0a (not wired to callers yet). */
export function routeCapability(
  input: CapabilityRouteInput,
  providerPref: RuntimeProviderPref = "auto",
): CapabilityRouteDecision {
  if (input.capability === "browser_research") {
    return routeBrowserResearchCapability(input, providerPref);
  }

  const baseDecision = buildPinnedBaseDecision(input, providerPref);
  return applyRouteOptimizer(baseDecision, input, providerPref);
}
