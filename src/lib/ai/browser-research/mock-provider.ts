import type { BrowserResearchProviderResult } from "./provider-result";
import type {
  BrowserResearchFinding,
  BrowserResearchMockSource,
  BrowserResearchPlannedStep,
} from "./types";

const MOCK_SOURCE_BASE = "https://example.mock/adehq/research";

function truncateQuery(query: string, max = 48): string {
  const trimmed = query.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export type BrowserResearchMockResult = BrowserResearchProviderResult;

/** Mock research provider — no live web calls. All outputs are clearly simulated. */
export function runMockBrowserResearchProvider(query: string): BrowserResearchProviderResult {
  const topic = truncateQuery(query);
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "topic";

  const plannedSteps: BrowserResearchPlannedStep[] = [
    {
      title: "Clarify research scope (mock)",
      description: `Break down the question "${topic}" into searchable themes. Simulated only — no live browsing.`,
    },
    {
      title: "Collect mock source cards (mock)",
      description:
        "Prepare example source cards with safe placeholder URLs. These are not real web results.",
    },
    {
      title: "Draft preliminary findings (mock)",
      description:
        "Summarize simulated takeaways for review. Final verified reports arrive in a later release.",
    },
  ];

  const mockSources: BrowserResearchMockSource[] = [
    {
      title: `[Mock] Overview — ${topic}`,
      url: `${MOCK_SOURCE_BASE}/${slug}/overview`,
      note: "Simulated source card — not fetched from the web.",
    },
    {
      title: `[Mock] Landscape scan — ${topic}`,
      url: `${MOCK_SOURCE_BASE}/${slug}/landscape`,
      note: "Simulated placeholder scan for skeleton testing — not real web data.",
    },
    {
      title: `[Mock] Signals & trends — ${topic}`,
      url: `${MOCK_SOURCE_BASE}/${slug}/signals`,
      note: "Mock trend notes only — not real web citations.",
    },
  ];

  const findings: BrowserResearchFinding[] = [
    {
      title: "Mock finding — scope",
      summary: `Simulated scope summary for "${topic}". Live browser research is not enabled yet.`,
    },
    {
      title: "Mock finding — themes",
      summary:
        "Three placeholder themes were generated for planning review. Replace with real search in V20.0.1.",
    },
    {
      title: "Mock finding — next steps",
      summary:
        "When Tavily search lands, this step will fetch real sources. For now, treat all output as mock.",
    },
  ];

  return {
    plannedSteps,
    mockSources,
    findings,
    estimatedWorkMinutes: 15,
    estimatedCostUsd: 0,
    provider: "mock",
  };
}
