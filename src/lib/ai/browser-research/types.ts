export type BrowserResearchRunStatus =
  | "created"
  | "planning"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type BrowserResearchProvider = "mock" | "tavily" | "browserbase";

export type BrowserResearchPlannedStep = {
  title: string;
  description: string;
};

export type BrowserResearchMockSource = {
  title: string;
  url: string;
  note: string;
  evidenceId?: string;
};

export type BrowserResearchFinding = {
  title: string;
  summary: string;
};

export type BrowserResearchRun = {
  id: string;
  workspaceId: string;
  roomId?: string;
  topicId?: string;
  employeeId: string;
  createdBy: string;
  query: string;
  status: BrowserResearchRunStatus;
  provider: BrowserResearchProvider;
  workUnitId?: string;
  plannedSteps: BrowserResearchPlannedStep[];
  mockSources: BrowserResearchMockSource[];
  findings: BrowserResearchFinding[];
  estimatedWorkMinutes?: number;
  estimatedCostUsd?: number;
  errorMessage?: string;
  metadata: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export const BROWSER_RESEARCH_QUERY_MAX_LENGTH = 1000;

export const BROWSER_RESEARCH_DEFAULT_WORK_MINUTES = 15;

export const BROWSER_RESEARCH_UI_COPY = {
  skeletonBadge: "Research skeleton — not live browsing yet",
  liveBadge: "Live browser research",
  preparing: "Browser research is being prepared for this employee.",
  mockRunLabel: "Mock research run",
  tavilyRunLabel: "Search research run (Tavily)",
  browserbaseRunLabel: "Live research run (Browserbase)",
  mockSourceSection: "Mock source cards",
  searchSourceSection: "Search source cards",
  liveSourceSection: "Live source cards",
  mockFindingsSection: "Preliminary findings (mock)",
  searchFindingsSection: "Preliminary findings (search)",
  liveFindingsSection: "Preliminary findings (live browse)",
  createMockRun: "Create mock research run",
  createTavilyRun: "Create search research run",
  createBrowserbaseRun: "Create live research run",
  liveLater: "Live web browsing will be added in a later release.",
  searchNotBrowsing: "Tavily search returns real URLs and snippets — not live page browsing.",
  mockCompletedMessage:
    "Mock research run completed. Live browsing is not enabled yet.",
  tavilyCompletedMessage:
    "Search research run completed. Live web browsing is not enabled yet.",
  browserbaseCompletedMessage: "Live browser research run completed.",
  viewReport: "View report",
  evidenceSection: "Browser evidence",
} as const;

export function browserResearchRunLabel(provider: BrowserResearchProvider): string {
  if (provider === "browserbase") return BROWSER_RESEARCH_UI_COPY.browserbaseRunLabel;
  return provider === "tavily"
    ? BROWSER_RESEARCH_UI_COPY.tavilyRunLabel
    : BROWSER_RESEARCH_UI_COPY.mockRunLabel;
}

export function browserResearchCompletedMessage(provider: BrowserResearchProvider): string {
  if (provider === "browserbase") return BROWSER_RESEARCH_UI_COPY.browserbaseCompletedMessage;
  return provider === "tavily"
    ? BROWSER_RESEARCH_UI_COPY.tavilyCompletedMessage
    : BROWSER_RESEARCH_UI_COPY.mockCompletedMessage;
}

export function browserResearchSourceSectionLabel(provider: BrowserResearchProvider): string {
  if (provider === "browserbase") return BROWSER_RESEARCH_UI_COPY.liveSourceSection;
  return provider === "tavily"
    ? BROWSER_RESEARCH_UI_COPY.searchSourceSection
    : BROWSER_RESEARCH_UI_COPY.mockSourceSection;
}

export function browserResearchFindingsSectionLabel(provider: BrowserResearchProvider): string {
  if (provider === "browserbase") return BROWSER_RESEARCH_UI_COPY.liveFindingsSection;
  return provider === "tavily"
    ? BROWSER_RESEARCH_UI_COPY.searchFindingsSection
    : BROWSER_RESEARCH_UI_COPY.mockFindingsSection;
}

export const BROWSER_RESEARCH_FORBIDDEN_COPY = [
  "live browsing now",
  "browsing the web now",
  "sources verified",
  "report complete",
  "verified citation",
] as const;
