import type { AIEmployee, RoomMessage } from "@/lib/types";
import { decideSearchRoute } from "@/lib/ai/search/search-router";
import {
  getResearchCapabilities,
  type ResearchCapabilities,
  type ResearchPlan,
} from "@/lib/ai/research/research-planner";
import { pickResearchProvider } from "@/lib/ai/research/research-provider";
import { resolveResearchQuery } from "@/lib/ai/research/resolve-research-query";
import type { IntelligenceContext } from "./intelligence-context";
import { shouldAnswerFromKnowledge } from "./pipeline";

export type IntelligenceResearchPlanInput = {
  intelligence: IntelligenceContext;
  messages: RoomMessage[];
  userMessage: string;
  employee: Pick<AIEmployee, "intelligencePolicy" | "modelMode" | "roleKey">;
  preferTavily?: boolean;
  preferAgentMode?: boolean;
  excludeMessageId?: string;
  capabilities?: ResearchCapabilities;
};

function baseResolved(
  input: IntelligenceResearchPlanInput,
  query: string,
): ResearchPlan["resolved"] {
  const resolved = resolveResearchQuery({
    userMessage: input.userMessage,
    messages: input.messages,
    excludeMessageId: input.excludeMessageId,
  });
  if (resolved.query && resolved.query !== input.userMessage.trim()) {
    return resolved;
  }
  return {
    query,
    userQuestion: input.userMessage.trim(),
    resolvedFrom: "user_message",
    wasMetaInstruction: false,
  };
}

function buildPlan(
  input: IntelligenceResearchPlanInput,
  action: "search" | "browse",
  query: string,
  reasoning: string,
  confidence: number,
): ResearchPlan | null {
  const capabilities =
    input.capabilities ?? getResearchCapabilities(input.employee);
  const resolved = baseResolved(input, query);
  const prefs = {
    preferTavily: Boolean(input.preferTavily),
    preferAgentMode: Boolean(input.preferAgentMode),
  };
  const provider = pickResearchProvider(resolved.query, prefs, capabilities);
  const routeDecision = decideSearchRoute(resolved.query, prefs);

  if (action === "browse") {
    if (!capabilities.browserbase || !routeDecision.browserRequired) {
      if (!capabilities.canSearch) return null;
      action = "search";
    } else if (!provider || provider === "browserbase") {
      return {
        action: "browse",
        researchQuery: resolved.query,
        provider: "browserbase",
        reasoning,
        confidence,
        userQuestion: resolved.userQuestion,
        resolved,
      };
    }
  }

  if (!capabilities.canSearch) return null;

  const searchProvider =
    provider ??
    (capabilities.gatewaySearch
      ? "gateway_perplexity"
      : capabilities.tavily
        ? "tavily"
        : undefined);
  if (!searchProvider || searchProvider === "browserbase") return null;

  return {
    action: "search",
    researchQuery: resolved.query,
    provider: searchProvider,
    reasoning,
    confidence,
    userQuestion: resolved.userQuestion,
    resolved,
  };
}

/**
 * Map intelligence fast-path / router decisions to a concrete research plan.
 * Returns null when the employee should answer without research.
 */
export function researchPlanFromIntelligence(
  input: IntelligenceResearchPlanInput,
): ResearchPlan | null {
  const { intelligence } = input;
  if (shouldAnswerFromKnowledge(intelligence)) return null;

  if (
    intelligence.workMode === "research" &&
    intelligence.fastPath?.decision !== "greeting" &&
    intelligence.fastPath?.decision !== "direct"
  ) {
    const action =
      intelligence.fastPath?.decision === "obvious_browser_research"
        ? "browse"
        : "search";
    return buildPlan(
      input,
      action,
      intelligence.fastPath?.suggestedSearchQuery?.trim() || input.userMessage.trim(),
      "Research work mode — running external verification.",
      0.9,
    );
  }

  const fastPath = intelligence.fastPath?.decision;
  const router = intelligence.router;
  const suggestedQuery =
    intelligence.fastPath?.suggestedSearchQuery?.trim() ||
    router?.searchQuery?.trim() ||
    input.userMessage.trim();

  if (fastPath === "greeting" || fastPath === "direct" || fastPath === "clarify") {
    if (router?.route === "search" && router.confidence >= 0.7) {
      return buildPlan(
        input,
        "search",
        suggestedQuery,
        router.reasoning,
        router.confidence,
      );
    }
    if (router?.route === "browse" && router.confidence >= 0.75) {
      return buildPlan(
        input,
        "browse",
        suggestedQuery,
        router.reasoning,
        router.confidence,
      );
    }
    return null;
  }

  if (fastPath === "obvious_search") {
    return buildPlan(
      input,
      "search",
      suggestedQuery,
      intelligence.fastPath?.reason ?? "Fast path classified as obvious search.",
      intelligence.fastPath?.confidence ?? 0.95,
    );
  }

  if (fastPath === "obvious_browser_research") {
    return buildPlan(
      input,
      "browse",
      suggestedQuery,
      intelligence.fastPath?.reason ?? "Fast path classified as browser research.",
      intelligence.fastPath?.confidence ?? 0.95,
    );
  }

  if (router?.route === "search" && router.confidence >= 0.65) {
    return buildPlan(
      input,
      "search",
      suggestedQuery,
      router.reasoning,
      router.confidence,
    );
  }

  if (router?.route === "browse" && router.confidence >= 0.75) {
    return buildPlan(
      input,
      "browse",
      suggestedQuery,
      router.reasoning,
      router.confidence,
    );
  }

  return null;
}

export function shouldSkipLegacyResearchPlanner(
  intelligence: IntelligenceContext | undefined,
): boolean {
  if (!intelligence) return false;
  const fastPath = intelligence.fastPath?.decision;
  return (
    fastPath === "obvious_search" ||
    fastPath === "obvious_browser_research" ||
    (fastPath === "needs_router" &&
      Boolean(intelligence.router) &&
      intelligence.router!.confidence >= 0.65)
  );
}
