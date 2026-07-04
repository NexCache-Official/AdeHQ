export {
  canEmployeeUseBrowserResearch,
  getBrowserResearchAccessLabel,
  assertBrowserResearchAllowed,
  getEmployeeBrowserAccess,
  BrowserResearchPermissionError,
} from "./permissions";

export {
  BROWSER_RESEARCH_DEFAULT_WORK_MINUTES,
  BROWSER_RESEARCH_FORBIDDEN_COPY,
  BROWSER_RESEARCH_QUERY_MAX_LENGTH,
  BROWSER_RESEARCH_UI_COPY,
  browserResearchCompletedMessage,
  browserResearchFindingsSectionLabel,
  browserResearchRunLabel,
  browserResearchSourceSectionLabel,
  type BrowserResearchFinding,
  type BrowserResearchMockSource,
  type BrowserResearchPlannedStep,
  type BrowserResearchProvider,
  type BrowserResearchRun,
  type BrowserResearchRunStatus,
} from "./types";

export {
  getBrowserResearchProviderConfig,
  getBrowserResearchProviderPref,
  getBrowserResearchMaxPages,
  getBrowserResearchMaxSeconds,
  isBrowserResearchEvidenceEnabled,
  isBrowserResearchLiveEnabled,
  isBrowserResearchLiveReady,
  isBrowserbaseConfigured,
  isTavilyConfigured,
  resolveBrowserResearchProvider,
  resolveBrowserResearchProviderForQuery,
  isFastSearchQuery,
} from "./provider-config";

export type { BrowserResearchProviderResult } from "./provider-result";

export { runMockBrowserResearchProvider, type BrowserResearchMockResult } from "./mock-provider";

export {
  buildTavilyFindingsFromResults,
  estimateTavilyResearchWorkMinutes,
  mapTavilyResultsToSourceCards,
  runTavilyBrowserResearchProvider,
  tavilySearch,
  type TavilySearchResponse,
  type TavilySearchResult,
} from "./tavily-provider";

export {
  getBrowserResearchRuntimeDispatch,
  observeBrowserResearchRuntimeShadowSafely,
  recordBrowserResearchRuntimeShadow,
  setBrowserResearchShadowTestHooks,
  shouldExecuteBrowserResearchViaRuntime,
  shouldShadowBrowserResearch,
  type BrowserResearchRuntimeDispatch,
  type BrowserResearchShadowTestHooks,
} from "./runtime-shadow";
