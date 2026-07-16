import {
  getSearchFallback1Provider,
  getSearchFallback2Provider,
  getSearchPrimaryProvider,
  isExaSearchConfigured,
  isGatewaySearchConfigured,
  isTavilySearchConfigured,
} from "./config";
import {
  classifySearchNeed,
  isQuickFactLookup,
  requiresDeepBrowserResearch,
} from "./search-router";
import type { SearchMode, SearchNeed, SearchRoute, SearchRouteDecision } from "./types";
import type { ResearchProviderChoice } from "@/lib/ai/research/research-provider";
import { isBrainSearchV1Enabled } from "@/lib/brain/flags";
import {
  legacySearchNeedToBrainNeed,
  mapNeedToSearchRouteChain,
} from "@/lib/brain/search";

export type SearchStewardCapabilities = {
  gatewaySearch: boolean;
  exa: boolean;
  tavily: boolean;
  browserbase: boolean;
};

export type SearchStewardContext = {
  preferAgentMode?: boolean;
  preferFastSearch?: boolean;
  employeeRole?: string;
};

export type SearchStewardAttempt = {
  provider: SearchRoute;
  sourceCount: number;
  latencyMs: number;
  failed: boolean;
  fallbackReason?: string;
};

export type SearchStewardDecision = {
  need: SearchNeed;
  provider: SearchRoute;
  searchMode: SearchMode;
  reason: string;
  cacheFirst: true;
  /** First backup (legacy single-backup path). */
  backupProvider?: SearchRoute;
  /** Full PR-14 chain after primary (Perplexity → Tavily). */
  fallbackChain?: SearchRoute[];
  browserRequired: boolean;
  maxResults?: number;
  recency?: "day" | "week" | "month" | "year";
  estimatedWorkMinutes: number;
};

const FACT_NEEDS: SearchNeed[] = ["current_fact", "company_fact", "news"];

function prefToRoute(pref: ReturnType<typeof getSearchPrimaryProvider>): SearchRoute {
  return pref;
}

function resolveLegacyBackupProvider(primary: SearchRoute): SearchRoute | undefined {
  const backup = prefToRoute(getSearchFallback1Provider());
  if (backup === primary) {
    const final = prefToRoute(getSearchFallback2Provider());
    if (final === primary) return undefined;
    if (final === "tavily" && isTavilySearchConfigured()) return "tavily";
    if (final.startsWith("gateway_") && isGatewaySearchConfigured()) return final;
    return undefined;
  }
  if (backup === "tavily" && isTavilySearchConfigured()) return "tavily";
  if (backup === "gateway_exa" && (isExaSearchConfigured() || isGatewaySearchConfigured())) {
    return "gateway_exa";
  }
  if (backup.startsWith("gateway_") && isGatewaySearchConfigured()) return backup;
  if (isTavilySearchConfigured()) return "tavily";
  return undefined;
}

function preferredFactProvider(
  capabilities: SearchStewardCapabilities,
): { provider: SearchRoute; reason: string } {
  const primaryPref = getSearchPrimaryProvider();

  if (capabilities.exa || (primaryPref === "gateway_exa" && capabilities.gatewaySearch)) {
    return { provider: "gateway_exa", reason: "Fact — Exa (primary)." };
  }
  if (primaryPref === "gateway_perplexity" && capabilities.gatewaySearch) {
    return { provider: "gateway_perplexity", reason: "Fact — configured Perplexity primary." };
  }
  if (capabilities.gatewaySearch) {
    return { provider: "gateway_perplexity", reason: "Fact — Perplexity (Exa not configured)." };
  }
  if (capabilities.tavily) {
    return { provider: "tavily", reason: "Fact — Tavily fallback." };
  }
  return { provider: "none", reason: "Factual question but no search provider configured." };
}

function providerForNeed(
  need: SearchNeed,
  capabilities: SearchStewardCapabilities,
): { provider: SearchRoute; reason: string } {
  if (need === "deep_browser_research") {
    return {
      provider: "browserbase",
      reason: "Interaction required — browser capability.",
    };
  }
  if (need === "market_research" || need === "source_verification" || FACT_NEEDS.includes(need)) {
    return preferredFactProvider(capabilities);
  }
  return { provider: "none", reason: "No search need detected." };
}

function decideSearchStewardV1(
  query: string,
  context: SearchStewardContext,
  capabilities: SearchStewardCapabilities,
): SearchStewardDecision {
  const trimmed = query.trim();
  const need = classifySearchNeed(trimmed, { preferAgentMode: context.preferAgentMode });

  if (need === "none") {
    return {
      need: "none",
      provider: "none",
      searchMode: "standard",
      reason: "No external search needed.",
      cacheFirst: true,
      browserRequired: false,
      estimatedWorkMinutes: 0,
    };
  }

  if (
    need === "deep_browser_research" ||
    context.preferAgentMode ||
    requiresDeepBrowserResearch(trimmed, { preferAgentMode: context.preferAgentMode })
  ) {
    if (capabilities.browserbase) {
      return {
        need: "deep_browser_research",
        provider: "browserbase",
        searchMode: "standard",
        reason: "Interaction required — routed to browser.",
        cacheFirst: true,
        browserRequired: true,
        estimatedWorkMinutes: 15,
      };
    }
  }

  const brainNeed = legacySearchNeedToBrainNeed(need);
  const chain = mapNeedToSearchRouteChain(brainNeed).filter((route) => {
    // Direct Exa only when EXA_API_KEY is present. Without it, skip to Perplexity.
    if (route === "gateway_exa") return capabilities.exa;
    if (route === "gateway_perplexity" || route === "gateway_parallel") {
      return capabilities.gatewaySearch;
    }
    if (route === "tavily") return capabilities.tavily;
    return false;
  });

  const primary = chain[0] ?? "none";
  const fallbackChain = chain.slice(1);
  const searchMode =
    isQuickFactLookup(trimmed) && FACT_NEEDS.includes(need) ? "fast_fact" : "standard";

  return {
    need,
    provider: primary,
    searchMode,
    reason:
      primary === "none"
        ? "External search requested but no provider configured."
        : `Brain search — Exa-first chain (${chain.join(" → ") || "none"}).`,
    cacheFirst: true,
    backupProvider: fallbackChain[0],
    fallbackChain,
    browserRequired: false,
    maxResults: primary === "gateway_exa" ? 10 : 5,
    recency: need === "news" ? "week" : FACT_NEEDS.includes(need) ? "year" : undefined,
    estimatedWorkMinutes: primary === "gateway_exa" ? 2 : 1.5,
  };
}

/** Need-first search routing — providers are selected by Brain, not employees. */
export function decideSearchSteward(
  query: string,
  context: SearchStewardContext = {},
  capabilities: SearchStewardCapabilities = defaultSearchStewardCapabilities(),
): SearchStewardDecision {
  if (isBrainSearchV1Enabled()) {
    return decideSearchStewardV1(query, context, capabilities);
  }

  // Legacy single-backup path (ADEHQ_BRAIN_SEARCH_V1=0).
  const trimmed = query.trim();
  const need = classifySearchNeed(trimmed, { preferAgentMode: context.preferAgentMode });

  if (need === "none") {
    return {
      need: "none",
      provider: "none",
      searchMode: "standard",
      reason: "No external search needed.",
      cacheFirst: true,
      browserRequired: false,
      estimatedWorkMinutes: 0,
    };
  }

  if (
    need === "deep_browser_research" ||
    context.preferAgentMode ||
    requiresDeepBrowserResearch(trimmed, { preferAgentMode: context.preferAgentMode })
  ) {
    if (capabilities.browserbase) {
      return {
        need: "deep_browser_research",
        provider: "browserbase",
        searchMode: "standard",
        reason: "Interaction required — routed to browser.",
        cacheFirst: true,
        browserRequired: true,
        estimatedWorkMinutes: 15,
      };
    }
  }

  const routed = providerForNeed(need, capabilities);
  const searchMode =
    isQuickFactLookup(trimmed) && FACT_NEEDS.includes(need) ? "fast_fact" : "standard";

  const backupProvider =
    routed.provider !== "none" && routed.provider !== "browserbase"
      ? resolveLegacyBackupProvider(routed.provider)
      : undefined;

  return {
    need,
    provider: routed.provider,
    searchMode,
    reason: routed.reason,
    cacheFirst: true,
    backupProvider,
    browserRequired: false,
    maxResults: routed.provider === "gateway_exa" ? 10 : 5,
    recency: need === "news" ? "week" : FACT_NEEDS.includes(need) ? "year" : undefined,
    estimatedWorkMinutes:
      routed.provider === "browserbase"
        ? 15
        : routed.provider.startsWith("gateway_") || routed.provider === "tavily"
          ? routed.provider === "gateway_exa"
            ? 2
            : 1.5
          : 0,
  };
}

export function defaultSearchStewardCapabilities(): SearchStewardCapabilities {
  return {
    gatewaySearch: isGatewaySearchConfigured(),
    exa: isExaSearchConfigured(),
    tavily: isTavilySearchConfigured(),
    browserbase: false,
  };
}

export function stewardDecisionToRouteDecision(
  decision: SearchStewardDecision,
): SearchRouteDecision {
  return {
    need: decision.need,
    route: decision.provider,
    browserRequired: decision.browserRequired,
    reason: decision.reason,
    searchMode: decision.searchMode,
    maxResults: decision.maxResults,
    recency: decision.recency,
    estimatedWorkMinutes: decision.estimatedWorkMinutes,
  };
}

export function stewardDecisionToResearchProvider(
  decision: SearchStewardDecision,
): ResearchProviderChoice | undefined {
  if (decision.provider === "none") return undefined;
  if (decision.provider === "gateway_perplexity") return "gateway_perplexity";
  if (decision.provider === "gateway_exa") return "gateway_exa";
  if (decision.provider === "gateway_parallel") return "gateway_parallel";
  if (decision.provider === "tavily") return "tavily";
  if (decision.provider === "browserbase") return "browserbase";
  return undefined;
}

export function searchStewardDebugSnapshot(decision: SearchStewardDecision): Record<string, unknown> {
  return {
    need: decision.need,
    provider: decision.provider,
    reason: decision.reason,
    backupProvider: decision.backupProvider,
    fallbackChain: decision.fallbackChain,
    searchMode: decision.searchMode,
    cacheFirst: decision.cacheFirst,
    browserRequired: decision.browserRequired,
  };
}

export function enrichSearchStewardDebugSnapshot(
  decision: SearchStewardDecision,
  runtime?: {
    cacheHit?: boolean;
    cacheKey?: string;
    sessionId?: string;
    sessionReused?: boolean;
    attempts?: SearchStewardAttempt[];
  },
): Record<string, unknown> {
  return {
    ...searchStewardDebugSnapshot(decision),
    ...(runtime?.cacheHit != null ? { cacheHit: runtime.cacheHit } : {}),
    ...(runtime?.cacheKey ? { cacheKey: runtime.cacheKey } : {}),
    ...(runtime?.sessionId ? { sessionId: runtime.sessionId } : {}),
    ...(runtime?.sessionReused != null ? { sessionReused: runtime.sessionReused } : {}),
    ...(runtime?.attempts?.length ? { attempts: runtime.attempts } : {}),
  };
}
