import {
  createAiWorkUnit,
  startAiWorkUnit,
  completeAiWorkUnit,
  failAiWorkUnit,
} from "@/lib/supabase/ai-work-units";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decideSearchRoute, isGatewaySearchRoute } from "./search-router";
import {
  getGatewaySearchWorkMinutes,
  isGatewaySearchConfigured,
  isTavilySearchConfigured,
} from "./config";
import { runGatewaySearchAnswer, estimateGatewaySearchCostUsd } from "./vercel-gateway-search";
import { runTavilySearchAnswer, estimateTavilySearchAnswerCostUsd } from "./tavily-search";
import type { SearchAnswerResult, SearchNeed, SearchRoute, SearchRouteDecision } from "./types";
import { estimateWorkMinutesFromCost } from "@/lib/ai/work-hours/estimate";
import {
  buildSearchSourcesArtifact,
  buildWebSourcesArtifact,
  ensurePrivateCompanyWording,
  normalizeGatewaySearchSources,
  stripInlineSourcesSection,
} from "./source-normalizer";
import type { MessageArtifact } from "@/lib/types";
import {
  cachedAnswerToSearchResult,
  getSearchCache,
  setSearchCache,
} from "./search-cache";

export type ExecuteSearchAnswerParams = {
  client?: SupabaseClient;
  workspaceId: string;
  roomId: string;
  topicId: string;
  employeeId: string;
  query: string;
  employeeName?: string;
  preferAgentMode?: boolean;
  agentRunId?: string;
  routeOverride?: SearchRoute;
};

const SEARCH_UNAVAILABLE_MESSAGE =
  "I couldn't verify that with current web sources. I can answer from general knowledge with clear uncertainty, or try again if you want me to re-run search.";

const NO_SOURCES_MESSAGE =
  "I searched but couldn't find credible sources to verify that. I'd rather not guess — want me to try a broader search?";

function buildDecision(params: ExecuteSearchAnswerParams): SearchRouteDecision {
  if (params.routeOverride) {
    const routed = decideSearchRoute(params.query, { preferAgentMode: params.preferAgentMode });
    return {
      need: routed.need === "none" ? "current_fact" : routed.need,
      route: params.routeOverride,
      browserRequired: params.routeOverride === "browserbase",
      searchMode: routed.searchMode ?? "fast_fact",
      reason: "route_override",
      maxResults: routed.maxResults ?? 5,
      recency: routed.recency,
      estimatedWorkMinutes: isGatewaySearchRoute(params.routeOverride) ? 1.5 : 2,
    };
  }
  return decideSearchRoute(params.query, { preferAgentMode: params.preferAgentMode });
}

export async function executeSearchAnswer(
  params: ExecuteSearchAnswerParams,
): Promise<SearchAnswerResult> {
  const decision = buildDecision(params);
  const searchMode = decision.searchMode ?? "standard";
  const totalStarted = Date.now();

  if (decision.browserRequired || decision.route === "browserbase" || decision.route === "none") {
    if (decision.route === "none") {
      return {
        answer: SEARCH_UNAVAILABLE_MESSAGE,
        sources: [],
        route: "none",
        providerRoute: "model_fallback",
        estimatedCostUsd: 0,
        estimatedWorkMinutes: 0,
      };
    }
    throw new Error("Browser research must not run through executeSearchAnswer.");
  }

  let workUnitId: string | undefined;
  if (params.client) {
    const workUnit = await createAiWorkUnit(params.client, {
      workspaceId: params.workspaceId,
      roomId: params.roomId,
      topicId: params.topicId,
      employeeId: params.employeeId,
      workType: isGatewaySearchRoute(decision.route) ? "gateway_search_answer" : "quick_web_search",
      capability: "research_planning",
      providerRoute: isGatewaySearchRoute(decision.route) ? "vercel_gateway" : undefined,
      providerName: isGatewaySearchRoute(decision.route) ? "vercel_gateway" : "tavily",
      estimatedWorkMinutes: decision.estimatedWorkMinutes,
      metadata: {
        query: params.query.slice(0, 500),
        searchRoute: decision.route,
        searchMode,
        searchNeed: decision.need,
        agentRunId: params.agentRunId,
      },
    });
    workUnitId = workUnit.id;
    await startAiWorkUnit(params.client, params.workspaceId, workUnitId);
  }

  try {
    if (params.client) {
      const cached = await getSearchCache(
        params.client,
        params.workspaceId,
        params.query,
      );
      if (cached?.answer?.trim()) {
        const cachedResult = cachedAnswerToSearchResult(cached);
        if (workUnitId) {
          await completeAiWorkUnit(params.client, params.workspaceId, workUnitId, {
            actualWorkMinutes: 0,
            actualCostUsd: 0,
            metadata: {
              cacheHit: true,
              cacheKey: cached.cacheKey,
              hitCount: cached.hitCount + 1,
            },
          });
        }
        return cachedResult;
      }
    }

    let text = "";
    let rawSources: SearchAnswerResult["sources"] = [];
    let providerRoute: SearchAnswerResult["providerRoute"] = "model_fallback";
    let estimatedCostUsd = 0;
    let estimatedWorkMinutes = decision.estimatedWorkMinutes;
    let synthesisModel = "unknown";
    let searchLatencyMs = 0;
    let synthesisLatencyMs = 0;

    const tryGateway =
      isGatewaySearchRoute(decision.route) && isGatewaySearchConfigured();
    const tryTavily =
      (decision.route === "tavily" || !tryGateway) && isTavilySearchConfigured();

    if (tryGateway) {
      const gatewayRoute = decision.route as Extract<
        SearchRoute,
        "gateway_perplexity" | "gateway_exa" | "gateway_parallel"
      >;
      const result = await runGatewaySearchAnswer({
        query: params.query,
        route: gatewayRoute,
        searchMode,
        maxResults: decision.maxResults,
        recency: decision.recency,
        domains: decision.domains,
        employeeName: params.employeeName,
        workspaceId: params.workspaceId,
        client: params.client,
      });
      text = result.text;
      rawSources = result.sources;
      providerRoute = "vercel_gateway";
      estimatedCostUsd = estimateGatewaySearchCostUsd();
      estimatedWorkMinutes = getGatewaySearchWorkMinutes();
      synthesisModel = result.synthesisModel;
      searchLatencyMs = result.searchLatencyMs;
      synthesisLatencyMs = result.synthesisLatencyMs;

      if (!text.trim() && isTavilySearchConfigured()) {
        const tavilyStarted = Date.now();
        const tavilyResult = await runTavilySearchAnswer({
          query: params.query,
          maxResults: decision.maxResults,
          employeeName: params.employeeName,
        });
        text = tavilyResult.text;
        rawSources = tavilyResult.sources;
        providerRoute = "tavily";
        estimatedCostUsd = estimateTavilySearchAnswerCostUsd();
        estimatedWorkMinutes = Math.max(1, estimateWorkMinutesFromCost(estimatedCostUsd));
        synthesisModel = "tavily";
        synthesisLatencyMs = Date.now() - tavilyStarted;
      }
    } else if (tryTavily) {
      const tavilyStarted = Date.now();
      const result = await runTavilySearchAnswer({
        query: params.query,
        maxResults: decision.maxResults,
        employeeName: params.employeeName,
      });
      text = result.text;
      rawSources = result.sources;
      providerRoute = "tavily";
      estimatedCostUsd = estimateTavilySearchAnswerCostUsd();
      estimatedWorkMinutes = Math.max(1, estimateWorkMinutesFromCost(estimatedCostUsd));
      synthesisModel = "tavily";
      synthesisLatencyMs = Date.now() - tavilyStarted;
    } else {
      return {
        answer: SEARCH_UNAVAILABLE_MESSAGE,
        sources: [],
        route: decision.route,
        providerRoute: "model_fallback",
        estimatedCostUsd: 0,
        estimatedWorkMinutes: 0,
      };
    }

    const normalized = normalizeGatewaySearchSources(rawSources, params.query, {
      maxUsed: 5,
      searchNeed: decision.need,
    });

    text = stripInlineSourcesSection(text);
    text = ensurePrivateCompanyWording(text, params.query, decision.need);

    if (!text.trim()) {
      return {
        answer: SEARCH_UNAVAILABLE_MESSAGE,
        sources: [],
        route: decision.route,
        providerRoute: "model_fallback",
        estimatedCostUsd: 0,
        estimatedWorkMinutes: 0,
      };
    }

    if (normalized.usedSourceCount === 0 && normalized.sourceCount === 0) {
      return {
        answer: NO_SOURCES_MESSAGE,
        sources: [],
        route: decision.route,
        providerRoute,
        estimatedCostUsd,
        estimatedWorkMinutes,
      };
    }

    const totalLatencyMs = Date.now() - totalStarted;
    const searchMeta = {
      searchRoute: decision.route,
      searchNeed: decision.need as SearchNeed,
      searchMode,
      browserRequired: false as const,
      searchRequests: 1,
      sourceCount: normalized.sourceCount,
      usedSourceCount: normalized.usedSourceCount,
      excludedSourceCount: normalized.excludedSourceCount,
      searchCostUsd: estimatedCostUsd,
      synthesisModel,
      totalLatencyMs,
      searchLatencyMs,
      synthesisLatencyMs,
      excludedSourceReasons: normalized.excluded
        .map((source) => source.excludedReason)
        .filter(Boolean) as string[],
    };

    if (params.client && workUnitId) {
      await completeAiWorkUnit(params.client, params.workspaceId, workUnitId, {
        actualWorkMinutes: estimatedWorkMinutes,
        actualCostUsd: estimatedCostUsd,
        metadata: {
          sourceCount: normalized.sourceCount,
          usedSourceCount: normalized.usedSourceCount,
          excludedSourceCount: normalized.excludedSourceCount,
          totalLatencyMs,
        },
      });
    }

    const webArtifact =
      normalized.usedSourceCount > 0 ? buildWebSourcesArtifact(normalized) : undefined;

    const result = {
      answer: text,
      sources: normalized.used.map((source) => ({
        title: source.title,
        url: source.url,
        snippet: source.snippet,
      })),
      route: decision.route,
      providerRoute,
      estimatedCostUsd,
      estimatedWorkMinutes,
      searchMeta,
      webSourcesArtifact: webArtifact,
      searchSourcesArtifact: webArtifact,
    };

    if (params.client && result.answer.trim()) {
      await setSearchCache(params.client, params.workspaceId, params.query, result, {
        topicId: params.topicId,
        sourceAgentRunId: params.agentRunId,
      });
    }

    return result;
  } catch (error) {
    if (params.client && workUnitId) {
      await failAiWorkUnit(
        params.client,
        params.workspaceId,
        workUnitId,
        error instanceof Error ? error.message : String(error),
      );
    }
    throw error;
  }
}
