import { generateText, stepCountIs } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { resolveVercelGatewayModelId } from "@/lib/ai/runtime/adapters/vercel-models";
import type { SearchMode, SearchRoute, SearchSource } from "./types";
import {
  getFastFactSearchPreset,
  getGatewaySearchCostUsd,
  getGatewaySearchModelId,
  isGatewaySearchConfigured,
} from "./config";

export type GatewaySearchOptions = {
  query: string;
  route?: Extract<SearchRoute, "gateway_perplexity" | "gateway_exa" | "gateway_parallel">;
  searchMode?: SearchMode;
  maxResults?: number;
  recency?: "day" | "week" | "month" | "year";
  domains?: string[];
  employeeName?: string;
};

export type GatewaySearchAnswerResult = {
  text: string;
  sources: SearchSource[];
  usedTool: boolean;
  synthesisModel: string;
  searchLatencyMs: number;
  synthesisLatencyMs: number;
};

type GatewayToolsModule = {
  perplexitySearch?: (opts?: Record<string, unknown>) => unknown;
  exaSearch?: (opts?: Record<string, unknown>) => unknown;
  parallelSearch?: (opts?: Record<string, unknown>) => unknown;
};

let cachedGatewayTools: GatewayToolsModule | null | undefined;

async function loadGatewayTools(): Promise<GatewayToolsModule | null> {
  if (cachedGatewayTools !== undefined) return cachedGatewayTools;
  try {
    const aiModule = (await import("ai")) as {
      gateway?: { tools?: GatewayToolsModule };
    };
    cachedGatewayTools = aiModule.gateway?.tools ?? null;
  } catch {
    cachedGatewayTools = null;
  }
  return cachedGatewayTools;
}

function buildSearchPrompt(
  query: string,
  employeeName?: string,
  searchMode: SearchMode = "standard",
): string {
  const who = employeeName ? `${employeeName} (AI employee)` : "An AdeHQ AI employee";
  if (searchMode === "fast_fact") {
    return [
      `${who} is answering a quick factual question in chat.`,
      "",
      `Question: ${query.trim()}`,
      "",
      "Instructions:",
      "- Answer in 2-4 short paragraphs max.",
      "- For private companies, distinguish revenue vs ARR vs run-rate; say estimated/reported, not audited.",
      "- Give a range when sources disagree; name the best-supported estimate.",
      "- Do not include a Sources section or markdown links — sources are shown separately.",
      "- If you cannot verify, say so plainly.",
    ].join("\n");
  }

  return [
    `${who} is answering a quick factual question in chat.`,
    "",
    `Question: ${query.trim()}`,
    "",
    "Instructions:",
    "- Use web search tools to find current, credible sources.",
    "- Answer concisely in plain language (2-5 short paragraphs max).",
    "- For private companies, say when revenue/funding figures are estimates or ARR run-rate, not audited annual revenue.",
    "- Do not invent a single exact number when sources disagree — give a range or the best-supported estimate.",
    "- Do not include a Sources section — sources are shown separately.",
    "- If sources are weak or conflicting, say so explicitly.",
  ].join("\n");
}

function extractSourcesFromText(text: string): SearchSource[] {
  const sources: SearchSource[] = [];
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(text)) !== null) {
    sources.push({ title: match[1].trim(), url: match[2].trim() });
  }
  return sources;
}

function buildToolConfig(
  route: GatewaySearchOptions["route"],
  opts: GatewaySearchOptions,
  preset = getFastFactSearchPreset(),
): { toolName: string; tool: unknown } | null {
  const common = {
    maxResults: opts.maxResults ?? preset.maxResults,
    maxTokens: preset.maxTokens,
    maxTokensPerPage: preset.maxTokensPerPage,
    country: "US",
    searchLanguageFilter: ["en"],
    ...(opts.recency ? { searchRecencyFilter: opts.recency } : {}),
    ...(opts.domains?.length ? { searchDomainFilter: opts.domains } : {}),
  };

  if (!cachedGatewayTools) return null;

  if (route === "gateway_exa" && cachedGatewayTools.exaSearch) {
    return {
      toolName: "exa_search",
      tool: cachedGatewayTools.exaSearch({
        type: "fast",
        numResults: opts.maxResults ?? preset.maxResults,
        ...(opts.domains?.length ? { includeDomains: opts.domains } : {}),
      }),
    };
  }

  if (route === "gateway_parallel" && cachedGatewayTools.parallelSearch) {
    return {
      toolName: "parallel_search",
      tool: cachedGatewayTools.parallelSearch({
        mode: "one-shot",
        maxResults: opts.maxResults ?? preset.maxResults,
      }),
    };
  }

  if (cachedGatewayTools.perplexitySearch) {
    return {
      toolName: "perplexity_search",
      tool: cachedGatewayTools.perplexitySearch(common),
    };
  }

  return null;
}

async function runSonarSearchAnswer(
  prompt: string,
  maxOutputTokens: number,
  timeoutMs: number,
): Promise<{ text: string; sources: SearchSource[]; synthesisLatencyMs: number }> {
  const started = Date.now();
  const sonarResult = await generateText({
    model: gateway("perplexity/sonar"),
    prompt,
    maxOutputTokens,
    temperature: 0.2,
    abortSignal: AbortSignal.timeout(timeoutMs),
  });
  const text = sonarResult.text.trim();
  return {
    text,
    sources: extractSourcesFromText(text),
    synthesisLatencyMs: Date.now() - started,
  };
}

/** Fast search via Vercel AI Gateway search tools, with sonar model fallback. */
export async function runGatewaySearchAnswer(
  options: GatewaySearchOptions,
): Promise<GatewaySearchAnswerResult> {
  if (!isGatewaySearchConfigured()) {
    throw new Error("AI_GATEWAY_API_KEY is not configured.");
  }

  const route = options.route ?? "gateway_perplexity";
  const searchMode = options.searchMode ?? "standard";
  const preset = getFastFactSearchPreset();
  const prompt = buildSearchPrompt(options.query, options.employeeName, searchMode);
  const modelId =
    resolveVercelGatewayModelId({ runtimeMode: "efficient" }) || getGatewaySearchModelId();
  const synthesisModel =
    searchMode === "fast_fact" ? "perplexity/sonar" : modelId;
  const totalStarted = Date.now();

  if (searchMode === "fast_fact") {
    const sonar = await runSonarSearchAnswer(
      prompt,
      preset.synthesisMaxOutputTokens,
      preset.timeoutMs,
    );
    return {
      text: sonar.text,
      sources: sonar.sources,
      usedTool: false,
      synthesisModel: "perplexity/sonar",
      searchLatencyMs: 0,
      synthesisLatencyMs: sonar.synthesisLatencyMs,
    };
  }

  await loadGatewayTools();
  const toolConfig = buildToolConfig(route, options, preset);

  if (toolConfig) {
    const toolStarted = Date.now();
    const tools = { [toolConfig.toolName]: toolConfig.tool } as Record<string, never>;
    const result = await generateText({
      model: gateway(modelId),
      prompt,
      tools,
      stopWhen: stepCountIs(3),
      maxOutputTokens: preset.synthesisMaxOutputTokens,
      temperature: 0.2,
      abortSignal: AbortSignal.timeout(preset.timeoutMs),
    });

    const text = result.text.trim();
    const searchLatencyMs = Date.now() - toolStarted;
    if (text.length > 0) {
      return {
        text,
        sources: extractSourcesFromText(text),
        usedTool: true,
        synthesisModel: modelId,
        searchLatencyMs,
        synthesisLatencyMs: searchLatencyMs,
      };
    }

    console.warn(
      "[AdeHQ gateway search] Tool path returned empty text — falling back to perplexity/sonar.",
    );
  }

  const sonar = await runSonarSearchAnswer(
    prompt,
    preset.synthesisMaxOutputTokens,
    preset.timeoutMs,
  );
  return {
    text: sonar.text,
    sources: sonar.sources,
    usedTool: false,
    synthesisModel: "perplexity/sonar",
    searchLatencyMs: Date.now() - totalStarted - sonar.synthesisLatencyMs,
    synthesisLatencyMs: sonar.synthesisLatencyMs,
  };
}

export function estimateGatewaySearchCostUsd(): number {
  return getGatewaySearchCostUsd();
}
