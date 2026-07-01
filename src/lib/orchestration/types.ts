import type { AIEmployee } from "@/lib/types";

export type OrchestrationIntent =
  | "silent_note"
  | "social_broadcast"
  | "direct_reply"
  | "panel_response"
  | "lead_collaborator"
  | "handoff"
  | "ambient_smart_assist";

export type OrchestrationResponseRole =
  | "lead"
  | "collaborator"
  | "panelist"
  | "direct"
  | "social";

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
  leadEmployeeId?: string | null;
  collaboratorEmployeeIds?: string[];
  shouldRespond: boolean;
  responseOrder: Array<{
    employeeId: string;
    role: OrchestrationResponseRole;
    delayMs?: number;
  }>;
  suggestedActions: SuggestedConversationAction[];
  workLogRequired: boolean;
  workLogReason?: string | null;
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
  roomEmployees: AIEmployeeProfile[];
  topicEmployees: AIEmployeeProfile[];
  recentMessages: OrchestratorMessage[];
  existingTopics: Array<{
    id: string;
    title: string;
    summary?: string | null;
  }>;
  smartAssistEnabled: boolean;
  isDm?: boolean;
  isMayaHiringSession?: boolean;
};

export type TopicStewardSuggestion =
  | {
      type: "create_topic";
      title: string;
      reason: string;
      confidence: number;
      messageIds: string[];
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
