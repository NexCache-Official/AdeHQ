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
  buildWebSourcesArtifactFromCards,
  ensurePrivateCompanyWording,
  normalizeGatewaySearchSources,
  realignSearchCitations,
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
import { isBrainSearchV1Enabled, isBrainSearchCacheEnabled } from "@/lib/brain/flags";
import {
  assessSearchEvidence,
  legacySearchNeedToBrainNeed,
  searchRouteToBrainRouteId,
  searchRouteToAttemptProvider,
  shouldFallbackFromEvidence,
  type SearchAttemptRecord,
} from "@/lib/brain/search";
import { getLiveSeedSnapshot } from "@/lib/brain/catalog";
import { workHoursFromCost } from "@/lib/billing/costing/work-hours";
import { createHash } from "node:crypto";

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
  brainAttempts?: SearchAttemptRecord[];
  sessionId?: string;
  sessionReused?: boolean;
  cacheHit?: boolean;
  cacheAgeLabel?: string;
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
      // Customer Usage shows "Real-time Search"; providerName keeps Exa vs Gateway distinct.
      workType: "realtime_search",
      // Work units use AiCapability; Brain search_* route ids live in metadata.routeId.
      capability: "research_planning",
      // ProviderRoute is the AI runtime enum (vercel_gateway | siliconflow_direct | mock).
      // Search engines are recorded on providerName + metadata.searchRoute instead.
      providerRoute:
        decision.route === "gateway_exa" && isExaSearchConfigured()
          ? undefined
          : isGatewaySearchRoute(decision.route)
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
        routeId: searchRouteToBrainRouteId(decision.route),
        agentRunId: params.agentRunId,
        brainSearchV1: isBrainSearchV1Enabled(),
      },
    });
    workUnitId = workUnit.id;
    await startAiWorkUnit(params.client, params.workspaceId, workUnitId);
  }

  try {
    if (params.client) {
      if (isBrainSearchCacheEnabled()) {
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
                searchRequests: 0,
                billableToWorkspace: false,
              },
            });
          }
          return {
            ...cachedResult,
            stewardMeta: {
              steward,
              attempts,
              sessionReused: false,
              cacheHit: true,
              cacheAgeLabel: "Used cached research",
            },
          };
        }
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
            metadata: { sessionReused: true, sessionId: sessionReuse.sessionId, searchRequests: 0 },
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
    const brainAttempts: SearchAttemptRecord[] = [];
    const queryHash = createHash("sha256").update(params.query.trim().toLowerCase()).digest("hex").slice(0, 40);
    const brainNeed = legacySearchNeedToBrainNeed(decision.need);

    const routeChain: SearchRoute[] = isBrainSearchV1Enabled()
      ? [
          decision.route,
          ...(steward.fallbackChain ?? []).filter((r) => r && r !== decision.route),
        ]
      : [
          decision.route,
          ...(steward.backupProvider && steward.backupProvider !== decision.route
            ? [steward.backupProvider]
            : []),
        ];

    for (let i = 0; i < routeChain.length; i++) {
      const route = routeChain[i]!;
      const startedAt = new Date().toISOString();
      const attemptStarted = Date.now();
      const brainRouteId = searchRouteToBrainRouteId(route) ?? "route_search_exa";
      const snap = getLiveSeedSnapshot(brainRouteId);
      const attemptProvider = searchRouteToAttemptProvider(route);

      try {
        const result = await runProviderSearch(route, params, {
          ...decision,
          route,
        });
        const latencyMs = Date.now() - attemptStarted;
        const assessment = assessSearchEvidence(result.sources, {
          query: params.query,
          need: brainNeed,
          freshness: decision.need === "news" ? "live" : "recent",
          requirePrimarySources: decision.need === "source_verification",
          maxSources: decision.maxResults ?? 6,
        }, { answerText: result.text });

        const failed =
          isSearchFailure(result.text, result.sources.length) ||
          (isBrainSearchV1Enabled() && shouldFallbackFromEvidence(assessment));

        attempts.push({
          provider: route,
          sourceCount: result.sources.length,
          latencyMs,
          failed,
          fallbackReason: assessment.fallbackReason,
        });

        if (attemptProvider) {
          brainAttempts.push({
            attemptNumber: i + 1,
            routeId: brainRouteId,
            provider: attemptProvider,
            queryHash,
            startedAt,
            completedAt: new Date().toISOString(),
            latencyMs,
            sourceCount: result.sources.length,
            usedSourceCount: assessment.sourceCount,
            outcome: failed
              ? assessment.fallbackReason === "no_usable_sources"
                ? "no_sources"
                : "insufficient_evidence"
              : "success",
            fallbackReason: failed ? assessment.fallbackReason : undefined,
            pricingSnapshotId: snap?.id,
            actualCostUsd: result.estimatedCostUsd,
            workHours: workHoursFromCost(result.estimatedCostUsd),
          });
        }

        // Always charge billed attempts that returned from the provider.
        estimatedCostUsd += result.estimatedCostUsd;

        if (!failed) {
          text = result.text;
          rawSources = result.sources;
          providerRoute = result.providerRoute;
          estimatedWorkMinutes = result.estimatedWorkMinutes;
          synthesisModel = result.synthesisModel;
          searchLatencyMs = result.searchLatencyMs;
          synthesisLatencyMs = result.synthesisLatencyMs;
          activeRoute = route;
          break;
        }

        console.warn(
          `[AdeHQ search] Attempt ${i + 1} (${route}) insufficient:`,
          assessment.fallbackReason ?? "search_failure",
        );
      } catch (error) {
        const latencyMs = Date.now() - attemptStarted;
        attempts.push({
          provider: route,
          sourceCount: 0,
          latencyMs,
          failed: true,
          fallbackReason: "provider_error",
        });
        if (attemptProvider) {
          const isTimeout =
            error instanceof Error && /timeout|timed out|aborted/i.test(error.message);
          brainAttempts.push({
            attemptNumber: i + 1,
            routeId: brainRouteId,
            provider: attemptProvider,
            queryHash,
            startedAt,
            completedAt: new Date().toISOString(),
            latencyMs,
            sourceCount: 0,
            usedSourceCount: 0,
            outcome: isTimeout ? "timeout" : "provider_error",
            fallbackReason: error instanceof Error ? error.message : String(error),
            pricingSnapshotId: snap?.id,
            actualCostUsd: 0,
            workHours: 0,
          });
        }
        console.warn(`[AdeHQ search] Attempt ${i + 1} (${route}) failed:`, error);
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
        stewardMeta: { steward, attempts, brainAttempts },
      };
    }

    const normalized = normalizeGatewaySearchSources(rawSources, params.query, {
      maxUsed: 5,
      searchNeed: decision.need,
    });

    text = stripInlineSourcesSection(text);
    text = ensurePrivateCompanyWording(text, params.query, decision.need);

    // Renumber inline [n] markers to match the sources we actually display, and
    // pull back any lower-ranked source the answer cites so no citation is hidden.
    const aligned = realignSearchCitations({ text, rawSources, normalized });
    text = aligned.text;
    const displaySources = aligned.sources;

    if (!text.trim()) {
      return {
        answer: SEARCH_UNAVAILABLE_MESSAGE,
        sources: [],
        route: activeRoute,
        providerRoute: "model_fallback",
        estimatedCostUsd: 0,
        estimatedWorkMinutes: 0,
        stewardMeta: { steward, attempts, brainAttempts },
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
        stewardMeta: { steward, attempts, brainAttempts },
      };
    }

    const confidence = computeSearchConfidence(normalized);
    const totalLatencyMs = Date.now() - totalStarted;
    // Displayed count reflects the realigned set (ranked + any cited fallback).
    const displayedSourceCount = displaySources.length;
    const displayedExcludedCount = Math.max(
      0,
      normalized.sourceCount - displayedSourceCount,
    );
    const billedAttempts = brainAttempts.filter((a) => a.actualCostUsd > 0);
    const searchMeta = {
      searchRoute: activeRoute,
      searchNeed: decision.need as SearchNeed,
      searchMode,
      browserRequired: false as const,
      searchRequests: Math.max(1, billedAttempts.length || attempts.filter((a) => !a.failed).length),
      sourceCount: normalized.sourceCount,
      usedSourceCount: displayedSourceCount,
      excludedSourceCount: displayedExcludedCount,
      searchCostUsd: estimatedCostUsd,
      synthesisModel,
      totalLatencyMs,
      searchLatencyMs,
      synthesisLatencyMs,
      confidence,
      excludedSourceReasons: normalized.excluded
        .filter((source) => !displaySources.some((shown) => shown.url === source.url))
        .map((source) => source.excludedReason)
        .filter(Boolean) as string[],
    };

    const winningRouteId = searchRouteToBrainRouteId(activeRoute);
    if (params.client && workUnitId) {
      await completeAiWorkUnit(params.client, params.workspaceId, workUnitId, {
        actualWorkMinutes: estimatedWorkMinutes,
        actualCostUsd: estimatedCostUsd,
        metadata: {
          sourceCount: normalized.sourceCount,
          usedSourceCount: displayedSourceCount,
          excludedSourceCount: displayedExcludedCount,
          totalLatencyMs,
          confidence,
          searchRoute: activeRoute,
          searchNeed: decision.need,
          routeId: winningRouteId,
          searchRequests: searchMeta.searchRequests,
          brainSearchAttempts: brainAttempts,
          providerName:
            activeRoute === "gateway_exa" && isExaSearchConfigured()
              ? "exa"
              : isGatewaySearchRoute(activeRoute)
                ? "vercel_gateway"
                : "tavily",
        },
      });
    }

    const webArtifact =
      displaySources.length > 0
        ? buildWebSourcesArtifactFromCards(displaySources, {
            sourceCount: normalized.sourceCount,
            excludedSourceCount: displayedExcludedCount,
          })
        : undefined;

    const result = {
      answer: text,
      sources: displaySources.map((source) => ({
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
      stewardMeta: { steward, attempts, brainAttempts },
    };

    if (params.client && result.answer.trim()) {
      await setSearchCache(params.client, params.workspaceId, params.query, result, {
        topicId: params.topicId,
        sourceAgentRunId: params.agentRunId,
        confidence,
        searchNeed: decision.need,
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
