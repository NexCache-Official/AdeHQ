import { generateText, stepCountIs } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { resolveVercelGatewayModelId } from "@/lib/ai/runtime/adapters/vercel-models";
import type { SearchRoute, SearchSource } from "./types";
import {
  getGatewaySearchCostUsd,
  getGatewaySearchModelId,
  isGatewaySearchConfigured,
} from "./config";

export type GatewaySearchOptions = {
  query: string;
  route?: Extract<SearchRoute, "gateway_perplexity" | "gateway_exa" | "gateway_parallel">;
  maxResults?: number;
  recency?: "day" | "week" | "month" | "year";
  domains?: string[];
  employeeName?: string;
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

function buildSearchPrompt(query: string, employeeName?: string): string {
  const who = employeeName ? `${employeeName} (AI employee)` : "An AdeHQ AI employee";
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
    "- End with a short Sources section listing markdown links [title](url) when URLs are available.",
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
): { toolName: string; tool: unknown } | null {
  const common = {
    maxResults: opts.maxResults ?? 5,
    maxTokens: 20_000,
    maxTokensPerPage: 2048,
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
        numResults: opts.maxResults ?? 5,
        ...(opts.domains?.length ? { includeDomains: opts.domains } : {}),
      }),
    };
  }

  if (route === "gateway_parallel" && cachedGatewayTools.parallelSearch) {
    return {
      toolName: "parallel_search",
      tool: cachedGatewayTools.parallelSearch({
        mode: "one-shot",
        maxResults: opts.maxResults ?? 5,
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
): Promise<{ text: string; sources: SearchSource[] }> {
  const sonarResult = await generateText({
    model: gateway("perplexity/sonar"),
    prompt,
    maxOutputTokens: 1200,
    temperature: 0.2,
  });
  const text = sonarResult.text.trim();
  return {
    text,
    sources: extractSourcesFromText(text),
  };
}

/** Fast search via Vercel AI Gateway search tools, with sonar model fallback. */
export async function runGatewaySearchAnswer(
  options: GatewaySearchOptions,
): Promise<{ text: string; sources: SearchSource[]; usedTool: boolean }> {
  if (!isGatewaySearchConfigured()) {
    throw new Error("AI_GATEWAY_API_KEY is not configured.");
  }

  const route = options.route ?? "gateway_perplexity";
  const prompt = buildSearchPrompt(options.query, options.employeeName);
  const modelId =
    resolveVercelGatewayModelId({ runtimeMode: "efficient" }) || getGatewaySearchModelId();

  await loadGatewayTools();
  const toolConfig = buildToolConfig(route, options);

  if (toolConfig) {
    const tools = { [toolConfig.toolName]: toolConfig.tool } as Record<string, never>;
    const result = await generateText({
      model: gateway(modelId),
      prompt,
      tools,
      stopWhen: stepCountIs(5),
      maxOutputTokens: 1200,
      temperature: 0.2,
    });

    const text = result.text.trim();
    if (text.length > 0) {
      return {
        text,
        sources: extractSourcesFromText(text),
        usedTool: true,
      };
    }

    console.warn(
      "[AdeHQ gateway search] Tool path returned empty text — falling back to perplexity/sonar.",
    );
  }

  const sonar = await runSonarSearchAnswer(prompt);
  return {
    text: sonar.text,
    sources: sonar.sources,
    usedTool: false,
  };
}

export function estimateGatewaySearchCostUsd(): number {
  return getGatewaySearchCostUsd();
}
