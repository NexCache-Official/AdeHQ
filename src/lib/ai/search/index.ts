export type {
  SearchRoute,
  SearchNeed,
  SearchRouteDecision,
  SearchSource,
  SearchAnswerResult,
  SearchMode,
  GatewaySearchRunMeta,
} from "./types";

export {
  DEFAULT_SEARCH_ROUTE_POLICY,
  decideSearchRoute,
  requiresDeepBrowserResearch,
  isQuickFactLookup,
  searchRouteToResearchProvider,
  isGatewaySearchRoute,
} from "./search-router";

export {
  isGatewaySearchConfigured,
  isTavilySearchConfigured,
  getSearchPrimaryProvider,
  getSearchBackupProvider,
  isBrowserResearchRequiresExplicitDeepTask,
  getFastFactSearchPreset,
} from "./config";

export {
  normalizeGatewaySearchSources,
  rankSearchSources,
  filterLowQualitySources,
  isUnrelatedSource,
  stripInlineSourcesSection,
  buildSearchSourcesArtifact,
  type SearchSourceCard,
  type NormalizedSearchSources,
} from "./source-normalizer";

export { runGatewaySearchAnswer, estimateGatewaySearchCostUsd } from "./vercel-gateway-search";
export { runTavilySearchAnswer, estimateTavilySearchAnswerCostUsd } from "./tavily-search";
export { executeSearchAnswer, type ExecuteSearchAnswerParams } from "./search-answer";
