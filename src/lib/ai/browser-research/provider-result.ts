import type {
  BrowserResearchFinding,
  BrowserResearchMockSource,
  BrowserResearchPlannedStep,
  BrowserResearchProvider,
} from "./types";

/** Shared result shape for mock, Tavily, and Browserbase providers. */
export type BrowserResearchProviderResult = {
  plannedSteps: BrowserResearchPlannedStep[];
  mockSources: BrowserResearchMockSource[];
  findings: BrowserResearchFinding[];
  estimatedWorkMinutes: number;
  estimatedCostUsd: number;
  provider: BrowserResearchProvider;
  resultCount?: number;
  fallbackReason?: string;
  liveSessionUrl?: string;
  stagehandLlmProvider?: string;
  stagehandModelId?: string;
  evidenceIds?: string[];
  reportArtifactId?: string;
  reportCostUsd?: number;
};
