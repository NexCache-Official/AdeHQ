import type { SearchNeed, SearchRoute, SearchSource } from "@/lib/ai/search/types";

/** Brain-level search need — stewards request this, never a provider. */
export type BrainSearchNeed =
  | "current_fact"
  | "company_research"
  | "market_research"
  | "people_research"
  | "technical_docs"
  | "academic_research"
  | "source_verification"
  | "general_web"
  | "website_interaction";

export type SearchFreshness = "live" | "recent" | "stable";
export type SearchDepth = "quick" | "standard" | "deep";

export type SearchCapabilityRequest = {
  query: string;
  need: BrainSearchNeed;
  freshness: SearchFreshness;
  depth: SearchDepth;
  preferredDomains?: string[];
  excludedDomains?: string[];
  requirePrimarySources?: boolean;
  maxSources?: number;
  workspaceId: string;
  brainRunId?: string;
  employeeId?: string;
};

export type SearchEvidenceAssessment = {
  hasUsableSources: boolean;
  sourceCount: number;
  primarySourceCount: number;
  citationCoverage: number;
  freshnessSatisfied: boolean;
  queryCoverage: number;
  conflictingSources: boolean;
  confidence: number;
  fallbackReason?: string;
};

export type SearchAttemptOutcome =
  | "success"
  | "no_sources"
  | "insufficient_evidence"
  | "timeout"
  | "provider_error"
  | "invalid_response"
  | "cancelled";

export type SearchAttemptRecord = {
  attemptNumber: number;
  routeId: string;
  provider: "exa" | "perplexity" | "tavily" | "browserbase";
  queryHash: string;
  startedAt: string;
  completedAt?: string;
  latencyMs?: number;
  sourceCount?: number;
  usedSourceCount?: number;
  outcome: SearchAttemptOutcome;
  fallbackReason?: string;
  pricingSnapshotId?: string;
  actualCostUsd: number;
  workHours: number;
};

export type NormalizedSearchSource = {
  id: string;
  title: string;
  url: string;
  canonicalUrl: string;
  domain: string;
  publisher?: string;
  publishedAt?: string;
  retrievedAt: string;
  snippet?: string;
  highlights?: string[];
  isPrimarySource?: boolean;
  relevanceScore?: number;
  providerRank?: number;
};

/** Map Brain need → legacy SearchNeed used by classifiers. */
export function brainNeedToLegacySearchNeed(need: BrainSearchNeed): SearchNeed {
  switch (need) {
    case "website_interaction":
      return "deep_browser_research";
    case "company_research":
      return "company_fact";
    case "market_research":
    case "people_research":
    case "technical_docs":
    case "academic_research":
      return "market_research";
    case "source_verification":
      return "source_verification";
    case "current_fact":
      return "current_fact";
    case "general_web":
    default:
      return "current_fact";
  }
}

/** Map legacy SearchNeed → Brain need. */
export function legacySearchNeedToBrainNeed(need: SearchNeed): BrainSearchNeed {
  switch (need) {
    case "deep_browser_research":
      return "website_interaction";
    case "company_fact":
      return "company_research";
    case "market_research":
      return "market_research";
    case "source_verification":
      return "source_verification";
    case "news":
      return "current_fact";
    case "current_fact":
      return "current_fact";
    case "none":
    default:
      return "general_web";
  }
}

export function searchRouteToBrainRouteId(route: SearchRoute): string | null {
  switch (route) {
    case "gateway_exa":
      return "route_search_exa";
    case "gateway_perplexity":
      return "route_search_perplexity";
    case "tavily":
      return "route_search_tavily";
    case "browserbase":
      return "route_browser_browserbase";
    default:
      return null;
  }
}

export function searchRouteToAttemptProvider(
  route: SearchRoute,
): SearchAttemptRecord["provider"] | null {
  switch (route) {
    case "gateway_exa":
      return "exa";
    case "gateway_perplexity":
      return "perplexity";
    case "tavily":
      return "tavily";
    case "browserbase":
      return "browserbase";
    default:
      return null;
  }
}

export type { SearchSource };
