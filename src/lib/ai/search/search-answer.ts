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
import type { SearchAnswerResult, SearchRoute } from "./types";
import { estimateWorkMinutesFromCost } from "@/lib/ai/work-hours/estimate";

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
  "I need web search enabled to answer that with current sources. Configure AI Gateway search or Tavily, or ask me to draft from general knowledge without live verification.";

export async function executeSearchAnswer(
  params: ExecuteSearchAnswerParams,
): Promise<SearchAnswerResult> {
  const decision = params.routeOverride
    ? {
        need: "current_fact" as const,
        route: params.routeOverride,
        browserRequired: params.routeOverride === "browserbase",
        reason: "route_override",
        estimatedWorkMinutes: isGatewaySearchRoute(params.routeOverride) ? 1.5 : 2,
      }
    : decideSearchRoute(params.query, { preferAgentMode: params.preferAgentMode });

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
      providerRoute: isGatewaySearchRoute(decision.route) ? "vercel_gateway" : "mock",
      estimatedWorkMinutes: decision.estimatedWorkMinutes,
      metadata: {
        query: params.query.slice(0, 500),
        searchRoute: decision.route,
        agentRunId: params.agentRunId,
      },
    });
    workUnitId = workUnit.id;
    await startAiWorkUnit(params.client, params.workspaceId, workUnitId);
  }

  try {
    let text = "";
    let sources: SearchAnswerResult["sources"] = [];
    let providerRoute: SearchAnswerResult["providerRoute"] = "model_fallback";
    let estimatedCostUsd = 0;
    let estimatedWorkMinutes = decision.estimatedWorkMinutes;

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
        maxResults: decision.maxResults,
        recency: decision.recency,
        domains: decision.domains,
        employeeName: params.employeeName,
      });
      text = result.text;
      sources = result.sources;
      providerRoute = "vercel_gateway";
      estimatedCostUsd = estimateGatewaySearchCostUsd();
      estimatedWorkMinutes = getGatewaySearchWorkMinutes();

      if (!text.trim() && isTavilySearchConfigured()) {
        const tavilyResult = await runTavilySearchAnswer({
          query: params.query,
          maxResults: decision.maxResults,
          employeeName: params.employeeName,
        });
        text = tavilyResult.text;
        sources = tavilyResult.sources;
        providerRoute = "tavily";
        estimatedCostUsd = estimateTavilySearchAnswerCostUsd();
        estimatedWorkMinutes = Math.max(1, estimateWorkMinutesFromCost(estimatedCostUsd));
      }
    } else if (tryTavily) {
      const result = await runTavilySearchAnswer({
        query: params.query,
        maxResults: decision.maxResults,
        employeeName: params.employeeName,
      });
      text = result.text;
      sources = result.sources;
      providerRoute = "tavily";
      estimatedCostUsd = estimateTavilySearchAnswerCostUsd();
      estimatedWorkMinutes = Math.max(1, estimateWorkMinutesFromCost(estimatedCostUsd));
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

    if (params.client && workUnitId) {
      await completeAiWorkUnit(params.client, params.workspaceId, workUnitId, {
        actualWorkMinutes: estimatedWorkMinutes,
        actualCostUsd: estimatedCostUsd,
        metadata: { sourceCount: sources.length },
      });
    }

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

    return {
      answer: text,
      sources,
      route: decision.route,
      providerRoute,
      estimatedCostUsd,
      estimatedWorkMinutes,
    };
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
