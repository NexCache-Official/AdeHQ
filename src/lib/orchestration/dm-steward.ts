import {
  decideSearchRoute,
  isQuickFactLookup,
  requiresDeepBrowserResearch,
} from "@/lib/ai/search/search-router";
import { detectWorkStopRequest } from "@/lib/orchestration/work-stop";

export type DmStewardIntent =
  | "direct_answer"
  | "current_fact_question"
  | "deep_research_request"
  | "browser_task"
  | "artifact_request"
  | "memory_update"
  | "task_request"
  | "clarification_needed"
  | "social"
  | "stop_active_work";

export type DmStewardRoute =
  | "employee_model"
  | "gateway_search"
  | "tavily_search"
  | "browser_research"
  | "ask_clarification"
  | "silent";

export type DmStewardInput = {
  workspaceId: string;
  dmRoomId: string;
  topicId: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  messageId: string;
  messageContent: string;
  recentMessages: Array<{
    id: string;
    authorType: "human" | "ai";
    content: string;
    createdAt: string;
  }>;
  currentSummary?: string | null;
  savedMemory?: Array<{ title: string; content: string }>;
  chatClearedAt?: string | null;
  currentEpochId?: string | null;
  preferAgentMode?: boolean;
  preferFastSearch?: boolean;
};

export type DmStewardDecision = {
  intent: DmStewardIntent;
  shouldRespond: boolean;
  route: DmStewardRoute;
  browserRequired: boolean;
  searchRequired: boolean;
  reason: string;
  contextPolicy: {
    useCurrentConversation: boolean;
    useSavedMemory: boolean;
    useArchivedSummary: boolean;
    memoryReferenceStyle: "none" | "light" | "explicit";
  };
  costPolicy: {
    stewardModel: "efficient";
    estimatedWorkMinutes: number;
    avoidBrowserbaseReason?: string;
  };
};

const SOCIAL_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|good morning|good afternoon|good evening|yo|sup)\b/i,
  /^(ok|okay|got it|sounds good|perfect|great|nice|cool)\.?$/i,
];

const ARTIFACT_PATTERNS = [
  /\b(create|draft|write|build|make|generate|prepare|compile)\b.{0,60}\b(doc|document|deck|brief|briefing|artifact|report|memo|email|plan|pdf|docx|pptx|xlsx|spreadsheet|workbook|excel|powerpoint|presentation|slides?|sow|rfp|scorecard|tracker)\b/i,
  /\b(?:createPdfReport|createDocx|createPresentation|createSpreadsheet|artifact\.create)\b/i,
  /\b(?:pdf|docx|pptx|xlsx|spreadsheet|workbook|powerpoint|deck)\b.{0,80}\b(?:drive|save(?:\s+it)?\s+to)\b/i,
  /\b(?:drive|save(?:\s+it)?\s+to)\b.{0,80}\b(?:pdf|docx|pptx|xlsx|spreadsheet|workbook|brief|report|deck)\b/i,
];

const TASK_PATTERNS = [
  /\b(create a task|add a task|track this|follow up on|remind me)\b/i,
];

const MEMORY_PATTERNS = [
  /\b(remember this|save this|store this|keep in memory|don't forget)\b/i,
];

const CLARIFY_PATTERNS = [
  /^(what do you mean|can you clarify|not sure what you mean)\b/i,
];

function isSocialMessage(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 120) return false;
  return SOCIAL_PATTERNS.some((p) => p.test(trimmed));
}

function mapSearchRouteToDmRoute(
  searchRoute: ReturnType<typeof decideSearchRoute>["route"],
): DmStewardRoute {
  if (searchRoute === "browserbase") return "browser_research";
  if (searchRoute === "tavily") return "tavily_search";
  if (
    searchRoute === "gateway_perplexity" ||
    searchRoute === "gateway_exa" ||
    searchRoute === "gateway_parallel"
  ) {
    return "gateway_search";
  }
  return "employee_model";
}

function buildContextPolicy(input: DmStewardInput): DmStewardDecision["contextPolicy"] {
  const cleared = Boolean(input.chatClearedAt);
  const hasSavedMemory = (input.savedMemory?.length ?? 0) > 0;

  return {
    useCurrentConversation: true,
    useSavedMemory: hasSavedMemory,
    useArchivedSummary: !cleared && Boolean(input.currentSummary?.trim()),
    memoryReferenceStyle: cleared ? (hasSavedMemory ? "light" : "none") : hasSavedMemory ? "light" : "none",
  };
}

/** Lightweight deterministic DM steward — routes tool choice before the employee runs. */
export function classifyDmMessageWithSteward(input: DmStewardInput): DmStewardDecision {
  const message = input.messageContent.trim();
  const contextPolicy = buildContextPolicy(input);

  if (!message) {
    return {
      intent: "clarification_needed",
      shouldRespond: true,
      route: "ask_clarification",
      browserRequired: false,
      searchRequired: false,
      reason: "Empty message — ask for clarification.",
      contextPolicy,
      costPolicy: { stewardModel: "efficient", estimatedWorkMinutes: 0 },
    };
  }

  if (isSocialMessage(message)) {
    return {
      intent: "social",
      shouldRespond: true,
      route: "employee_model",
      browserRequired: false,
      searchRequired: false,
      reason: "Social/greeting — concise employee reply.",
      contextPolicy,
      costPolicy: { stewardModel: "efficient", estimatedWorkMinutes: 1 },
    };
  }

  const stopRequest = detectWorkStopRequest(message);
  if (stopRequest.isStop) {
    return {
      intent: "stop_active_work",
      shouldRespond: true,
      route: "employee_model",
      browserRequired: false,
      searchRequired: false,
      reason: stopRequest.reason,
      contextPolicy,
      costPolicy: { stewardModel: "efficient", estimatedWorkMinutes: 0.5 },
    };
  }

  if (MEMORY_PATTERNS.some((p) => p.test(message))) {
    return {
      intent: "memory_update",
      shouldRespond: true,
      route: "employee_model",
      browserRequired: false,
      searchRequired: false,
      reason: "User asked to save memory — employee handles with memory tools.",
      contextPolicy: { ...contextPolicy, memoryReferenceStyle: "explicit" },
      costPolicy: { stewardModel: "efficient", estimatedWorkMinutes: 2 },
    };
  }

  if (TASK_PATTERNS.some((p) => p.test(message))) {
    return {
      intent: "task_request",
      shouldRespond: true,
      route: "employee_model",
      browserRequired: false,
      searchRequired: false,
      reason: "Task creation request — employee model with tools.",
      contextPolicy,
      costPolicy: { stewardModel: "efficient", estimatedWorkMinutes: 2 },
    };
  }

  // File deliverables before generic draft/write or market-research search diversion.
  if (ARTIFACT_PATTERNS.some((p) => p.test(message))) {
    return {
      intent: "artifact_request",
      shouldRespond: true,
      route: "employee_model",
      browserRequired: false,
      searchRequired: false,
      reason: "Drive/artifact deliverable — employee model with structured tools.",
      contextPolicy,
      costPolicy: { stewardModel: "efficient", estimatedWorkMinutes: 3 },
    };
  }

  if (/\b(draft|write|compose|brainstorm|outline)\b/i.test(message) && !isQuickFactLookup(message)) {
    return {
      intent: "direct_answer",
      shouldRespond: true,
      route: "employee_model",
      browserRequired: false,
      searchRequired: false,
      reason: "Writing/drafting request — employee model.",
      contextPolicy,
      costPolicy: { stewardModel: "efficient", estimatedWorkMinutes: 2 },
    };
  }

  const deepBrowser = requiresDeepBrowserResearch(message, {
    preferAgentMode: input.preferAgentMode,
    explicitBrowserTask: input.preferAgentMode,
  });

  if (deepBrowser) {
    return {
      intent: input.preferAgentMode ? "browser_task" : "deep_research_request",
      shouldRespond: true,
      route: "browser_research",
      browserRequired: true,
      searchRequired: false,
      reason: "Multi-step or explicit browser work requested.",
      contextPolicy,
      costPolicy: {
        stewardModel: "efficient",
        estimatedWorkMinutes: 15,
      },
    };
  }

  if (CLARIFY_PATTERNS.some((p) => p.test(message))) {
    return {
      intent: "clarification_needed",
      shouldRespond: true,
      route: "ask_clarification",
      browserRequired: false,
      searchRequired: false,
      reason: "User needs clarification.",
      contextPolicy,
      costPolicy: { stewardModel: "efficient", estimatedWorkMinutes: 1 },
    };
  }

  if (isQuickFactLookup(message) || input.preferFastSearch) {
    const searchDecision = decideSearchRoute(message, {
      preferAgentMode: input.preferAgentMode,
      preferFastSearch: input.preferFastSearch,
    });
    const dmRoute = mapSearchRouteToDmRoute(searchDecision.route);

    return {
      intent: "current_fact_question",
      shouldRespond: true,
      route: dmRoute === "employee_model" ? "gateway_search" : dmRoute,
      browserRequired: false,
      searchRequired: true,
      reason: searchDecision.reason,
      contextPolicy,
      costPolicy: {
        stewardModel: "efficient",
        estimatedWorkMinutes: searchDecision.estimatedWorkMinutes,
        avoidBrowserbaseReason: "One-question factual lookup — fast search preferred over live browser.",
      },
    };
  }

  const searchDecision = decideSearchRoute(message, {
    preferAgentMode: input.preferAgentMode,
  });

  if (
    searchDecision.route !== "none" &&
    searchDecision.route !== "browserbase" &&
    (searchDecision.need === "news" ||
      searchDecision.need === "market_research" ||
      searchDecision.need === "source_verification")
  ) {
    const dmRoute = mapSearchRouteToDmRoute(searchDecision.route);
    return {
      intent: "current_fact_question",
      shouldRespond: true,
      route: dmRoute,
      browserRequired: false,
      searchRequired: true,
      reason: searchDecision.reason,
      contextPolicy,
      costPolicy: {
        stewardModel: "efficient",
        estimatedWorkMinutes: searchDecision.estimatedWorkMinutes,
        avoidBrowserbaseReason: "Search-tier task — not live browser.",
      },
    };
  }

  return {
    intent: "direct_answer",
    shouldRespond: true,
    route: "employee_model",
    browserRequired: false,
    searchRequired: false,
    reason: "Normal reasoning/writing — employee model.",
    contextPolicy,
    costPolicy: { stewardModel: "efficient", estimatedWorkMinutes: 2 },
  };
}
