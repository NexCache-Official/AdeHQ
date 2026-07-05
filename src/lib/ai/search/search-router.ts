import {
  getSearchPrimaryProvider,
  getSearchBackupProvider,
  isBrowserResearchRequiresExplicitDeepTask,
  isGatewaySearchConfigured,
  isTavilySearchConfigured,
} from "./config";
import type { SearchNeed, SearchRoute, SearchRouteDecision } from "./types";

export const DEFAULT_SEARCH_ROUTE_POLICY: Record<Exclude<SearchNeed, "none">, SearchRoute> = {
  current_fact: "gateway_perplexity",
  company_fact: "gateway_perplexity",
  news: "gateway_perplexity",
  market_research: "gateway_exa",
  source_verification: "gateway_parallel",
  deep_browser_research: "browserbase",
};

const CURRENT_FACT_PATTERNS = [
  /\b(what was|what is|what's|how much|how many|when did|who is|who's|who was|where is|where was)\b/i,
  /\b(revenue|arr|funding|raised|valuation|series [a-d]|market cap|stock price|share price|ceo|cfo|founder)\b/i,
  /\b(latest|recent|current|today|this week|this month|in 20\d{2})\b/i,
  /\b(tell me about|look up|find out|search for)\b/i,
];

const DEEP_BROWSER_PATTERNS = [
  /\b(browse live|open websites?|take screenshots?|show evidence|live browser|browser agent)\b/i,
  /\b(multi[- ]step|navigate|log in|sign in|fill out|click through|scrape|extract from multiple)\b/i,
  /\b(create a report|research report|competitive report|pricing page|screenshot)\b/i,
  /\b(open sources?,.{0,40}screenshots?|screenshots?.{0,40}report)\b/i,
];

const MARKET_RESEARCH_PATTERNS = [
  /\b(market size|tam|sam|som|competitive landscape|industry analysis|market research)\b/i,
];

const NEWS_PATTERNS = [/\b(news|headlines?|breaking news|just announced)\b/i];

const SOURCE_VERIFICATION_PATTERNS = [
  /\b(verify|fact check|confirm from source|cross[- ]check|primary source)\b/i,
];

function classifySearchNeed(query: string, opts?: { preferAgentMode?: boolean }): SearchNeed {
  const trimmed = query.trim();
  if (!trimmed) return "none";

  if (opts?.preferAgentMode || DEEP_BROWSER_PATTERNS.some((p) => p.test(trimmed))) {
    return "deep_browser_research";
  }

  if (SOURCE_VERIFICATION_PATTERNS.some((p) => p.test(trimmed))) {
    return "source_verification";
  }

  if (MARKET_RESEARCH_PATTERNS.some((p) => p.test(trimmed))) {
    return "market_research";
  }

  if (NEWS_PATTERNS.some((p) => p.test(trimmed))) {
    return "news";
  }

  if (/\b(revenue|funding|raised|valuation|company|corp|inc\.|startup)\b/i.test(trimmed)) {
    return "company_fact";
  }

  if (CURRENT_FACT_PATTERNS.some((p) => p.test(trimmed))) {
    return "current_fact";
  }

  return "none";
}

function resolveRouteForNeed(need: SearchNeed): SearchRoute {
  if (need === "none") return "none";
  return DEFAULT_SEARCH_ROUTE_POLICY[need];
}

function applyProviderAvailability(route: SearchRoute): {
  route: SearchRoute;
  reason: string;
} {
  if (route === "none" || route === "browserbase") {
    return { route, reason: "policy_default" };
  }

  const primary = getSearchPrimaryProvider();
  const backup = getSearchBackupProvider();

  const tryRoute = (candidate: SearchRoute): boolean => {
    if (candidate.startsWith("gateway_")) return isGatewaySearchConfigured();
    if (candidate === "tavily") return isTavilySearchConfigured();
    return false;
  };

  const preferred =
    route.startsWith("gateway_") && tryRoute(route)
      ? route
      : primary.startsWith("gateway_") && tryRoute(primary)
        ? primary
        : tryRoute(backup)
          ? backup
          : tryRoute("tavily")
            ? "tavily"
            : "none";

  if (preferred === "none") {
    return {
      route: "none",
      reason: "search_unavailable",
    };
  }

  return { route: preferred, reason: preferred === route ? "policy_default" : "provider_fallback" };
}

export function requiresDeepBrowserResearch(
  query: string,
  opts?: { preferAgentMode?: boolean; explicitBrowserTask?: boolean },
): boolean {
  if (opts?.preferAgentMode || opts?.explicitBrowserTask) return true;
  const need = classifySearchNeed(query, { preferAgentMode: opts?.preferAgentMode });
  if (need === "deep_browser_research") return true;
  if (isBrowserResearchRequiresExplicitDeepTask()) return false;
  return false;
}

export function isQuickFactLookup(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length > 280) return false;
  if (/\b(draft|write|compose|create|brainstorm|outline)\b/i.test(trimmed)) return false;
  const need = classifySearchNeed(trimmed);
  return (
    need === "current_fact" ||
    need === "company_fact" ||
    need === "news"
  );
}

export function decideSearchRoute(
  query: string,
  opts?: {
    preferAgentMode?: boolean;
    preferFastSearch?: boolean;
    explicitBrowserTask?: boolean;
  },
): SearchRouteDecision {
  const trimmed = query.trim();
  const need = classifySearchNeed(trimmed, { preferAgentMode: opts?.preferAgentMode });

  if (need === "none") {
    return {
      need: "none",
      route: "none",
      browserRequired: false,
      reason: "No external search needed.",
      estimatedWorkMinutes: 0,
    };
  }

  if (need === "deep_browser_research" || opts?.preferAgentMode || opts?.explicitBrowserTask) {
    return {
      need: "deep_browser_research",
      route: "browserbase",
      browserRequired: true,
      reason: "Task requires visible browser work or explicit agent mode.",
      estimatedWorkMinutes: 15,
    };
  }

  if (isQuickFactLookup(trimmed) && !opts?.preferAgentMode) {
    const routed = applyProviderAvailability("gateway_perplexity");
    return {
      need,
      route: routed.route,
      browserRequired: false,
      reason:
        routed.route === "none"
          ? "Fast search requested but no search provider is configured."
          : `Quick factual lookup — ${routed.reason}.`,
      maxResults: 5,
      recency: "year",
      estimatedWorkMinutes: routed.route.startsWith("gateway_") ? 1.5 : 2,
    };
  }

  let policyRoute = resolveRouteForNeed(need);
  if (isBrowserResearchRequiresExplicitDeepTask() && policyRoute === "browserbase") {
    policyRoute = "gateway_perplexity";
  }

  const routed = applyProviderAvailability(policyRoute);
  const browserRequired = routed.route === "browserbase";

  return {
    need,
    route: routed.route,
    browserRequired,
    reason: browserRequired
      ? "Deep research routed to live browser."
      : `Search need ${need} — ${routed.reason}.`,
    maxResults: browserRequired ? undefined : 5,
    recency: need === "news" ? "week" : need === "current_fact" ? "year" : undefined,
    estimatedWorkMinutes: browserRequired ? 15 : routed.route.startsWith("gateway_") ? 1.5 : 2,
  };
}

/** Map search route to research planner provider id. */
export function searchRouteToResearchProvider(
  route: SearchRoute,
): "gateway_perplexity" | "gateway_exa" | "gateway_parallel" | "tavily" | "browserbase" | undefined {
  if (route === "none") return undefined;
  if (route === "gateway_perplexity") return "gateway_perplexity";
  if (route === "gateway_exa") return "gateway_exa";
  if (route === "gateway_parallel") return "gateway_parallel";
  if (route === "tavily") return "tavily";
  if (route === "browserbase") return "browserbase";
  return undefined;
}

export function isGatewaySearchRoute(route: SearchRoute): boolean {
  return route === "gateway_perplexity" || route === "gateway_exa" || route === "gateway_parallel";
}
