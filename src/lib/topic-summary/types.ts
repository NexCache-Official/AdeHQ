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
};

export type TopicSummaryMemorySuggestion = {
  text: string;
  scope: "workspace" | "room" | "topic" | "employee";
  reason: string;
  sourceMessageId?: string;
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
