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
  classifySearchNeed,
  requiresDeepBrowserResearch,
  isQuickFactLookup,
  searchRouteToResearchProvider,
  isGatewaySearchRoute,
} from "./search-router";

export {
  isGatewaySearchConfigured,
  isExaSearchConfigured,
  isTavilySearchConfigured,
  getSearchPrimaryProvider,
  getSearchBackupProvider,
  isBrowserResearchRequiresExplicitDeepTask,
  getFastFactSearchPreset,
  getExaSearchType,
  getExaNumResults,
  getExaSearchCostUsd,
  getResearchSessionTtlDays,
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
export { runExaSearchAnswer, estimateExaSearchCostUsd } from "./exa-search";
export { runTavilySearchAnswer, estimateTavilySearchAnswerCostUsd } from "./tavily-search";
export {
  executeSearchAnswer,
  shouldReturnNoSourcesMessage,
  type ExecuteSearchAnswerParams,
  type ExecuteSearchAnswerMeta,
} from "./search-answer";
export {
  decideSearchSteward,
  defaultSearchStewardCapabilities,
  stewardDecisionToRouteDecision,
  stewardDecisionToResearchProvider,
  searchStewardDebugSnapshot,
  enrichSearchStewardDebugSnapshot,
  type SearchStewardDecision,
  type SearchStewardCapabilities,
} from "./search-steward";
export {
  normalizeSearchCacheKey,
  normalizeSearchCacheKeys,
  stripFillerWords,
  computeSearchConfidence,
  getSearchCache,
  setSearchCache,
} from "./search-cache";
export {
  getReusableSessionFindings,
  recordSessionSearchEvent,
  type ResearchSessionReuse,
} from "./research-session";
