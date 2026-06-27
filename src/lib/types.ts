// ===========================================================================
// AdeHQ — core domain types
// ===========================================================================

export type EmployeeStatus =
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

export type AIEmployee = {
  id: string;
  name: string;
  role: string;
  roleKey: EmployeeRoleKey;
  provider: string;
  model: string;
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
  | "support";

export type MessageArtifact = {
  type: "task" | "memory" | "approval" | "work_log";
  id: string;
  label: string;
};

export type RoomMessage = {
  id: string;
  roomId: string;
  senderType: "human" | "ai" | "system";
  senderId: string;
  senderName: string;
  content: string;
  mentions?: string[];
  createdAt: string;
  artifacts?: MessageArtifact[];
  pending?: boolean;
  failed?: boolean;
};

export type RoomKind = "channel" | "dm";

export type ProjectRoom = {
  id: string;
  name: string;
  kind: RoomKind;
  dmEmployeeId?: string; // set when kind === "dm"
  description: string;
  brief: string;
  humans: string[];
  aiEmployees: string[];
  messages: RoomMessage[];
  tasks: string[];
  memory: string[];
  unread: number;
  accent: string;
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
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeType: "human" | "ai";
  assigneeId: string;
  createdFrom?: string;
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
  type: MemoryType;
  title: string;
  content: string;
  status: MemoryStatus;
  createdByType: "human" | "ai" | "system";
  createdById: string;
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
  requestedBy: string;
  title: string;
  description: string;
  risk: ApprovalRisk;
  status: ApprovalStatus;
  actionType: ApprovalActionType;
  createdAt: string;
  resolvedAt?: string;
};

export type WorkLogStatus = "success" | "pending" | "failed" | "needs_approval";

export type WorkLogEvent = {
  id: string;
  roomId: string;
  employeeId: string;
  action: string;
  summary: string;
  toolUsed?: string;
  status: WorkLogStatus;
  relatedEntityType?: "task" | "memory" | "approval" | "message";
  relatedEntityId?: string;
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
  | "openai"
  | "anthropic"
  | "gemini"
  | "perplexity"
  | "mock";

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
  message: string;
  allEmployees: AIEmployee[];
  recentMemory: MemoryEntry[];
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
  tasks: Task[];
  memory: MemoryEntry[];
  approvals: Approval[];
  workLog: WorkLogEvent[];
  tools: Tool[];
  calls: Call[];
  settings: Settings;
};
