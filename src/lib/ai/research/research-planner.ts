import { z } from "zod";
import {
  canEmployeeUseBrowserResearch,
  getEmployeeBrowserAccess,
} from "@/lib/ai/browser-research/permissions";
import {
  isBrowserResearchLiveReady,
  isFastSearchQuery,
  isTavilyConfigured,
  resolveBrowserResearchProviderForQuery,
} from "@/lib/ai/browser-research/provider-config";
import type { BrowserAccess } from "@/lib/ai/intelligence-policy";
import type { AIEmployee, RoomMessage } from "@/lib/types";
import {
  isMetaResearchInstruction,
  isMostlyMetaInstruction,
  resolveResearchQuery,
  type ResolvedResearchQuery,
} from "./resolve-research-query";

export const ResearchPlanSchema = z.object({
  action: z.enum(["reply", "search", "browse", "clarify"]),
  researchQuery: z.string().optional(),
  provider: z.enum(["tavily", "browserbase"]).optional(),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});

export type ResearchPlan = z.infer<typeof ResearchPlanSchema> & {
  userQuestion: string;
  resolved: ResolvedResearchQuery;
};

export type ResearchCapabilities = {
  tavily: boolean;
  browserbase: boolean;
  browserAccess: BrowserAccess;
  canSearch: boolean;
};

export type ResearchPlannerInput = {
  messages: RoomMessage[];
  userMessage: string;
  employee: Pick<AIEmployee, "intelligencePolicy" | "modelMode" | "roleKey">;
  /** Browse toggle — prefer fast Tavily search on this send. */
  preferTavily?: boolean;
  /** Agent mode toggle — prefer live Browserbase browsing on this send. */
  preferAgentMode?: boolean;
  excludeMessageId?: string;
};

const EXPLICIT_SEARCH_PATTERNS = [
  /\b(search|look up|look it up|find out|google|web search|live search)\b/i,
  /\b(how much|raised|funding|valuation|series [a-d]|latest round|amount raised)\b/i,
  /\b(recently|just raised|latest news|post-?2024|this year|last year)\b/i,
];

export function getResearchCapabilities(
  employee: Pick<AIEmployee, "intelligencePolicy" | "modelMode" | "roleKey">,
): ResearchCapabilities {
  const browserAccess = getEmployeeBrowserAccess(employee);
  const tavily = isTavilyConfigured();
  const browserbase = isBrowserResearchLiveReady();
  const canSearch = canEmployeeUseBrowserResearch(employee);
  return { tavily, browserbase, browserAccess, canSearch };
}

function needsLiveFacts(resolved: ResolvedResearchQuery, userMessage: string): boolean {
  return (
    isFastSearchQuery(resolved.query) ||
    isFastSearchQuery(resolved.userQuestion) ||
    EXPLICIT_SEARCH_PATTERNS.some((pattern) => pattern.test(userMessage)) ||
    EXPLICIT_SEARCH_PATTERNS.some((pattern) => pattern.test(resolved.query))
  );
}

function pickProvider(
  query: string,
  prefs: { preferTavily: boolean; preferAgentMode: boolean },
  capabilities: ResearchCapabilities,
): "tavily" | "browserbase" | undefined {
  if (prefs.preferAgentMode && capabilities.browserbase) {
    return "browserbase";
  }
  if (prefs.preferTavily && capabilities.tavily) {
    return "tavily";
  }

  if (/\bhttps?:\/\//.test(query) && capabilities.browserbase && prefs.preferAgentMode) {
    return "browserbase";
  }

  if (prefs.preferAgentMode && capabilities.browserbase && !isFastSearchQuery(query)) {
    return "browserbase";
  }

  const routed = resolveBrowserResearchProviderForQuery(query);
  if (routed.provider === "tavily" && capabilities.tavily) return "tavily";
  if (routed.provider === "browserbase" && capabilities.browserbase) return "browserbase";
  if (capabilities.tavily) return "tavily";
  if (capabilities.browserbase) return "browserbase";
  return undefined;
}

/** Classify whether to answer directly or run web research before replying. */
export function planResearch(input: ResearchPlannerInput): ResearchPlan {
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

  const preferTavily = Boolean(input.preferTavily);
  const preferAgentMode = Boolean(input.preferAgentMode);
  const metaInstruction = isMetaResearchInstruction(input.userMessage);
  const explicitSearch =
    preferTavily ||
    preferAgentMode ||
    metaInstruction ||
    EXPLICIT_SEARCH_PATTERNS.some((pattern) => pattern.test(input.userMessage));
  const liveFacts = needsLiveFacts(resolved, input.userMessage);
  const hasUrl = /\bhttps?:\/\//.test(input.userMessage);

  if (isMostlyMetaInstruction(resolved.query) && !resolved.wasMetaInstruction) {
    return {
      ...base,
      action: "clarify",
      reasoning: "Could not resolve a clear topic to search from the conversation.",
      confidence: 0.7,
    };
  }

  const shouldSearch =
    explicitSearch ||
    liveFacts ||
    (metaInstruction && resolved.resolvedFrom === "thread");

  if (!shouldSearch) {
    return {
      ...base,
      action: "reply",
      reasoning: "Question can be answered from context without live web data.",
      confidence: 0.75,
    };
  }

  const provider = pickProvider(
    resolved.query,
    { preferTavily, preferAgentMode },
    capabilities,
  );
  const useBrowse =
    (preferAgentMode || hasUrl) && capabilities.browserbase && provider === "browserbase";

  if (!provider && !capabilities.tavily && !capabilities.browserbase) {
    return {
      ...base,
      action: "search",
      researchQuery: resolved.query,
      reasoning: liveFacts
        ? "Question needs recent facts — running research (mock if providers unavailable)."
        : "Running research (mock if providers unavailable).",
      confidence: 0.8,
    };
  }

  return {
    ...base,
    action: useBrowse ? "browse" : "search",
    researchQuery: resolved.query,
    provider: provider ?? (capabilities.tavily ? "tavily" : "browserbase"),
    reasoning: metaInstruction
      ? `Resolved search from thread: "${resolved.query.slice(0, 80)}${resolved.query.length > 80 ? "…" : ""}"`
      : liveFacts
        ? "Question needs recent or factual web data."
        : preferAgentMode
          ? "Agent mode — running live browser research."
          : preferTavily
            ? "Browse enabled — running fast web search."
            : "Running web research for this question.",
    confidence: metaInstruction && resolved.resolvedFrom === "thread" ? 0.92 : 0.88,
  };
}
