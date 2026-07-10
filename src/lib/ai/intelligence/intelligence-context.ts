import type { SearchRoute } from "@/lib/ai/search/types";

export type WorkMode =
  | "fast"
  | "balanced"
  | "deep"
  | "research"
  | "collaboration";

export type FastPathDecision =
  | "greeting"
  | "instant_answer"
  | "direct"
  | "obvious_search"
  | "obvious_browser_research"
  | "clarify"
  | "needs_router";

export type IntelligenceLayer =
  | "steward"
  | "fast_path"
  | "budget"
  | "knowledge"
  | "cache"
  | "router"
  | "search"
  | "tool"
  | "composer"
  | "background_learning";

export type ThinkingBudget = {
  assigned: number;
  consumed: number;
  maxSearches: number;
  maxEmployeeCalls: number;
  maxRouterCalls: number;
  allowBrowser: boolean;
  allowCollaboration: boolean;
};

export type KnowledgeSource = {
  providerId: string;
  sourceType: "memory" | "file" | "topic_summary" | "search_distill";
  id: string;
  title: string;
  excerpt?: string;
  href?: string;
};

export type IntelligenceStep = {
  layer: IntelligenceLayer;
  decision: string;
  confidence?: number;
  durationMs: number;
  metadata?: Record<string, unknown>;
};

export type IntelligenceContext = {
  workspaceId: string;
  roomId: string;
  topicId: string;
  messageId: string;
  userMessage: string;
  workMode?: WorkMode;
  selectedEmployeeId?: string;
  steward?: {
    decision: string;
    mentionGate?: "none" | "human_only" | "ai_mentioned" | "profession_match";
    selectedEmployeeIds: string[];
  };
  fastPath?: {
    decision: FastPathDecision;
    confidence: number;
    reason: string;
    suggestedSearchQuery?: string;
  };
  thinkingBudget: ThinkingBudget;
  knowledge?: {
    provider: string;
    found: boolean;
    confidence: number;
    answer?: string;
    sources: KnowledgeSource[];
  };
  instantAnswer?: {
    reply: string;
    kind: string;
    confidence: number;
    fact: string;
  };
  cache?: {
    hit: boolean;
    key?: string;
    sharedFromRunId?: string;
  };
  router?: {
    route: "direct" | "search" | "browse" | "clarify";
    confidence: number;
    reasoning: string;
    searchQuery?: string;
  };
  researchLevel?: 0 | 1 | 2 | 3;
  search?: {
    route?: SearchRoute;
    provider?: string;
    query?: string;
    confidence?: number;
    sourceCount?: number;
  };
  composer?: {
    skippedEmployeeModel: boolean;
    answerSource: "instant" | "knowledge" | "cache" | "search" | "model";
  };
  backgroundLearning?: {
    queued: boolean;
    memoryId?: string;
    autoSaved?: boolean;
  };
  steps: IntelligenceStep[];
};

export function createIntelligenceContext(input: {
  workspaceId: string;
  roomId: string;
  topicId: string;
  messageId: string;
  userMessage: string;
  selectedEmployeeId?: string;
  workMode?: WorkMode;
}): IntelligenceContext {
  return {
    ...input,
    thinkingBudget: {
      assigned: 3,
      consumed: 0,
      maxSearches: 1,
      maxEmployeeCalls: 1,
      maxRouterCalls: 1,
      allowBrowser: false,
      allowCollaboration: false,
    },
    steps: [],
  };
}
