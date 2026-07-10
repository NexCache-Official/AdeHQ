import Exa from "exa-js";
import {
  getExaNumResults,
  getExaSearchCostUsd,
  getExaSearchType,
  getFastFactSearchPreset,
  isExaSearchConfigured,
} from "./config";
import { synthesizeAnswerFromSources } from "./search-synthesis";
import type { SearchMode, SearchSource } from "./types";

export type ExaSearchAnswerOptions = {
  query: string;
  maxResults?: number;
  employeeName?: string;
  searchMode?: SearchMode;
};

function getExaClient(): Exa {
  const apiKey = process.env.EXA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("EXA_API_KEY is not configured.");
  }
  return new Exa(apiKey);
}

export function mapExaResultsToSources(
  results: Array<{
    title?: string | null;
    url: string;
    highlights?: string[] | null;
    text?: string | null;
  }>,
): SearchSource[] {
  return results.map((result) => {
    const snippet =
      (Array.isArray(result.highlights) && result.highlights.length > 0
        ? result.highlights.join(" ")
        : undefined) ||
      result.text?.slice(0, 600);
    return {
      title: result.title?.trim() || result.url,
      url: result.url,
      snippet,
    };
  });
}

/** Direct Exa search — retrieval via exa-js, cited synthesis via shared pipeline. */
export async function runExaSearchAnswer(
  options: ExaSearchAnswerOptions,
): Promise<{
  text: string;
  sources: SearchSource[];
  synthesisModel: string;
  searchLatencyMs: number;
  synthesisLatencyMs: number;
}> {
  if (!isExaSearchConfigured()) {
    throw new Error("EXA_API_KEY is not configured.");
  }

  const preset = getFastFactSearchPreset();
  const searchStarted = Date.now();
  const exa = getExaClient();
  const response = await exa.search(options.query, {
    type: getExaSearchType() as "auto",
    numResults: options.maxResults ?? getExaNumResults(),
    contents: { highlights: true },
  });

  const rawResults = (response.results ?? []) as Array<{
    title?: string | null;
    url: string;
    highlights?: string[] | null;
    text?: string | null;
  }>;
  const sources = mapExaResultsToSources(rawResults);
  const searchLatencyMs = Date.now() - searchStarted;

  if (sources.length === 0) {
    return {
      text: "",
      sources: [],
      synthesisModel: "exa",
      searchLatencyMs,
      synthesisLatencyMs: 0,
    };
  }

  const synthesis = await synthesizeAnswerFromSources({
    query: options.query,
    sources,
    employeeName: options.employeeName,
    searchMode: options.searchMode,
    timeoutMs: preset.timeoutMs,
  });

  return {
    text: synthesis.text,
    sources,
    synthesisModel: `exa+${synthesis.synthesisModel}`,
    searchLatencyMs,
    synthesisLatencyMs: synthesis.synthesisLatencyMs,
  };
}

export function estimateExaSearchCostUsd(): number {
  return getExaSearchCostUsd();
}
