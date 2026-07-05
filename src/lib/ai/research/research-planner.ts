import {
  canEmployeeUseBrowserResearch,
  getEmployeeBrowserAccess,
} from "@/lib/ai/browser-research/permissions";
import {
  isBrowserResearchLiveReady,
  isTavilyConfigured,
} from "@/lib/ai/browser-research/provider-config";
import { isGatewaySearchConfigured } from "@/lib/ai/search/config";
import { decideSearchRoute } from "@/lib/ai/search/search-router";
import type { BrowserAccess } from "@/lib/ai/intelligence-policy";
import type { AIEmployee, RoomMessage } from "@/lib/types";
import { inferResearchPlanWithModel } from "./research-planner-infer";
import { pickResearchProvider } from "./research-provider";
import {
  isAffirmativeSearchFollowUp,
  isMetaResearchInstruction,
  isMostlyMetaInstruction,
  resolveResearchQuery,
  type ResolvedResearchQuery,
} from "./resolve-research-query";

export const ResearchPlanSchema = {
  action: ["reply", "search", "browse", "clarify"] as const,
};

export type ResearchPlan = {
  action: "reply" | "search" | "browse" | "clarify";
  researchQuery?: string;
  provider?:
    | "tavily"
    | "browserbase"
    | "gateway_perplexity"
    | "gateway_exa"
    | "gateway_parallel";
  reasoning: string;
  confidence: number;
  userQuestion: string;
  resolved: ResolvedResearchQuery;
};

export type ResearchCapabilities = {
  gatewaySearch: boolean;
  tavily: boolean;
  browserbase: boolean;
  browserAccess: BrowserAccess;
  canSearch: boolean;
};

export type ResearchPlannerInput = {
  messages: RoomMessage[];
  userMessage: string;
  employee: Pick<AIEmployee, "intelligencePolicy" | "modelMode" | "roleKey">;
  /** Browse toggle — user explicitly requested fast Tavily search on this send. */
  preferTavily?: boolean;
  /** Agent mode toggle — user explicitly requested live Browserbase browsing on this send. */
  preferAgentMode?: boolean;
  excludeMessageId?: string;
};

export function getResearchCapabilities(
  employee: Pick<AIEmployee, "intelligencePolicy" | "modelMode" | "roleKey">,
): ResearchCapabilities {
  const browserAccess = getEmployeeBrowserAccess(employee);
  const gatewaySearch = isGatewaySearchConfigured();
  const tavily = isTavilyConfigured();
  const browserbase = isBrowserResearchLiveReady();
  const canSearch = canEmployeeUseBrowserResearch(employee);
  return { gatewaySearch, tavily, browserbase, browserAccess, canSearch };
}

function buildSearchPlan(
  base: Pick<ResearchPlan, "userQuestion" | "resolved">,
  input: ResearchPlannerInput,
  capabilities: ResearchCapabilities,
  reasoning: string,
  confidence: number,
  forcePrefs?: { preferTavily: boolean; preferAgentMode: boolean },
): ResearchPlan {
  const prefs = forcePrefs ?? {
    preferTavily: Boolean(input.preferTavily),
    preferAgentMode: Boolean(input.preferAgentMode),
  };
  const hasUrl = /\bhttps?:\/\//.test(input.userMessage);
  const provider = pickResearchProvider(base.resolved.query, prefs, capabilities);
  const routeDecision = decideSearchRoute(base.resolved.query, prefs);
  const useBrowse =
    routeDecision.browserRequired &&
    (prefs.preferAgentMode || hasUrl) &&
    capabilities.browserbase &&
    provider === "browserbase";

  if (!provider && !capabilities.gatewaySearch && !capabilities.tavily && !capabilities.browserbase) {
    return {
      ...base,
      action: "search",
      researchQuery: base.resolved.query,
      reasoning: `${reasoning} (Providers unavailable — mock/fallback may apply.)`,
      confidence,
    };
  }

  return {
    ...base,
    action: useBrowse ? "browse" : "search",
    researchQuery: base.resolved.query,
    provider: provider ?? (capabilities.gatewaySearch ? "gateway_perplexity" : capabilities.tavily ? "tavily" : "browserbase"),
    reasoning,
    confidence,
  };
}

/**
 * User-directed search only — UI toggles and explicit "look it up" / confirmation.
 * Returns null when the model planner should decide.
 */
export function resolveUserDirectedResearchPlan(
  input: ResearchPlannerInput,
  capabilities: ResearchCapabilities,
  resolved: ResolvedResearchQuery,
): ResearchPlan | null {
  const base: Pick<ResearchPlan, "userQuestion" | "resolved"> = {
    userQuestion: resolved.userQuestion,
    resolved,
  };

  const preferTavily = Boolean(input.preferTavily);
  const preferAgentMode = Boolean(input.preferAgentMode);

  if (preferTavily || preferAgentMode) {
    if (isMostlyMetaInstruction(resolved.query) && !resolved.wasMetaInstruction) {
      return {
        ...base,
        action: "clarify",
        reasoning: "Could not resolve a clear topic to search from the conversation.",
        confidence: 0.7,
      };
    }

    return buildSearchPlan(
      base,
      input,
      capabilities,
      preferAgentMode
        ? "User enabled Agent mode — running live browser research as requested."
        : "User enabled Browse — running fast web search as requested.",
      0.98,
      { preferTavily, preferAgentMode },
    );
  }

  const metaInstruction = isMetaResearchInstruction(input.userMessage);
  const affirmativeFollowUp = isAffirmativeSearchFollowUp(
    input.userMessage,
    input.messages,
    input.excludeMessageId,
  );

  if (isMostlyMetaInstruction(resolved.query) && !resolved.wasMetaInstruction && !affirmativeFollowUp) {
    return {
      ...base,
      action: "clarify",
      reasoning: "Could not resolve a clear topic to search from the conversation.",
      confidence: 0.7,
    };
  }

  if (
    (metaInstruction || affirmativeFollowUp) &&
    resolved.resolvedFrom === "thread" &&
    !isMostlyMetaInstruction(resolved.query)
  ) {
    return buildSearchPlan(
      base,
      input,
      capabilities,
      metaInstruction
        ? `User asked to search — resolved topic: "${resolved.query.slice(0, 80)}${resolved.query.length > 80 ? "…" : ""}"`
        : "User confirmed they want the latest verified via search.",
      0.95,
    );
  }

  if (metaInstruction && !isMostlyMetaInstruction(resolved.query)) {
    return buildSearchPlan(
      base,
      input,
      capabilities,
      "User explicitly requested a web search.",
      0.92,
    );
  }

  return null;
}

/** Plan whether to answer directly or run web research before the main reply. */
export async function planResearch(input: ResearchPlannerInput): Promise<ResearchPlan> {
  const capabilities = getResearchCapabilities(input.employee);
  const resolved = resolveResearchQuery({
    messages: input.messages,
    userMessage: input.userMessage,
    excludeMessageId: input.excludeMessageId,
  });

  const base: Pick<ResearchPlan, "userQuestion" | "resolved"> = {
    userQuestion: resolved.userQuestion,
    resolved,
  };

  if (capabilities.browserAccess === "none" || !capabilities.canSearch) {
    return {
      ...base,
      action: "reply",
      reasoning: "Browser research is not enabled for this employee.",
      confidence: 0.95,
    };
  }

  const userDirected = resolveUserDirectedResearchPlan(input, capabilities, resolved);
  if (userDirected) {
    return userDirected;
  }

  return inferResearchPlanWithModel(input, resolved, capabilities);
}

/** @deprecated Sync alias for tests — user-directed paths only; does not run model planner. */
export function planResearchSync(input: ResearchPlannerInput): ResearchPlan {
  const capabilities = getResearchCapabilities(input.employee);
  const resolved = resolveResearchQuery({
    messages: input.messages,
    userMessage: input.userMessage,
    excludeMessageId: input.excludeMessageId,
  });

  const base: Pick<ResearchPlan, "userQuestion" | "resolved"> = {
    userQuestion: resolved.userQuestion,
    resolved,
  };

  if (capabilities.browserAccess === "none" || !capabilities.canSearch) {
    return {
      ...base,
      action: "reply",
      reasoning: "Browser research is not enabled for this employee.",
      confidence: 0.95,
    };
  }

  const userDirected = resolveUserDirectedResearchPlan(input, capabilities, resolved);
  if (userDirected) {
    return userDirected;
  }

  return {
    ...base,
    action: "reply",
    reasoning: "No user-directed search — deferring to model reply (planner runs async in production).",
    confidence: 0.5,
  };
}
