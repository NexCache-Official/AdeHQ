import {
  isFastSearchQuery,
  resolveBrowserResearchProviderForQuery,
} from "@/lib/ai/browser-research/provider-config";
import {
  isGatewaySearchRoute,
} from "@/lib/ai/search/search-router";
import {
  isExaSearchConfigured,
  isGatewaySearchConfigured,
  isTavilySearchConfigured,
} from "@/lib/ai/search/config";
import {
  decideSearchSteward,
  defaultSearchStewardCapabilities,
  stewardDecisionToResearchProvider,
} from "@/lib/ai/search/search-steward";

export type ResearchProviderChoice =
  | "gateway_perplexity"
  | "gateway_exa"
  | "gateway_parallel"
  | "tavily"
  | "browserbase";

export type ResearchProviderCapabilities = {
  gatewaySearch: boolean;
  exa: boolean;
  tavily: boolean;
  browserbase: boolean;
};

/** Pick provider for a resolved query via Search Steward v1. */
export function pickResearchProvider(
  query: string,
  prefs: { preferTavily: boolean; preferAgentMode: boolean },
  capabilities: ResearchProviderCapabilities,
): ResearchProviderChoice | undefined {
  if (prefs.preferAgentMode && capabilities.browserbase) {
    return "browserbase";
  }

  const steward = decideSearchSteward(
    query,
    {
      preferAgentMode: prefs.preferAgentMode,
      preferFastSearch: prefs.preferTavily,
    },
    capabilities,
  );

  const mapped = stewardDecisionToResearchProvider(steward);
  if (mapped) {
    if (mapped === "gateway_exa" && (capabilities.exa || capabilities.gatewaySearch)) {
      return "gateway_exa";
    }
    if (isGatewaySearchRoute(mapped) && capabilities.gatewaySearch) {
      return mapped;
    }
    if (mapped === "tavily" && capabilities.tavily) {
      return "tavily";
    }
    if (mapped === "browserbase" && capabilities.browserbase) {
      return "browserbase";
    }
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
  if (routed.provider === "browserbase" && capabilities.browserbase && steward.browserRequired) {
    return "browserbase";
  }

  if (isFastSearchQuery(query)) {
    if (capabilities.gatewaySearch) return "gateway_perplexity";
    if (capabilities.tavily) return "tavily";
  }

  if (capabilities.gatewaySearch) return "gateway_perplexity";
  if (capabilities.exa) return "gateway_exa";
  if (capabilities.tavily) return "tavily";
  if (capabilities.browserbase && steward.browserRequired) return "browserbase";
  return undefined;
}

export function getResearchProviderCapabilitiesFromEnv(): ResearchProviderCapabilities {
  return {
    gatewaySearch: isGatewaySearchConfigured(),
    exa: isExaSearchConfigured(),
    tavily: isTavilySearchConfigured(),
    browserbase: false,
  };
}

export function mergeResearchCapabilities(
  base: ResearchProviderCapabilities,
  overrides?: Partial<ResearchProviderCapabilities>,
): ResearchProviderCapabilities {
  return { ...base, ...overrides };
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

export { defaultSearchStewardCapabilities };
