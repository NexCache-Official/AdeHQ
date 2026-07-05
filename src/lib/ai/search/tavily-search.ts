import { tavilySearch, mapTavilyResultsToSourceCards } from "@/lib/ai/browser-research/tavily-provider";
import { getTavilySearchCostUsd } from "@/lib/ai/browser-research/provider-config";
import { generateText } from "ai";
import { siliconFlowChatModel } from "@/lib/ai/siliconflow-client";
import { resolveModel, getOutputTokenCap } from "@/lib/ai/model-catalog";
import { SILICONFLOW_CHEAP_MODEL } from "@/lib/config/features";
import type { SearchSource } from "./types";
import { isTavilySearchConfigured } from "./config";

export type TavilySearchAnswerOptions = {
  query: string;
  maxResults?: number;
  employeeName?: string;
};

function buildTavilySynthesisPrompt(
  query: string,
  results: Array<{ title: string; url: string; content: string }>,
  employeeName?: string,
): string {
  const who = employeeName ? employeeName : "The AI employee";
  const sourceBlock = results
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content.slice(0, 600)}`)
    .join("\n\n");

  return [
    `${who} is answering a quick factual question using Tavily search snippets.`,
    "",
    `Question: ${query.trim()}`,
    "",
    "Search results:",
    sourceBlock || "(no results)",
    "",
    "Write a concise answer. Note uncertainty for private-company revenue/funding.",
    "End with Sources as markdown links [title](url).",
  ].join("\n");
}

export async function runTavilySearchAnswer(
  options: TavilySearchAnswerOptions,
): Promise<{ text: string; sources: SearchSource[] }> {
  if (!isTavilySearchConfigured()) {
    throw new Error("TAVILY_API_KEY is not configured.");
  }

  const response = await tavilySearch({
    query: options.query,
    maxResults: options.maxResults ?? 5,
  });

  const results = (response.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));

  const sources = mapTavilyResultsToSourceCards(results).map((s) => ({
    title: s.title,
    url: s.url,
    snippet: s.note,
  }));

  if (response.answer?.trim()) {
    return { text: response.answer.trim(), sources };
  }

  const model = resolveModel("siliconflow", "cheap", SILICONFLOW_CHEAP_MODEL);
  const { text } = await generateText({
    model: siliconFlowChatModel(model),
    prompt: buildTavilySynthesisPrompt(options.query, results, options.employeeName),
    maxOutputTokens: Math.min(900, getOutputTokenCap("cheap")),
    temperature: 0.2,
  });

  return { text: text.trim(), sources };
}

export function estimateTavilySearchAnswerCostUsd(): number {
  return getTavilySearchCostUsd();
}
