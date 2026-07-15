import type { AIEmployee } from "@/lib/types";

export type LegacyOrchestrationIntent =
  | "silent_note"
  | "social_broadcast"
  | "direct_reply"
  | "panel_response"
  | "lead_collaborator"
  | "handoff"
  | "ambient_smart_assist";

export type RoomStewardIntent =
  | "silent_note"
  | "social_ack"
  | "social_broadcast"
  | "direct_question"
  | "answer_to_pending_question"
  | "task_request"
  | "work_update"
  | "ask_for_opinion"
  | "handoff_response"
  | "employee_followup_needed"
  | "offer_help"
  | "multi_employee_collaboration"
  | "brainstorm"
  | "topic_shift"
  | "correction_or_clarification";

export type OrchestrationIntent = LegacyOrchestrationIntent | RoomStewardIntent;

export type OrchestrationResponseRole =
  | "lead"
  | "collaborator"
  | "panelist"
  | "direct"
  | "social";

export type RoomStewardParticipationMode =
  | "manual_only"
  | "smart_assist"
  | "active_team"
  | "talent_observation";

export type PendingQuestionAnswerType =
  | "product_type"
  | "target_customer"
  | "differentiator"
  | "approval"
  | "preference"
  | "missing_detail"
  | "unknown";

export type TopicOrchestrationPendingQuestion = {
  id: string;
  askedByEmployeeId: string;
  askedAtMessageId: string;
  questionText: string;
  expectedAnswerType: PendingQuestionAnswerType;
  createdAt: string;
  expiresAt?: string;
  answeredAtMessageId?: string;
  status: "open" | "answered" | "expired";
};

export type TopicOrchestrationWorkIntent =
  | "launch_pitch"
  | "market_research"
  | "sales_pitch"
  | "hiring"
  | "artifact_creation"
  | "general_discussion"
  | "unknown";

export type TopicOrchestrationState = {
  topicId: string;
  roomId: string;
  workspaceId: string;
  activeEmployeeIds: string[];
  lastHumanMessageId?: string;
  lastAiMessageId?: string;
  pendingQuestions: TopicOrchestrationPendingQuestion[];
  currentWorkIntent?: TopicOrchestrationWorkIntent;
  lastDecision?: string;
  lastProjectEntity?: string;
  /** Human message ids already flushed in a typing-burst orchestration. */
  burstConsumedMessageIds?: string[];
  burstLockToken?: string;
  burstLockUntil?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type RoomStewardResponseStyle =
  | "answer"
  | "continue_thread"
  | "ask_followup"
  | "offer_help"
  | "panel"
  | "silent";

export type RoomStewardDecision = {
  intent: RoomStewardIntent;
  confidence: number;
  shouldRespond: boolean;
  selectedEmployeeIds: string[];
  offerOnlyEmployeeIds: string[];
  responseStyle: RoomStewardResponseStyle;
  reason: string;
  pendingQuestionUpdates: Array<{
    questionId: string;
    status: "answered" | "expired";
    answeredAtMessageId?: string;
    extractedAnswer?: string;
  }>;
  newPendingQuestions?: TopicOrchestrationPendingQuestion[];
  suppressedEmployeeIds?: string[];
  participation: "manual_only" | "smart_assist" | "active_team" | "talent_observation";
  costPolicy: {
    stewardModel: "efficient";
    maxEmployeeCalls: number;
    estimatedEmployeeCalls: number;
    stewardCall: true;
    selectedEmployeeCalls: number;
    suppressedEmployeeCount: number;
    estimatedCostSavedBySuppression?: number;
  };
};

export type SuggestedConversationAction =
  | {
      type: "create_topic";
      title: string;
      reason: string;
      confidence: number;
      suggestedMessageIds?: string[];
    }
  | {
      type: "move_to_topic";
      topicId: string;
      topicTitle: string;
      reason: string;
      confidence: number;
      suggestedMessageIds?: string[];
    }
  | {
      type: "invite_employee";
      employeeId: string;
      employeeName?: string;
      reason: string;
      confidence: number;
    }
  | {
      type: "create_task";
      title: string;
      reason: string;
      confidence: number;
    }
  | {
      type: "save_memory";
      text: string;
      reason: string;
      confidence: number;
    };

export type OrchestrationPlan = {
  intent: OrchestrationIntent;
  confidence: number;
  reason: string;
  selectedEmployeeIds: string[];
  offerOnlyEmployeeIds?: string[];
  leadEmployeeId?: string | null;
  collaboratorEmployeeIds?: string[];
  shouldRespond: boolean;
  responseStyle?: RoomStewardResponseStyle;
  responseOrder: Array<{
    employeeId: string;
    role: OrchestrationResponseRole;
    delayMs?: number;
  }>;
  suggestedActions: SuggestedConversationAction[];
  workLogRequired: boolean;
  workLogReason?: string | null;
  pendingQuestionUpdates?: RoomStewardDecision["pendingQuestionUpdates"];
  newPendingQuestions?: TopicOrchestrationPendingQuestion[];
  suppressedEmployeeIds?: string[];
  participation?: RoomStewardDecision["participation"];
  costPolicy?: RoomStewardDecision["costPolicy"];
  stewardDecision?: RoomStewardDecision;
};

export type OrchestrationWorkLogAction =
  | "orchestration_completed"
  | "panel_response_completed"
  | "collaboration_completed"
  | "handoff_completed"
  | "topic_suggested"
  | "topic_created"
  | "messages_moved"
  | "task_suggested"
  | "memory_suggested";

/** Persisted per-employee status in conversation_orchestrations.employee_statuses */
export type PersistedOrchestrationEmployeeStatus = {
  employeeId: string;
  phase: "planned" | "reading" | "replying" | "waiting" | "completed" | "failed";
  detail?: string | null;
  waitingOnEmployeeName?: string | null;
  runId?: string | null;
  updatedAt?: string;
};

export type StoredOrchestrationRecord = {
  id: string;
  roomId: string;
  topicId: string | null;
  triggerMessageId: string;
  intent: OrchestrationIntent;
  confidence: number;
  reason: string;
  selectedEmployeeIds: string[];
  leadEmployeeId: string | null;
  collaboratorEmployeeIds: string[];
  responseOrder: OrchestrationPlan["responseOrder"];
  workLogRequired: boolean;
  workLogReason: string | null;
  status: "planned" | "running" | "completed" | "failed" | "cancelled";
  employeeStatuses: PersistedOrchestrationEmployeeStatus[];
  completionWorkLogAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AIEmployeeProfile = Pick<
  AIEmployee,
  | "id"
  | "name"
  | "role"
  | "roleKey"
  | "instructions"
  | "seniority"
  | "metadata"
  | "systemEmployeeKey"
  | "isSystemEmployee"
  | "intelligencePolicy"
>;

export type OrchestratorMessage = {
  id: string;
  senderType: "human" | "ai" | "system";
  senderId?: string | null;
  text: string;
  createdAt: string;
  topicId?: string | null;
};

export type OrchestratorInput = {
  workspaceId: string;
  roomId: string;
  topicId?: string | null;
  userId: string;
  messageId: string;
  messageText: string;
  mentionedEmployeeIds: string[];
  mentionedHumanIds?: string[];
  roomEmployees: AIEmployeeProfile[];
  topicEmployees: AIEmployeeProfile[];
  recentMessages: OrchestratorMessage[];
  existingTopics: Array<{
    id: string;
    title: string;
    summary?: string | null;
  }>;
  smartAssistEnabled: boolean;
  participationMode?: RoomStewardParticipationMode | "silent_observation" | "smart_assist_lite";
  topicState?: TopicOrchestrationState;
  isDm?: boolean;
  /** DM counterpart when `isDm` — used to auto-select the employee who should reply. */
  dmEmployeeId?: string | null;
  /** Maya's DM uses client-side flows (general chat + hiring topics), not room orchestration. */
  isMayaDm?: boolean;
  isMayaHiringSession?: boolean;
};

export type TopicStewardSuggestion =
  | {
      type: "create_topic";
      title: string;
      description?: string;
      reason: string;
      confidence: number;
      messageIds: string[];
      contextSummary?: string;
      sourceScope?: "room" | "topic" | "dm";
      previewBullets?: string[];
      triggerMessageId?: string;
      /** When true, accepting should move relevant messages into the new topic. */
      migrateMessages?: boolean;
    }
  | {
      type: "move_to_existing_topic";
      topicId: string;
      topicTitle: string;
      reason: string;
      confidence: number;
      messageIds: string[];
    }
  | {
      type: "split_topic";
      title: string;
      reason: string;
      confidence: number;
      messageIds: string[];
    };

export type EmployeeCollaborationPermissions = {
  canReplyInRooms: boolean;
  canJoinTopics: boolean;
  canSuggestTopics: boolean;
  canCreateTopics: boolean;
  canMoveMessages: boolean;
  canInviteEmployees: boolean;
  requiresApprovalForTopicChanges: boolean;
};
