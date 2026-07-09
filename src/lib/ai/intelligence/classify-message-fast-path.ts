import type {
  FastPathDecision,
  WorkMode,
} from "./intelligence-context";

export type FastPathResult = {
  decision: FastPathDecision;
  confidence: number;
  reason: string;
  suggestedSearchQuery?: string;
};

const GREETING =
  /^(?:hi|hello|hey|morning|good morning|good afternoon|good evening|thanks|thank you|got it|sounds good)(?:\s+(?:everyone|team|all|folks|guys|there))?[!. ]*$/i;

const DIRECT_WORK =
  /\b(?:write|draft|compose|rewrite|summarize|outline|brainstorm|plan|create|make|edit|review)\b/i;

const CURRENT_TIME =
  /\b(?:today|tonight|tomorrow|yesterday|this (?:week|month|quarter|year|season)|latest|recent|recently|current|currently|now|live|up[- ]to[- ]date|in 20\d{2})\b/i;

const PUBLIC_FACT =
  /\b(?:who are|what are|which|biggest|largest|top|sponsors?|partners?|funding|raised|revenue|valuation|pricing|price of|ceo|cfo|leadership|law|laws|visa|tax|regulations?|requirements?|schedule|fixtures?|score|standings?|lineup|market (?:size|share|statistics?)|competitors?|news|announced)\b/i;

const BROWSER_TASK =
  /\b(?:open (?:the )?(?:site|website|page)|browse live|navigate|click through|log in|sign in|take screenshots?|show evidence|scrape|extract from multiple|fill (?:in|out)|computer use)\b/i;

const RESEARCH_REPORT =
  /\b(?:research report|competitive report|market report|compare .{0,60}(?:sources?|screenshots?)|find .{0,40}(?:sources?|evidence))\b/i;

const VAGUE =
  /^(?:do it|handle it|take care of it|what about that|can you help|help me|thoughts\??)$/i;

const FACTUAL_QUESTION =
  /\b(?:what was|what is|what's|what are|who is|who's|who are|how much|how many|when did|where is|where was|tell me about|look up|find out)\b/i;

function normalizedSearchQuery(message: string): string {
  return message
    .replace(/\bthis year's\b/gi, new Date().getUTCFullYear().toString())
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyMessageFastPath(
  message: string,
  options?: {
    workMode?: WorkMode;
    preferFastSearch?: boolean;
    preferAgentMode?: boolean;
    hasRecentContext?: boolean;
  },
): FastPathResult {
  const text = message.trim();
  if (!text) {
    return { decision: "clarify", confidence: 1, reason: "Empty request." };
  }

  if (GREETING.test(text)) {
    return {
      decision: "greeting",
      confidence: 0.99,
      reason: "Short social greeting or acknowledgement.",
    };
  }

  if (
    options?.preferAgentMode ||
    BROWSER_TASK.test(text) ||
    RESEARCH_REPORT.test(text)
  ) {
    return {
      decision: "obvious_browser_research",
      confidence: 0.97,
      reason: "Explicit live-site/browser task.",
      suggestedSearchQuery: normalizedSearchQuery(text),
    };
  }

  if (
    options?.workMode === "research" ||
    options?.preferFastSearch ||
    (FACTUAL_QUESTION.test(text) && PUBLIC_FACT.test(text)) ||
    (CURRENT_TIME.test(text) && PUBLIC_FACT.test(text)) ||
    /\b(?:who are|what are|which)\b.{0,80}\b(?:sponsors?|partners?|ceo|leaders?|competitors?)\b/i.test(text) ||
    /\b(?:latest funding|current ceo|price of|schedule|score)\b/i.test(text)
  ) {
    return {
      decision: "obvious_search",
      confidence: 0.96,
      reason: "Time-sensitive or externally verifiable public fact.",
      suggestedSearchQuery: normalizedSearchQuery(text),
    };
  }

  if (DIRECT_WORK.test(text)) {
    return {
      decision: "direct",
      confidence: 0.93,
      reason: "Clear drafting, planning, or internal work request.",
    };
  }

  if (VAGUE.test(text) && !options?.hasRecentContext) {
    return {
      decision: "clarify",
      confidence: 0.9,
      reason: "Request lacks enough topic context.",
    };
  }

  if (options?.hasRecentContext && text.length < 100) {
    return {
      decision: "direct",
      confidence: 0.78,
      reason: "Likely continuation of recent conversation context.",
    };
  }

  return {
    decision: "needs_router",
    confidence: 0.62,
    reason: "Request needs a lightweight intent decision.",
  };
}
