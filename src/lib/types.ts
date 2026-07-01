// ===========================================================================
// AdeHQ — core domain types
// ===========================================================================

export type EmployeeStatus =
  | "online"
  | "idle"
  | "working"
  | "waiting_approval"
  | "on_call"
  | "blocked";

export type ToolStatus = "connected" | "mock" | "not_connected";
export type ToolPermission = "none" | "read" | "write" | "admin";

export type HumanUser = {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: string;
};

export type WorkspaceMode = "real" | "demo";

export type Workspace = {
  id: string;
  name: string;
  slug?: string;
  plan: string;
  workspaceMode: WorkspaceMode;
  onboardingComplete?: boolean;
};

export type WorkspaceMemberRole = "owner" | "admin" | "member" | "viewer";

export type WorkspaceMemberStatus = "active" | "removed";

export type WorkspaceMember = {
  workspaceId: string;
  userId: string;
  name?: string;
  email?: string;
  role: WorkspaceMemberRole;
  status?: WorkspaceMemberStatus;
  joinedAt?: string;
  createdAt: string;
};

export type WorkspaceInvitationStatus = "pending" | "accepted" | "declined" | "revoked" | "expired";

export type WorkspaceInvitation = {
  id: string;
  workspaceId: string;
  workspaceName?: string;
  invitedEmail: string;
  invitedBy: string;
  invitedByName?: string;
  role: WorkspaceMemberRole;
  status: WorkspaceInvitationStatus;
  token: string;
  expiresAt?: string;
  acceptedBy?: string;
  acceptedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ToolAccess = {
  toolId: string;
  name: string;
  category: string;
  status: ToolStatus;
  permission: ToolPermission;
  lastUsedAt?: string;
};

export type EmployeePermissions = {
  readMemory: boolean;
  writeDraftMemory: boolean;
  pinMemory: boolean;
  createTasks: boolean;
  assignTasks: boolean;
  messageEmployees: boolean;
  startCalls: boolean;
  requestApproval: boolean;
  approvalBeforeExternal: boolean;
  approvalBeforeEmails: boolean;
  approvalBeforeCode: boolean;
  approvalBeforeBilling: boolean;
};

export type SystemEmployeeMetadata = {
  dmOnly?: boolean;
  canBeArchived?: boolean;
  canBeAssignedToChannels?: boolean;
  isDefaultWorkspaceEmployee?: boolean;
  purpose?: string;
  collaborationPermissions?: import("@/lib/orchestration/types").EmployeeCollaborationPermissions;
};

export type AIEmployee = {
  id: string;
  name: string;
  role: string;
  roleKey: EmployeeRoleKey;
  provider: string;
  model: string;
  modelMode?: ModelMode;
  seniority: string;
  status: EmployeeStatus;
  currentTask?: string;
  instructions: string;
  communicationStyle: string;
  successCriteria: string;
  tools: ToolAccess[];
  permissions: EmployeePermissions;
  memoryCount: number;
  tasksCompleted: number;
  messagesSent: number;
  approvalsRequested: number;
  avgResponseTime: string;
  trustScore: number;
  accent: string; // hex used for avatar gradient
  defaultRoomId?: string;
  participationStyle?: ParticipationStyle;
  isSystemEmployee?: boolean;
  systemEmployeeKey?: string | null;
  metadata?: SystemEmployeeMetadata;
  lastActiveAt: string;
  createdAt: string;
};

export type EmployeeRoleKey =
  | "research"
  | "pm"
  | "engineering"
  | "design"
  | "marketing"
  | "gamedev"
  | "operations"
  | "sales"
  | "support"
  | "recruiting_manager";

export type ModelMode =
  | "cheap"
  | "balanced"
  | "strong"
  | "long_context"
  | "coding"
  | "creative";

export type MentionRef = {
  type: "ai_employee";
  id: string;
  label: string;
};

export type MessageArtifact = {
  type: "task" | "memory" | "approval" | "work_log" | "email_draft";
  id: string;
  label: string;
  meta?: {
    subject?: string;
    body?: string;
    recipient?: string;
    company?: string;
  };
};

export type AiParticipationMode =
  | "silent_observation"
  | "manual_only"
  | "smart_assist_lite"
  | "smart_assist"
  | "active_team";

export type ParticipationStyle =
  | "quiet_specialist"
  | "balanced_teammate"
  | "proactive_operator"
  | "critical_reviewer"
  | "social_coordinator";

export type ResponseReason =
  | "explicit_mention"
  | "dm_default"
  | "group_greeting"
  | "smart_assist_role_match"
  | "ai_mention"
  | "handoff"
  | "slash_command"
  | "blocked_cooldown"
  | "blocked_policy"
  | "collaboration_lead"
  | "collaboration_collaborator"
  | "panel_response"
  | "sequential_dependent"
  | "ambient_help_request"
  | "ambient_role_match"
  | "ambient_collaboration_lead"
  | "ambient_collaboration_collaborator";

export type ConversationMode =
  | "direct_reply"
  | "broadcast_social"
  | "panel_response"
  | "lead_collaborator"
  | "handoff"
  | "ambient_smart"
  | "ambient_collaboration"
  | "silent";

export type CollaborationRole = "lead" | "collaborator" | "reviewer" | "observer" | "panelist";

export type CollaborationPlanStatus = "active" | "completed" | "cancelled";

export type ConversationParticipant = {
  employeeId: string;
  employeeName: string;
  role: CollaborationRole;
  waitingOnEmployeeId?: string;
  waitingOnEmployeeName?: string;
  runId?: string;
};

export type ConversationPlan = {
  mode: ConversationMode;
  collaborationId: string;
  rootTriggerMessageId?: string;
  status: CollaborationPlanStatus;
  participants: ConversationParticipant[];
  pendingParticipants: ConversationParticipant[];
  staggerMs?: number;
};

export type TopicStatus = "active" | "paused" | "resolved" | "archived";
export type TopicPriority = "low" | "normal" | "high" | "urgent";
export type TopicMemberRole = "owner" | "participant" | "watcher";
export type TopicNotificationLevel = "muted" | "mentions" | "normal" | "all";

export type RoomTopic = {
  id: string;
  workspaceId: string;
  roomId: string;
  title: string;
  slug?: string | null;
  description?: string | null;
  status: TopicStatus;
  priority: TopicPriority;
  createdByType: "human" | "ai" | "system";
  createdById?: string | null;
  summary?: string | null;
  pinnedSummary?: string | null;
  lastMessageAt?: string | null;
  lastActivityAt: string;
  messageCount: number;
  taskCount: number;
  openTaskCount: number;
  memoryCount: number;
  approvalCount: number;
  agentRunCount: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type TopicMember = {
  id: string;
  workspaceId: string;
  roomId: string;
  topicId: string;
  memberType: "human" | "ai";
  memberId: string;
  role: TopicMemberRole;
  notificationLevel: TopicNotificationLevel;
  lastReadMessageId?: string | null;
  lastReadAt?: string | null;
  createdAt: string;
};

export type MessageSeenBy = {
  id: string;
  name: string;
  type: "human" | "ai";
};

export type RoomMessage = {
  id: string;
  roomId: string;
  topicId?: string;
  senderType: "human" | "ai" | "system";
  senderId: string;
  senderName: string;
  content: string;
  mentions?: string[];
  mentionsJson?: MentionRef[];
  agentRunId?: string;
  triggerMessageId?: string;
  responseReason?: ResponseReason;
  createdAt: string;
  artifacts?: MessageArtifact[];
  pending?: boolean;
  failed?: boolean;
  deliveryStatus?: "sending" | "delivered" | "failed";
  deliveredAt?: string;
  seenBy?: MessageSeenBy[];
};

/** `channel` = multi-member group space; `dm` = private 1:1 with one AI employee. */
export type RoomKind = "channel" | "dm";

export type ChannelStatus = "active" | "archived";

/**
 * A channel (group collaboration space) or DM. Stored in Supabase `channels` table.
 * `roomId` on topics/messages is the parent channel id (group channel or DM).
 */
export type ProjectRoom = {
  id: string;
  name: string;
  kind: RoomKind;
  /** Required when kind === "dm" — the AI employee this DM belongs to. */
  dmEmployeeId?: string;
  description: string;
  brief: string;
  humans: string[];
  aiEmployees: string[];
  messages: RoomMessage[];
  tasks: string[];
  memory: string[];
  unread: number;
  accent: string;
  /** Group channels can be archived; DMs stay active. */
  status?: ChannelStatus;
  createdAt: string;
  updatedAt: string;
};

export type TaskStatus =
  | "open"
  | "in_progress"
  | "waiting_approval"
  | "blocked"
  | "done";
export type TaskPriority = "low" | "medium" | "high";

export type Task = {
  id: string;
  roomId: string;
  topicId?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeType: "human" | "ai";
  assigneeId: string;
  createdFrom?: string;
  createdByRunId?: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
};

export type MemoryType =
  | "decision"
  | "research"
  | "architecture"
  | "preference"
  | "instruction"
  | "general";
export type MemoryStatus = "draft" | "approved" | "pinned" | "superseded";

export type MemoryEntry = {
  id: string;
  roomId: string;
  topicId?: string;
  type: MemoryType;
  title: string;
  content: string;
  status: MemoryStatus;
  createdByType: "human" | "ai" | "system";
  createdById: string;
  createdByRunId?: string;
  createdAt: string;
};

export type ApprovalRisk = "low" | "medium" | "high";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ApprovalActionType =
  | "tool_access"
  | "memory_pin"
  | "task_creation"
  | "external_action";

export type Approval = {
  id: string;
  roomId: string;
  topicId?: string;
  requestedBy: string;
  title: string;
  description: string;
  risk: ApprovalRisk;
  status: ApprovalStatus;
  actionType: ApprovalActionType;
  createdByRunId?: string;
  createdAt: string;
  resolvedAt?: string;
};

export type WorkLogStatus = "success" | "pending" | "failed" | "needs_approval";

export type WorkLogEvent = {
  id: string;
  roomId: string;
  topicId?: string;
  employeeId: string;
  action: string;
  summary: string;
  toolUsed?: string;
  status: WorkLogStatus;
  relatedEntityType?: "task" | "memory" | "approval" | "message";
  relatedEntityId?: string;
  agentRunId?: string;
  createdAt: string;
};

export type ToolCategory =
  | "Communication"
  | "Coding"
  | "Design"
  | "Research"
  | "Storage"
  | "Productivity"
  | "Game development"
  | "Business"
  | "Model providers";

export type Tool = {
  id: string;
  name: string;
  category: ToolCategory;
  description: string;
  status: ToolStatus;
};

export type ProviderId =
  | "siliconflow"
  | "anthropic"
  | "gemini"
  | "perplexity"
  | "mock";

export type WorkspaceAiSettings = {
  workspaceId: string;
  aiEnabled: boolean;
  defaultProvider: "siliconflow" | "mock";
  dailyTokenLimit: number;
  dailyCostLimitUsd: number;
  employeeDailyTokenLimit: number;
  maxParallelRuns: number;
  maxOutputTokens: number;
  maxToolRunsPerTask: number;
  maxHandoffDepth: number;
  createdAt?: string;
  updatedAt?: string;
};

export type AgentRunStatus =
  | "queued"
  | "waiting"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export type AgentRun = {
  workspaceId: string;
  id: string;
  employeeId: string;
  roomId: string;
  topicId?: string;
  taskId?: string;
  triggerMessageId: string;
  responseMessageId?: string;
  status: AgentRunStatus;
  provider: string;
  model: string;
  modelMode: ModelMode;
  estimatedCostUsd: number;
  actualCostUsd?: number;
  latencyMs?: number;
  parentRunId?: string;
  handoffDepth: number;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
};

export type AgentRunStepType =
  | "thinking"
  | "model_call"
  | "tool_call"
  | "memory_write"
  | "task_create"
  | "approval_request"
  | "error";

export type AgentRunStep = {
  id: string;
  workspaceId: string;
  agentRunId: string;
  roomId: string;
  topicId?: string;
  employeeId: string;
  stepType: AgentRunStepType;
  title: string;
  summary: string;
  status: "running" | "success" | "failed" | "skipped";
  metadata?: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
};

export type AiUsageEventStatus =
  | "reserved"
  | "success"
  | "failed"
  | "blocked"
  | "fallback";

export type AiUsageEvent = {
  id: string;
  workspaceId: string;
  agentRunId?: string;
  employeeId?: string;
  roomId?: string;
  topicId?: string;
  triggerMessageId?: string;
  responseMessageId?: string;
  provider: string;
  model: string;
  modelMode?: ModelMode;
  status: AiUsageEventStatus;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedInputTokens?: number;
  estimatedMaxOutputTokens?: number;
  estimatedCostUsd: number;
  actualCostUsd?: number;
  latencyMs?: number;
  fallbackUsed: boolean;
  errorMessage?: string;
  createdAt: string;
  finalizedAt?: string;
};

export type Settings = {
  mode: "mock" | "live";
  activeProvider: ProviderId;
};

export type CallStatus = "live" | "ended";

export type CallParticipant = {
  id: string;
  type: "human" | "ai";
  name: string;
  accent: string;
  speaking: boolean;
};

export type CallTranscriptLine = {
  id: string;
  speakerId: string;
  speakerName: string;
  text: string;
  createdAt: string;
};

export type Call = {
  id: string;
  roomId: string;
  title: string;
  status: CallStatus;
  participants: CallParticipant[];
  transcript: CallTranscriptLine[];
  actionItems: string[];
  startedAt: string;
  endedAt?: string;
};

// ---------------------------------------------------------------------------
// AI engine I/O
// ---------------------------------------------------------------------------

export type EmployeeResponseEffect = {
  workLog: Array<Partial<WorkLogEvent>>;
  tasks: Array<Partial<Task>>;
  memory: Array<Partial<MemoryEntry>>;
  approvals: Array<Partial<Approval>>;
  emailDrafts?: Array<{
    subject: string;
    body: string;
    recipient?: string;
    company?: string;
  }>;
  statusChange?: EmployeeStatus;
  handoffTo?: string[];
  currentTask?: string;
};

export type EmployeeResponse = {
  employeeId: string;
  employeeName: string;
  reply: string;
  effect: EmployeeResponseEffect;
};

export type SendMessageInput = {
  employee: AIEmployee;
  room: ProjectRoom;
  topic?: RoomTopic;
  message: string;
  allEmployees: AIEmployee[];
  recentMemory: MemoryEntry[];
  topicTasks?: Task[];
  topicApprovals?: Approval[];
  topicWorkLogs?: WorkLogEvent[];
};

// ---------------------------------------------------------------------------
// Global persisted state
// ---------------------------------------------------------------------------

export type DemoState = {
  version: number;
  user: HumanUser | null;
  workspace: Workspace;
  workspaceMembers: WorkspaceMember[];
  workspaceInvitations: WorkspaceInvitation[];
  onboardingComplete: boolean;
  employees: AIEmployee[];
  rooms: ProjectRoom[];
  topics: RoomTopic[];
  topicMembers: TopicMember[];
  tasks: Task[];
  memory: MemoryEntry[];
  approvals: Approval[];
  workLog: WorkLogEvent[];
  tools: Tool[];
  calls: Call[];
  settings: Settings;
};
