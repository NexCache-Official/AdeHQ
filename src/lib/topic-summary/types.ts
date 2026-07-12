export type TopicSummaryQuestion = {
  text: string;
  sourceMessageId?: string;
};

export type TopicSummaryFact = {
  text: string;
  sourceMessageId?: string;
};

export type TopicSummaryNextAction = {
  title: string;
  ownerEmployeeId?: string;
  sourceMessageId?: string;
  status?: "Planned" | "In progress" | "Completed" | "Waiting for clarification";
};

export type TopicSummaryMemorySuggestion = {
  /** Legacy raw text — prefer title + content when present */
  text: string;
  title?: string;
  content?: string;
  category?: string;
  tags?: string[];
  scope: "workspace" | "room" | "topic" | "employee_dm" | "employee_profile" | "employee";
  reason: string;
  sourceMessageId?: string;
  suggestedByEmployeeId?: string;
};

export type TopicSummary = {
  id?: string;
  workspaceId: string;
  roomId: string;
  topicId: string;
  summary: string;
  whatHappened: string;
  currentDecision: string | null;
  openQuestions: TopicSummaryQuestion[];
  keyFacts: TopicSummaryFact[];
  nextActions: TopicSummaryNextAction[];
  suggestedMemory: TopicSummaryMemorySuggestion[];
  sourceMessageIds: string[];
  sourceWorkLogIds: string[];
  lastRefreshedAt: string | null;
  memorySuggestionLifecycle?: Record<string, import("@/lib/memory/suggestion-lifecycle").MemorySuggestionState>;
};

export type TopicSummaryRefreshTrigger =
  | "manual"
  | "meaningful_ai_reply"
  | "panel_collaboration_completed"
  | "handoff_completed"
  | "topic_created"
  | "task_created"
  | "memory_suggested"
  | "approval_requested";

export const TOPIC_SUMMARY_AUTO_COOLDOWN_MS = 3 * 60 * 1000;

/**
 * Cooldown applied after a FAILED auto-refresh attempt specifically. The normal
 * cooldown above only kicks in once `lastRefreshedAt` is set, which never happens
 * on failure — without this, a topic whose summary generation keeps failing would
 * retry (and re-burn tokens) on every subsequent "meaningful_ai_reply" trigger,
 * i.e. potentially every single message.
 */
export const TOPIC_SUMMARY_FAILURE_COOLDOWN_MS = 3 * 60 * 1000;
