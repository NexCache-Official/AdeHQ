import { estimateWorkMinutesFromCost } from "@/lib/ai/work-hours/estimate";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveProviderCredential } from "@/lib/providers/credentials/resolve-provider-credential";
import { recordCredentialEvent } from "@/lib/providers/credentials/record-credential-event";
import { getTavilyMaxResults, getTavilySearchCostUsd } from "./provider-config";
import type { BrowserResearchProviderResult } from "./provider-result";
import type { BrowserResearchMockSource } from "./types";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
  score?: number;
};

export type TavilySearchResponse = {
  query?: string;
  results?: TavilySearchResult[];
  answer?: string;
};

export function estimateTavilyResearchWorkMinutes(
  costUsd: number,
  resultCount: number,
): number {
  const fromCost = estimateWorkMinutesFromCost(costUsd);
  const perResultMinutes = Math.max(0, resultCount) * 0.25;
  const total = fromCost + perResultMinutes;
  return Math.max(1, Math.round(total * 100) / 100);
}

export function mapTavilyResultsToSourceCards(results: TavilySearchResult[]): BrowserResearchMockSource[] {
  return results.map((result) => ({
    title: result.title.trim() || "Untitled source",
    url: result.url.trim(),
    note: result.content.trim().slice(0, 280) || "Snippet returned by Tavily search — not live page browsing.",
  }));
}

export function buildTavilyFindingsFromResults(
  query: string,
  results: TavilySearchResult[],
): BrowserResearchProviderResult["findings"] {
  if (results.length === 0) {
    return [
      {
        title: "No search results",
        summary: `Tavily returned no sources for "${query.slice(0, 80)}". Try refining the question.`,
      },
    ];
  }

  return results.slice(0, 5).map((result, index) => ({
    title: result.title.trim() || `Source ${index + 1}`,
    summary:
      result.content.trim().slice(0, 400) ||
      "Search snippet available — live page browsing is not enabled yet.",
  }));
}

export type TavilySearchOptions = {
  query: string;
  apiKey?: string;
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
  fetchImpl?: typeof fetch;
  workspaceId?: string;
  client?: SupabaseClient;
};

export async function tavilySearch(options: TavilySearchOptions): Promise<TavilySearchResponse> {
  const resolved = options.apiKey
    ? null
    : options.workspaceId
      ? await resolveProviderCredential({
          workspaceId: options.workspaceId,
          provider: "tavily",
          client: options.client,
        }).catch(() => null)
      : null;
  const apiKey = options.apiKey ?? resolved?.apiKey ?? process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is not configured.");
  }

  const fetchFn = options.fetchImpl ?? fetch;
  const response = await fetchFn(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: options.query,
      search_depth: options.searchDepth ?? "basic",
      max_results: options.maxResults ?? getTavilyMaxResults(),
      include_answer: false,
    }),
  });

  if (!response.ok) {
    if (resolved?.credentialId && options.client) {
      void recordCredentialEvent(options.client, {
        credentialId: resolved.credentialId,
        workspaceId: options.workspaceId,
        provider: "tavily",
        eventType: "failed",
        reason: `Tavily search failed (${response.status}).`,
      });
    }
    const detail = await response.text().catch(() => "");
    throw new Error(`Tavily search failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  if (resolved?.credentialId && options.client) {
    void recordCredentialEvent(options.client, {
      credentialId: resolved.credentialId,
      workspaceId: options.workspaceId,
      provider: "tavily",
      eventType: "used",
      metadata: { source: resolved.source },
    });
  }
  return (await response.json()) as TavilySearchResponse;
}

/** Tavily search provider — real web search snippets, no live page browsing. */
export async function runTavilyBrowserResearchProvider(
  query: string,
  options?: { fetchImpl?: typeof fetch; apiKey?: string; workspaceId?: string; client?: SupabaseClient },
): Promise<BrowserResearchProviderResult> {
  const trimmed = query.trim();
  const maxResults = getTavilyMaxResults();
  const baseCostUsd = getTavilySearchCostUsd();

  const plannedSteps = [
    {
      title: "Plan search query (Tavily)",
      description: `Prepare a focused web search for "${trimmed.slice(0, 64)}". Search only — no live page navigation.`,
    },
    {
      title: "Execute Tavily web search",
      description: "Query Tavily for real URLs and snippets. This is search, not live browser browsing.",
    },
    {
      title: "Summarize preliminary findings",
      description: "Draft findings from returned snippets for review. Full browser research arrives in a later release.",
    },
  ];

  const response = await tavilySearch({
    query: trimmed,
    apiKey: options?.apiKey,
    workspaceId: options?.workspaceId,
    client: options?.client,
    maxResults,
    fetchImpl: options?.fetchImpl,
  });

  const results = (response.results ?? []).filter((row) => row.url?.trim());
  const mockSources = mapTavilyResultsToSourceCards(results);
  const findings = buildTavilyFindingsFromResults(trimmed, results);

  const resultCount = results.length;
  const estimatedCostUsd =
    Math.round((baseCostUsd + resultCount * 0.0005) * 1_000_000) / 1_000_000;
  const estimatedWorkMinutes = estimateTavilyResearchWorkMinutes(estimatedCostUsd, resultCount);

  return {
    plannedSteps,
    mockSources,
    findings,
    estimatedWorkMinutes,
    estimatedCostUsd,
    provider: "tavily",
    resultCount,
  };
}
