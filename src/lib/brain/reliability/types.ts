/**
 * PR-17.5 unified Brain execution model (lifecycle foundation for PR-19).
 * Provider attempts remain separate from logical steps.
 */

export type BrainRunLifecycleStatus =
  | "planning"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type BrainStepCapability =
  | "reasoning"
  | "search"
  | "vision"
  | "coding"
  | "image"
  | "video"
  | "speech_to_text"
  | "text_to_speech"
  | "tool"
  | "synthesis";

export type BrainStepLifecycleStatus =
  | "queued"
  | "leased"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type FailureClass =
  | "transient_provider"
  | "malformed_output"
  | "permission"
  | "user_input"
  | "insufficient_evidence"
  | "internal_application"
  | "cancelled"
  | "budget";

export type PermissionEnvelope = {
  humanUserId: string;
  aiEmployeeId?: string;
  workspaceId: string;
  roomId?: string;
  topicId?: string;
  accessVersion: number;
  permittedCapabilities: string[];
  permittedResources: string[];
  prohibitedResources: string[];
};

export type RunBudget = {
  estimatedWhMin: number;
  estimatedWhMax: number;
  approvedWhLimit: number;
  hardWhLimit: number;
  actualWh: number;
};

export type BrainRunRecord = {
  id: string;
  workspaceId: string;
  initiatedByUserId: string;
  roomId?: string;
  topicId?: string;
  leadEmployeeId?: string;
  status: BrainRunLifecycleStatus;
  estimatedWhMin: number;
  estimatedWhMax: number;
  hardWhLimit: number;
  actualWh: number;
  permissionVersion: number;
  catalogVersion: number;
  routerVersion: number;
  permissionEnvelope?: PermissionEnvelope;
  createdAt: string;
  completedAt?: string;
};

export type BrainStepRecord = {
  id: string;
  brainRunId: string;
  capability: BrainStepCapability;
  assignedEmployeeId?: string;
  status: BrainStepLifecycleStatus;
  inputContractVersion: number;
  outputContractVersion: number;
  idempotencyKey: string;
  estimatedWh: number;
  actualWh: number;
  failureClass?: FailureClass;
};

export type RouteHealth = {
  routeId: string;
  recentSuccessRate: number;
  recentTimeoutRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  schemaFailureRate: number;
  disabledUntil?: string;
};

export type RetryDecision =
  | { action: "retry"; delayMs: number }
  | { action: "fallback" }
  | { action: "fail"; chargeUser: boolean }
  | { action: "repair_once" };
