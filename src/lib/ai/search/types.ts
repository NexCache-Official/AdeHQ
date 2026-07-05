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

export type SearchRouteDecision = {
  need: SearchNeed;
  route: SearchRoute;
  browserRequired: boolean;
  reason: string;
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
  providerRoute: "vercel_gateway" | "tavily" | "model_fallback";
  estimatedCostUsd: number;
  estimatedWorkMinutes: number;
  uncertaintyNote?: string;
};
