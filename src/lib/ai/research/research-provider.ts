import {
  isFastSearchQuery,
  resolveBrowserResearchProviderForQuery,
} from "@/lib/ai/browser-research/provider-config";
import {
  decideSearchRoute,
  isGatewaySearchRoute,
  searchRouteToResearchProvider,
} from "@/lib/ai/search/search-router";
import { isGatewaySearchConfigured, isTavilySearchConfigured } from "@/lib/ai/search/config";

export type ResearchProviderChoice =
  | "gateway_perplexity"
  | "gateway_exa"
  | "gateway_parallel"
  | "tavily"
  | "browserbase";

export type ResearchProviderCapabilities = {
  gatewaySearch: boolean;
  tavily: boolean;
  browserbase: boolean;
};

/** Pick provider for a resolved query; user toggles override routing heuristics. */
export function pickResearchProvider(
  query: string,
  prefs: { preferTavily: boolean; preferAgentMode: boolean },
  capabilities: ResearchProviderCapabilities,
): ResearchProviderChoice | undefined {
  if (prefs.preferAgentMode && capabilities.browserbase) {
    return "browserbase";
  }

  const routeDecision = decideSearchRoute(query, {
    preferAgentMode: prefs.preferAgentMode,
    preferFastSearch: prefs.preferTavily,
  });

  if (!routeDecision.browserRequired && routeDecision.route !== "none") {
    const mapped = searchRouteToResearchProvider(routeDecision.route);
    if (mapped && isGatewaySearchRoute(routeDecision.route) && capabilities.gatewaySearch) {
      return mapped;
    }
    if (mapped === "tavily" && capabilities.tavily) {
      return "tavily";
    }
    if (capabilities.gatewaySearch && isGatewaySearchRoute(routeDecision.route)) {
      return "gateway_perplexity";
    }
    if (capabilities.tavily) return "tavily";
  }

  if (prefs.preferTavily) {
    if (capabilities.gatewaySearch) return "gateway_perplexity";
    if (capabilities.tavily) return "tavily";
  }

  if (/\bhttps?:\/\//.test(query) && capabilities.browserbase && prefs.preferAgentMode) {
    return "browserbase";
  }

  if (prefs.preferAgentMode && capabilities.browserbase && !isFastSearchQuery(query)) {
    return "browserbase";
  }

  const routed = resolveBrowserResearchProviderForQuery(query);
  if (routed.provider === "tavily" && capabilities.tavily) return "tavily";
  if (routed.provider === "browserbase" && capabilities.browserbase && routeDecision.browserRequired) {
    return "browserbase";
  }

  if (isFastSearchQuery(query) || isQuickFactLookupCompat(query)) {
    if (capabilities.gatewaySearch) return "gateway_perplexity";
    if (capabilities.tavily) return "tavily";
  }

  if (capabilities.gatewaySearch) return "gateway_perplexity";
  if (capabilities.tavily) return "tavily";
  if (capabilities.browserbase && routeDecision.browserRequired) return "browserbase";
  return undefined;
}

function isQuickFactLookupCompat(query: string): boolean {
  return decideSearchRoute(query).need === "current_fact" ||
    decideSearchRoute(query).need === "company_fact" ||
    decideSearchRoute(query).need === "news";
}

export function getResearchProviderCapabilitiesFromEnv(): ResearchProviderCapabilities {
  return {
    gatewaySearch: isGatewaySearchConfigured(),
    tavily: isTavilySearchConfigured(),
    browserbase: false,
  };
}

export function isGatewayResearchProvider(
  provider: ResearchProviderChoice | undefined,
): provider is "gateway_perplexity" | "gateway_exa" | "gateway_parallel" {
  return (
    provider === "gateway_perplexity" ||
    provider === "gateway_exa" ||
    provider === "gateway_parallel"
  );
}
