import {
  createAiWorkUnit,
  startAiWorkUnit,
  completeAiWorkUnit,
  failAiWorkUnit,
} from "@/lib/supabase/ai-work-units";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isGatewaySearchRoute } from "./search-router";
import {
  getGatewaySearchWorkMinutes,
  isExaSearchConfigured,
  isGatewaySearchConfigured,
  isTavilySearchConfigured,
} from "./config";
import { runGatewaySearchAnswer, estimateGatewaySearchCostUsd } from "./vercel-gateway-search";
import { runExaSearchAnswer, estimateExaSearchCostUsd } from "./exa-search";
import { runTavilySearchAnswer, estimateTavilySearchAnswerCostUsd } from "./tavily-search";
import type { SearchAnswerResult, SearchNeed, SearchRoute, SearchRouteDecision } from "./types";
import { estimateWorkMinutesFromCost } from "@/lib/ai/work-hours/estimate";
import {
  buildWebSourcesArtifact,
  ensurePrivateCompanyWording,
  normalizeGatewaySearchSources,
  stripInlineSourcesSection,
} from "./source-normalizer";
import {
  cachedAnswerToSearchResult,
  computeSearchConfidence,
  getSearchCache,
  setSearchCache,
} from "./search-cache";
import {
  decideSearchSteward,
  defaultSearchStewardCapabilities,
  stewardDecisionToRouteDecision,
  type SearchStewardAttempt,
  type SearchStewardDecision,
} from "./search-steward";
import { getReusableSessionFindings, recordSessionSearchEvent } from "./research-session";

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

export type ExecuteSearchAnswerMeta = {
  steward?: SearchStewardDecision;
  attempts?: SearchStewardAttempt[];
  sessionId?: string;
  sessionReused?: boolean;
};

const SEARCH_UNAVAILABLE_MESSAGE =
  "I couldn't verify that with current web sources. I can answer from general knowledge with clear uncertainty, or try again if you want me to re-run search.";

const NO_SOURCES_MESSAGE =
  "I searched but couldn't find credible sources to verify that. I'd rather not guess — want me to try a broader search?";

/** Search answers must include verifiable sources — never return unsourced factual claims. */
export function shouldReturnNoSourcesMessage(
  _text: string,
  normalized: { usedSourceCount: number; sourceCount: number },
): boolean {
  return normalized.usedSourceCount === 0 && normalized.sourceCount === 0;
}

function buildDecision(params: ExecuteSearchAnswerParams): SearchRouteDecision {
  const steward = decideSearchSteward(
    params.query,
    { preferAgentMode: params.preferAgentMode },
    defaultSearchStewardCapabilities(),
  );
  if (params.routeOverride) {
    const base = stewardDecisionToRouteDecision(steward);
    return {
      ...base,
      need: base.need === "none" ? "current_fact" : base.need,
      route: params.routeOverride,
      browserRequired: params.routeOverride === "browserbase",
      reason: "route_override",
      maxResults: base.maxResults ?? 5,
    };
  }
  return stewardDecisionToRouteDecision(steward);
}

async function runProviderSearch(
  route: SearchRoute,
  params: ExecuteSearchAnswerParams,
  decision: SearchRouteDecision,
): Promise<{
  text: string;
  sources: SearchAnswerResult["sources"];
  providerRoute: SearchAnswerResult["providerRoute"];
  estimatedCostUsd: number;
  estimatedWorkMinutes: number;
  synthesisModel: string;
  searchLatencyMs: number;
  synthesisLatencyMs: number;
}> {
  const searchMode = decision.searchMode ?? "standard";

  if (route === "gateway_exa" && isExaSearchConfigured()) {
    const result = await runExaSearchAnswer({
      query: params.query,
      maxResults: decision.maxResults,
      employeeName: params.employeeName,
      searchMode,
    });
    return {
      text: result.text,
      sources: result.sources,
      providerRoute: "exa",
      estimatedCostUsd: estimateExaSearchCostUsd(),
      estimatedWorkMinutes: 2,
      synthesisModel: result.synthesisModel,
      searchLatencyMs: result.searchLatencyMs,
      synthesisLatencyMs: result.synthesisLatencyMs,
    };
  }

  if (isGatewaySearchRoute(route) && isGatewaySearchConfigured()) {
    const result = await runGatewaySearchAnswer({
      query: params.query,
      route: route as Extract<
        SearchRoute,
        "gateway_perplexity" | "gateway_exa" | "gateway_parallel"
      >,
      searchMode,
      maxResults: decision.maxResults,
      recency: decision.recency,
      domains: decision.domains,
      employeeName: params.employeeName,
      workspaceId: params.workspaceId,
      client: params.client,
    });
    return {
      text: result.text,
      sources: result.sources,
      providerRoute: "vercel_gateway",
      estimatedCostUsd: estimateGatewaySearchCostUsd(),
      estimatedWorkMinutes: getGatewaySearchWorkMinutes(),
      synthesisModel: result.synthesisModel,
      searchLatencyMs: result.searchLatencyMs,
      synthesisLatencyMs: result.synthesisLatencyMs,
    };
  }

  if (route === "tavily" && isTavilySearchConfigured()) {
    const started = Date.now();
    const result = await runTavilySearchAnswer({
      query: params.query,
      maxResults: decision.maxResults,
      employeeName: params.employeeName,
    });
    return {
      text: result.text,
      sources: result.sources,
      providerRoute: "tavily",
      estimatedCostUsd: estimateTavilySearchAnswerCostUsd(),
      estimatedWorkMinutes: Math.max(1, estimateWorkMinutesFromCost(estimateTavilySearchAnswerCostUsd())),
      synthesisModel: "tavily",
      searchLatencyMs: 0,
      synthesisLatencyMs: Date.now() - started,
    };
  }

  throw new Error(`Search provider unavailable for route: ${route}`);
}

function isSearchFailure(text: string, sourceCount: number): boolean {
  return !text.trim() || sourceCount === 0;
}

export async function executeSearchAnswer(
  params: ExecuteSearchAnswerParams,
): Promise<SearchAnswerResult & { stewardMeta?: ExecuteSearchAnswerMeta }> {
  const steward = decideSearchSteward(
    params.query,
    { preferAgentMode: params.preferAgentMode },
    defaultSearchStewardCapabilities(),
  );
  const decision = buildDecision(params);
  const searchMode = decision.searchMode ?? "standard";
  const totalStarted = Date.now();
  const attempts: SearchStewardAttempt[] = [];

  if (decision.browserRequired || decision.route === "browserbase" || decision.route === "none") {
    if (decision.route === "none") {
      return {
        answer: SEARCH_UNAVAILABLE_MESSAGE,
        sources: [],
        route: "none",
        providerRoute: "model_fallback",
        estimatedCostUsd: 0,
        estimatedWorkMinutes: 0,
        stewardMeta: { steward, attempts },
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
      workType:
        decision.route === "gateway_exa" && isExaSearchConfigured()
          ? "gateway_search_answer"
          : isGatewaySearchRoute(decision.route)
            ? "gateway_search_answer"
            : "quick_web_search",
      capability: "research_planning",
      providerRoute: isGatewaySearchRoute(decision.route)
        ? "vercel_gateway"
        : undefined,
      providerName:
        decision.route === "gateway_exa" && isExaSearchConfigured()
          ? "exa"
          : isGatewaySearchRoute(decision.route)
            ? "vercel_gateway"
            : "tavily",
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
      const cached = await getSearchCache(params.client, params.workspaceId, params.query);
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
        return {
          ...cachedResult,
          stewardMeta: {
            steward,
            attempts,
            sessionReused: false,
          },
        };
      }

      const sessionReuse = await getReusableSessionFindings(params.client, {
        workspaceId: params.workspaceId,
        topicId: params.topicId,
        query: params.query,
      });
      if (sessionReuse) {
        if (workUnitId) {
          await completeAiWorkUnit(params.client, params.workspaceId, workUnitId, {
            actualWorkMinutes: 0,
            actualCostUsd: 0,
            metadata: { sessionReused: true, sessionId: sessionReuse.sessionId },
          });
        }
        return {
          answer: sessionReuse.answer,
          sources: sessionReuse.sources,
          route: sessionReuse.route,
          providerRoute: sessionReuse.providerRoute,
          estimatedCostUsd: 0,
          estimatedWorkMinutes: 0,
          webSourcesArtifact: sessionReuse.webSourcesArtifact,
          searchSourcesArtifact: sessionReuse.searchSourcesArtifact,
          stewardMeta: {
            steward,
            attempts,
            sessionId: sessionReuse.sessionId,
            sessionReused: true,
          },
        };
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
    let activeRoute: SearchRoute = decision.route;

    try {
      const primaryStarted = Date.now();
      const primary = await runProviderSearch(activeRoute, params, decision);
      text = primary.text;
      rawSources = primary.sources;
      providerRoute = primary.providerRoute;
      estimatedCostUsd = primary.estimatedCostUsd;
      estimatedWorkMinutes = primary.estimatedWorkMinutes;
      synthesisModel = primary.synthesisModel;
      searchLatencyMs = primary.searchLatencyMs;
      synthesisLatencyMs = primary.synthesisLatencyMs;
      attempts.push({
        provider: activeRoute,
        sourceCount: rawSources.length,
        latencyMs: Date.now() - primaryStarted,
        failed: isSearchFailure(text, rawSources.length),
      });
    } catch (error) {
      attempts.push({
        provider: activeRoute,
        sourceCount: 0,
        latencyMs: 0,
        failed: true,
      });
      console.warn("[AdeHQ search] Primary provider failed:", error);
    }

    if (isSearchFailure(text, rawSources.length) && steward.backupProvider) {
      const backupRoute = steward.backupProvider;
      if (backupRoute !== activeRoute) {
        try {
          const backupStarted = Date.now();
          const backup = await runProviderSearch(backupRoute, params, {
            ...decision,
            route: backupRoute,
          });
          if (!isSearchFailure(backup.text, backup.sources.length)) {
            text = backup.text;
            rawSources = backup.sources;
            providerRoute = backup.providerRoute;
            estimatedCostUsd = backup.estimatedCostUsd;
            estimatedWorkMinutes = backup.estimatedWorkMinutes;
            synthesisModel = backup.synthesisModel;
            searchLatencyMs = backup.searchLatencyMs;
            synthesisLatencyMs = backup.synthesisLatencyMs;
            activeRoute = backupRoute;
          }
          attempts.push({
            provider: backupRoute,
            sourceCount: backup.sources.length,
            latencyMs: Date.now() - backupStarted,
            failed: isSearchFailure(backup.text, backup.sources.length),
          });
        } catch (error) {
          attempts.push({
            provider: backupRoute,
            sourceCount: 0,
            latencyMs: 0,
            failed: true,
          });
          console.warn("[AdeHQ search] Backup provider failed:", error);
        }
      }
    }

    if (!text.trim() && rawSources.length === 0 && !attempts.some((a) => a.sourceCount > 0)) {
      return {
        answer: SEARCH_UNAVAILABLE_MESSAGE,
        sources: [],
        route: activeRoute,
        providerRoute: "model_fallback",
        estimatedCostUsd: 0,
        estimatedWorkMinutes: 0,
        stewardMeta: { steward, attempts },
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
        route: activeRoute,
        providerRoute: "model_fallback",
        estimatedCostUsd: 0,
        estimatedWorkMinutes: 0,
        stewardMeta: { steward, attempts },
      };
    }

    if (shouldReturnNoSourcesMessage(text, normalized)) {
      return {
        answer: NO_SOURCES_MESSAGE,
        sources: [],
        route: activeRoute,
        providerRoute,
        estimatedCostUsd,
        estimatedWorkMinutes,
        stewardMeta: { steward, attempts },
      };
    }

    const confidence = computeSearchConfidence(normalized);
    const totalLatencyMs = Date.now() - totalStarted;
    const searchMeta = {
      searchRoute: activeRoute,
      searchNeed: decision.need as SearchNeed,
      searchMode,
      browserRequired: false as const,
      searchRequests: attempts.length,
      sourceCount: normalized.sourceCount,
      usedSourceCount: normalized.usedSourceCount,
      excludedSourceCount: normalized.excludedSourceCount,
      searchCostUsd: estimatedCostUsd,
      synthesisModel,
      totalLatencyMs,
      searchLatencyMs,
      synthesisLatencyMs,
      confidence,
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
          confidence,
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
      route: activeRoute,
      providerRoute,
      estimatedCostUsd,
      estimatedWorkMinutes,
      searchMeta,
      webSourcesArtifact: webArtifact,
      searchSourcesArtifact: webArtifact,
      stewardMeta: { steward, attempts },
    };

    if (params.client && result.answer.trim()) {
      await setSearchCache(params.client, params.workspaceId, params.query, result, {
        topicId: params.topicId,
        sourceAgentRunId: params.agentRunId,
        confidence,
      });

      await recordSessionSearchEvent(params.client, {
        workspaceId: params.workspaceId,
        topicId: params.topicId,
        employeeId: params.employeeId,
        agentRunId: params.agentRunId,
        query: params.query,
        answer: result.answer,
        sources: result.sources,
        route: activeRoute,
        providerRoute,
        confidence,
        webSourcesArtifact: webArtifact,
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
