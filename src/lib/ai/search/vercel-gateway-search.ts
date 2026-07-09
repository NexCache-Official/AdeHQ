import { generateText, stepCountIs } from "ai";
import { gateway } from "@ai-sdk/gateway";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveProviderCredential } from "@/lib/providers/credentials/resolve-provider-credential";
import { resolveVercelGatewayModelId } from "@/lib/ai/runtime/adapters/vercel-models";
import type { SearchMode, SearchRoute, SearchSource } from "./types";
import {
  getFastFactSearchPreset,
  getGatewaySearchCostUsd,
  getGatewaySearchModelId,
} from "./config";

export type GatewaySearchOptions = {
  query: string;
  route?: Extract<SearchRoute, "gateway_perplexity" | "gateway_exa" | "gateway_parallel">;
  searchMode?: SearchMode;
  maxResults?: number;
  recency?: "day" | "week" | "month" | "year";
  domains?: string[];
  employeeName?: string;
  workspaceId?: string;
  client?: SupabaseClient;
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

type GatewayGenerateTextResult = {
  text?: string;
  sources?: Array<{
    sourceType?: string;
    url?: string;
    title?: string;
  }>;
  steps?: Array<{
    sources?: Array<{
      sourceType?: string;
      url?: string;
      title?: string;
    }>;
    toolResults?: Array<{ output?: unknown }>;
  }>;
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

function extractSourcesFromText(text: string): SearchSource[] {
  const sources: SearchSource[] = [];
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(text)) !== null) {
    sources.push({ title: match[1].trim(), url: match[2].trim() });
  }

  const bareUrlPattern = /https?:\/\/[^\s)\]>,"']+/g;
  while ((match = bareUrlPattern.exec(text)) !== null) {
    const url = match[0].replace(/[.,;:!?)]+$/, "");
    sources.push({ title: url, url });
  }

  return sources;
}

function extractSourcesFromUnknown(value: unknown, depth = 0): SearchSource[] {
  if (depth > 6 || value == null) return [];
  if (typeof value === "string") {
    return extractSourcesFromText(value);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractSourcesFromUnknown(item, depth + 1));
  }
  if (typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const url =
    (typeof record.url === "string" && record.url) ||
    (typeof record.link === "string" && record.link) ||
    (typeof record.href === "string" && record.href);
  if (url && /^https?:\/\//i.test(url)) {
    const title =
      (typeof record.title === "string" && record.title.trim()) ||
      (typeof record.name === "string" && record.name.trim()) ||
      url;
    const snippet =
      (typeof record.snippet === "string" && record.snippet) ||
      (typeof record.content === "string" && record.content) ||
      (typeof record.description === "string" && record.description) ||
      (typeof record.text === "string" && record.text);
    return [{ title, url, snippet: snippet?.slice(0, 600) }];
  }

  const nested: SearchSource[] = [];
  for (const key of ["sources", "results", "citations", "search_results", "output", "content"]) {
    if (key in record) {
      nested.push(...extractSourcesFromUnknown(record[key], depth + 1));
    }
  }
  return nested;
}

function mergeSearchSources(...groups: SearchSource[][]): SearchSource[] {
  const seen = new Set<string>();
  const merged: SearchSource[] = [];
  for (const group of groups) {
    for (const source of group) {
      const url = source.url.trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      merged.push({
        title: source.title.trim() || url,
        url,
        snippet: source.snippet?.trim(),
      });
    }
  }
  return merged;
}

/** Extract URL sources from AI SDK generateText results (model sources + tool outputs). */
export function extractSourcesFromGenerateTextResult(
  result: GatewayGenerateTextResult,
): SearchSource[] {
  const fromModel: SearchSource[] = [];
  for (const source of result.sources ?? []) {
    if (source.sourceType === "document") continue;
    if (source.url) {
      fromModel.push({ title: source.title?.trim() || source.url, url: source.url });
    }
  }
  for (const step of result.steps ?? []) {
    for (const source of step.sources ?? []) {
      if (source.sourceType === "document") continue;
      if (source.url) {
        fromModel.push({ title: source.title?.trim() || source.url, url: source.url });
      }
    }
    for (const toolResult of step.toolResults ?? []) {
      fromModel.push(...extractSourcesFromUnknown(toolResult.output));
    }
  }
  return mergeSearchSources(fromModel, extractSourcesFromText(result.text ?? ""));
}

function buildSynthesisPromptFromSources(
  query: string,
  sources: SearchSource[],
  employeeName?: string,
  searchMode: SearchMode = "standard",
): string {
  const who = employeeName ? `${employeeName} (AI employee)` : "An AdeHQ AI employee";
  const sourceBlock = sources
    .map((source, index) => {
      const lines = [`[${index + 1}] ${source.title}`, `URL: ${source.url}`];
      if (source.snippet?.trim()) lines.push(source.snippet.trim().slice(0, 500));
      return lines.join("\n");
    })
    .join("\n\n");

  const lengthHint =
    searchMode === "fast_fact"
      ? "Answer in 2-4 short paragraphs max."
      : "Answer concisely in plain language (2-5 short paragraphs max).";

  return [
    `${who} is answering a factual question using numbered web sources.`,
    "",
    `Question: ${query.trim()}`,
    "",
    "Sources:",
    sourceBlock || "(no sources returned)",
    "",
    "Instructions:",
    `- ${lengthHint}`,
    "- Cite sources inline after each factual claim using [1], [2], etc. matching the numbered sources above.",
    "- Only state facts that are supported by the numbered sources.",
    "- For private companies, distinguish revenue vs ARR vs run-rate; say estimated/reported when appropriate.",
    "- If sources disagree, give a range and cite each supporting source.",
    "- Do not add a separate Sources section — source links are shown separately in the UI.",
    "- If the sources do not support an answer, say you could not verify from current sources.",
  ].join("\n");
}

function buildSonarFallbackPrompt(
  query: string,
  employeeName?: string,
  searchMode: SearchMode = "standard",
): string {
  const who = employeeName ? `${employeeName} (AI employee)` : "An AdeHQ AI employee";
  const lengthHint =
    searchMode === "fast_fact"
      ? "Answer in 2-4 short paragraphs max."
      : "Answer concisely in plain language (2-5 short paragraphs max).";

  return [
    `${who} is answering a factual question using live web search.`,
    "",
    `Question: ${query.trim()}`,
    "",
    "Instructions:",
    `- ${lengthHint}`,
    "- Cite sources inline after factual claims using [1], [2], etc.",
    "- For private companies, distinguish revenue vs ARR vs run-rate; say estimated/reported when appropriate.",
    "- If sources disagree, give a range and cite each.",
    "- Do not add a separate Sources section — source links are shown separately in the UI.",
    "- If you cannot verify from current sources, say so plainly.",
  ].join("\n");
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

async function runGatewaySearchQuery(
  options: GatewaySearchOptions,
  route: GatewaySearchOptions["route"],
  preset: ReturnType<typeof getFastFactSearchPreset>,
  modelId: string,
): Promise<{ sources: SearchSource[]; searchLatencyMs: number; usedTool: boolean }> {
  await loadGatewayTools();
  const toolConfig = buildToolConfig(route, options, preset);
  if (!toolConfig) {
    return { sources: [], searchLatencyMs: 0, usedTool: false };
  }

  const searchStarted = Date.now();
  const result = await generateText({
    model: gateway(modelId),
    prompt: `Search the web for current, credible information to answer: ${options.query.trim()}`,
    tools: { [toolConfig.toolName]: toolConfig.tool } as Record<string, never>,
    toolChoice: { type: "tool", toolName: toolConfig.toolName },
    stopWhen: stepCountIs(2),
    maxOutputTokens: 256,
    temperature: 0,
    abortSignal: AbortSignal.timeout(preset.timeoutMs),
  });

  return {
    sources: extractSourcesFromGenerateTextResult(result),
    searchLatencyMs: Date.now() - searchStarted,
    usedTool: true,
  };
}

async function synthesizeFromSources(
  options: GatewaySearchOptions,
  sources: SearchSource[],
  modelId: string,
  preset: ReturnType<typeof getFastFactSearchPreset>,
  searchMode: SearchMode,
): Promise<{ text: string; synthesisLatencyMs: number }> {
  const started = Date.now();
  const prompt = buildSynthesisPromptFromSources(
    options.query,
    sources,
    options.employeeName,
    searchMode,
  );
  const result = await generateText({
    model: gateway(modelId),
    prompt,
    maxOutputTokens: preset.synthesisMaxOutputTokens,
    temperature: 0.2,
    abortSignal: AbortSignal.timeout(preset.timeoutMs),
  });
  return {
    text: result.text.trim(),
    synthesisLatencyMs: Date.now() - started,
  };
}

async function runSonarSearchAnswer(
  options: GatewaySearchOptions,
  searchMode: SearchMode,
  preset: ReturnType<typeof getFastFactSearchPreset>,
): Promise<{ text: string; sources: SearchSource[]; synthesisLatencyMs: number }> {
  const started = Date.now();
  const prompt = buildSonarFallbackPrompt(options.query, options.employeeName, searchMode);
  const sonarResult = await generateText({
    model: gateway("perplexity/sonar"),
    prompt,
    maxOutputTokens: preset.synthesisMaxOutputTokens,
    temperature: 0.2,
    abortSignal: AbortSignal.timeout(preset.timeoutMs),
  });
  const text = sonarResult.text.trim();
  return {
    text,
    sources: extractSourcesFromGenerateTextResult(sonarResult),
    synthesisLatencyMs: Date.now() - started,
  };
}

/** Fast search via Vercel AI Gateway — search tool for sources, then cited synthesis. */
export async function runGatewaySearchAnswer(
  options: GatewaySearchOptions,
): Promise<GatewaySearchAnswerResult> {
  const credential = options.workspaceId
    ? await resolveProviderCredential({
        workspaceId: options.workspaceId,
        provider: "vercel_gateway",
        client: options.client,
      }).catch(() => null)
    : null;
  const apiKey = credential?.apiKey ?? process.env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("AI_GATEWAY_API_KEY is not configured.");
  }
  const previousGatewayKey = process.env.AI_GATEWAY_API_KEY;
  if (credential?.apiKey) process.env.AI_GATEWAY_API_KEY = credential.apiKey;

  try {
    const route = options.route ?? "gateway_perplexity";
    const searchMode = options.searchMode ?? "standard";
    const preset = getFastFactSearchPreset();
    const modelId =
      resolveVercelGatewayModelId({ runtimeMode: "efficient" }) || getGatewaySearchModelId();

    const searchQuery = await runGatewaySearchQuery(options, route, preset, modelId);
    let sources = searchQuery.sources;
    let text = "";
    let synthesisLatencyMs = 0;
    let usedTool = searchQuery.usedTool;
    let synthesisModel = modelId;

    if (sources.length > 0) {
      const synthesis = await synthesizeFromSources(options, sources, modelId, preset, searchMode);
      text = synthesis.text;
      synthesisLatencyMs = synthesis.synthesisLatencyMs;
    } else {
      console.warn(
        "[AdeHQ gateway search] Search tool returned no sources — falling back to perplexity/sonar.",
      );
      const sonar = await runSonarSearchAnswer(options, searchMode, preset);
      text = sonar.text;
      sources = sonar.sources;
      synthesisLatencyMs = sonar.synthesisLatencyMs;
      usedTool = false;
      synthesisModel = "perplexity/sonar";
    }

    return {
      text,
      sources,
      usedTool,
      synthesisModel,
      searchLatencyMs: searchQuery.searchLatencyMs,
      synthesisLatencyMs,
    };
  } finally {
    if (credential?.apiKey) {
      if (previousGatewayKey === undefined) delete process.env.AI_GATEWAY_API_KEY;
      else process.env.AI_GATEWAY_API_KEY = previousGatewayKey;
    }
  }
}

export function estimateGatewaySearchCostUsd(): number {
  return getGatewaySearchCostUsd();
}
