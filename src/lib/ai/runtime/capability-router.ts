import {
  estimateCost,
  normalizeModelMode,
  resolveModel,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import { isSiliconFlowConfigured } from "@/lib/config/features";
import {
  isVercelGatewayConfigured,
  resolveVercelGatewayModelId,
} from "./adapters/vercel-models";
import { resolveSiliconFlowRuntimeModel } from "./adapters/siliconflow";
import { findCatalogModelsForCapability } from "./catalog/seed";
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

function pickModelId(
  capability: AiCapability,
  runtimeMode: RuntimeMode,
  modelMode: ModelMode,
  providerRoute: ProviderRoute,
  explicitModel?: string,
): string {
  if (explicitModel?.trim()) return explicitModel.trim();

  if (providerRoute === "vercel_gateway") {
    return resolveVercelGatewayModelId({ runtimeMode, capability });
  }

  const catalogMatches = findCatalogModelsForCapability(
    capability,
    providerRoute === "mock" ? undefined : providerRoute,
  );
  if (catalogMatches.length > 0) {
    return catalogMatches[0]!.modelId;
  }

  return resolveModel(providerRoute === "mock" ? "mock" : "siliconflow", modelMode);
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

/** Capability router — planning only in V19.9.0a (not wired to callers yet). */
export function routeCapability(
  input: CapabilityRouteInput,
  providerPref: RuntimeProviderPref = "auto",
): CapabilityRouteDecision {
  if (input.capability === "browser_research") {
    return routeBrowserResearchCapability(input, providerPref);
  }

  const runtimeMode = input.runtimeMode ?? capabilityDefaultRuntimeMode(input.capability);
  const modelMode = runtimeModeToModelMode(runtimeMode, input.modelMode);
  const providerRoute = pickProviderRoute(providerPref, input.capability);
  const modelId = pickModelId(
    input.capability,
    runtimeMode,
    modelMode,
    providerRoute,
  );
  const reasoningProfile = reasoningForCapability(input.capability);

  const promptLen = input.message?.length ?? 256;
  const inputTokens = Math.max(50, Math.ceil(promptLen / 4));
  const outputTokens = input.needsLongContext ? 2000 : 800;
  const estimatedCostUsd = estimateCost(modelId, inputTokens, outputTokens);

  const estimatedWorkMinutes = estimateWorkMinutes(estimatedCostUsd);

  const fallbackCandidates: CapabilityRouteDecision["fallbackCandidates"] = [];
  if (providerRoute === "siliconflow_direct") {
    if (isVercelGatewayConfigured()) {
      fallbackCandidates.push({
        providerRoute: "vercel_gateway",
        modelId: resolveVercelGatewayModelId({ runtimeMode, capability: input.capability }),
      });
    }
    fallbackCandidates.push({ providerRoute: "mock", modelId: "mock/runtime-v2" });
  } else if (providerRoute === "vercel_gateway") {
    if (isSiliconFlowConfigured()) {
      fallbackCandidates.push({
        providerRoute: "siliconflow_direct",
        modelId: resolveModel("siliconflow", modelMode),
      });
    }
    fallbackCandidates.push({ providerRoute: "mock", modelId: "mock/runtime-v2" });
  }

  return {
    providerRoute,
    providerName: providerNameForRoute(providerRoute, input.capability, input.researchProvider),
    modelId,
    runtimeMode,
    capability: input.capability,
    reasoningProfile,
    estimatedCostUsd,
    estimatedWorkMinutes,
    fallbackCandidates,
  };
}
