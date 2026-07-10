import type { MessageArtifact } from "@/lib/types";

export type SearchRoute =
  | "none"
  | "gateway_perplexity"
  | "gateway_exa"
  | "gateway_parallel"
  | "tavily"
  | "browserbase";

export type SearchNeed =
  | "none"
  | "current_fact"
  | "company_fact"
  | "news"
  | "market_research"
  | "source_verification"
  | "deep_browser_research";

export type SearchMode = "fast_fact" | "standard";

export type SearchRouteDecision = {
  need: SearchNeed;
  route: SearchRoute;
  browserRequired: boolean;
  reason: string;
  searchMode?: SearchMode;
  maxResults?: number;
  domains?: string[];
  recency?: "day" | "week" | "month" | "year";
  estimatedWorkMinutes: number;
};

export type SearchSource = {
  title: string;
  url: string;
  snippet?: string;
};

export type SearchAnswerResult = {
  answer: string;
  sources: SearchSource[];
  route: SearchRoute;
  providerRoute: "vercel_gateway" | "exa" | "tavily" | "model_fallback";
  estimatedCostUsd: number;
  estimatedWorkMinutes: number;
  uncertaintyNote?: string;
  searchMeta?: GatewaySearchRunMeta;
  webSourcesArtifact?: MessageArtifact;
  searchSourcesArtifact?: MessageArtifact;
  fromCache?: boolean;
  cacheKey?: string;
};

export type GatewaySearchRunMeta = {
  searchRoute: SearchRoute;
  searchNeed: SearchNeed;
  searchMode: SearchMode;
  browserRequired: false;
  searchRequests: number;
  sourceCount: number;
  usedSourceCount: number;
  excludedSourceCount: number;
  searchCostUsd: number;
  synthesisModel: string;
  totalLatencyMs: number;
  searchLatencyMs: number;
  synthesisLatencyMs: number;
  confidence?: number;
  excludedSourceReasons?: string[];
};
