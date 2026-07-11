import {
  getSearchPrimaryProvider,
  getSearchBackupProvider,
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
};

export type SearchStewardDecision = {
  need: SearchNeed;
  provider: SearchRoute;
  searchMode: SearchMode;
  reason: string;
  cacheFirst: true;
  backupProvider?: SearchRoute;
  browserRequired: boolean;
  maxResults?: number;
  recency?: "day" | "week" | "month" | "year";
  estimatedWorkMinutes: number;
};

const FACT_NEEDS: SearchNeed[] = ["current_fact", "company_fact", "news"];

function resolveBackupProvider(primary: SearchRoute): SearchRoute | undefined {
  const backup = getSearchBackupProvider();
  if (backup === primary) return undefined;
  if (backup === "tavily" && isTavilySearchConfigured()) return "tavily";
  if (backup.startsWith("gateway_") && isGatewaySearchConfigured()) return backup;
  if (isTavilySearchConfigured()) return "tavily";
  return undefined;
}

/**
 * Exa-first provider preference for web fact/research needs. Exa gives better
 * retrieval quality AND — because we control synthesis with an efficient model
 * — is faster end-to-end than Perplexity/Tavily's own synthesis, so it's the
 * default primary whenever configured. An explicit AI_SEARCH_PRIMARY_PROVIDER
 * still wins when set to a gateway route. Falls through Exa → gateway → Tavily.
 */
function preferredFactProvider(
  capabilities: SearchStewardCapabilities,
): { provider: SearchRoute; reason: string } {
  const primaryPref = getSearchPrimaryProvider();

  // Honor an explicit non-Exa primary preference when its provider is live.
  if (
    primaryPref === "gateway_perplexity" &&
    capabilities.gatewaySearch &&
    !capabilities.exa
  ) {
    return { provider: "gateway_perplexity", reason: "Fact — configured Perplexity primary." };
  }

  // Exa-first default: direct Exa retrieval + our own fast synthesis.
  if (capabilities.exa) {
    return { provider: "gateway_exa", reason: "Fact — Exa (primary)." };
  }
  if (primaryPref === "gateway_exa" && capabilities.gatewaySearch) {
    return { provider: "gateway_exa", reason: "Fact — gateway Exa (primary)." };
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
  if (need === "market_research") {
    if (capabilities.exa) {
      return { provider: "gateway_exa", reason: "Semantic research — Exa capability." };
    }
    if (capabilities.gatewaySearch) {
      return { provider: "gateway_exa", reason: "Semantic research — gateway Exa fallback." };
    }
    if (capabilities.tavily) {
      return { provider: "tavily", reason: "Semantic research — Tavily fallback." };
    }
    return { provider: "none", reason: "Semantic research requested but no search provider configured." };
  }
  if (need === "source_verification") {
    // Exa's semantic retrieval is strong for cross-checking a specific claim;
    // prefer it, then gateway's parallel search, then Tavily.
    if (capabilities.exa) {
      return { provider: "gateway_exa", reason: "Source verification — Exa capability." };
    }
    if (capabilities.gatewaySearch) {
      return { provider: "gateway_parallel", reason: "Source verification — parallel search." };
    }
    if (capabilities.tavily) return { provider: "tavily", reason: "Source verification — Tavily." };
    return { provider: "none", reason: "Verification requested but no search provider configured." };
  }
  if (FACT_NEEDS.includes(need)) {
    return preferredFactProvider(capabilities);
  }
  return { provider: "none", reason: "No search need detected." };
}

/** Need-first search routing — providers are capabilities, not a fallback ladder. */
export function decideSearchSteward(
  query: string,
  context: SearchStewardContext = {},
  capabilities: SearchStewardCapabilities = defaultSearchStewardCapabilities(),
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

  const routed = providerForNeed(need, capabilities);
  const searchMode =
    isQuickFactLookup(trimmed) && FACT_NEEDS.includes(need) ? "fast_fact" : "standard";

  const backupProvider =
    routed.provider !== "none" && routed.provider !== "browserbase"
      ? resolveBackupProvider(routed.provider)
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
