export type {
  SearchRoute,
  SearchNeed,
  SearchRouteDecision,
  SearchSource,
  SearchAnswerResult,
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
} from "./config";

export { runGatewaySearchAnswer, estimateGatewaySearchCostUsd } from "./vercel-gateway-search";
export { runTavilySearchAnswer, estimateTavilySearchAnswerCostUsd } from "./tavily-search";
export { executeSearchAnswer, type ExecuteSearchAnswerParams } from "./search-answer";
