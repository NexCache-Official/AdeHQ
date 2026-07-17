import type { CollaborationPlan, CollaborationPlanStep } from "./types";

export type WorkLeaseStatus = "active" | "released" | "expired";

export type WorkLease = {
  id: string;
  brainStepId: string;
  employeeId: string;
  leasedAt: string;
  expiresAt: string;
  heartbeatAt: string;
  status: WorkLeaseStatus;
  agentRunId?: string;
};

export type SharedFindingVisibility = "lead_only" | "room" | "workspace";

export type SharedFinding = {
  id: string;
  brainRunId: string;
  brainStepId?: string;
  producedByEmployeeId: string;
  title: string;
  summary: string;
  evidenceSourceIds: string[];
  artifactIds: string[];
  confidence: number;
  visibility: SharedFindingVisibility;
  containsPrivateDmContext: false;
};

export type StewardStepProgressStatus =
  | "queued"
  | "leased"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export type StewardStepProgress = {
  stepId: string;
  objective: string;
  employeeId: string;
  employeeName?: string;
  capability: string;
  status: StewardStepProgressStatus;
  estimatedWh: number;
  actualWh?: number;
};

export type StewardProgressSnapshot = {
  brainRunId: string;
  leadEmployeeId: string;
  leadEmployeeName?: string;
  mode: CollaborationPlan["mode"];
  status: "planning" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
  steps: StewardStepProgress[];
  collaboratorNames: string[];
  estimatedWhMin: number;
  estimatedWhMax: number;
  actualWh: number;
  approvalRequired: boolean;
  failureMessage?: string;
};

export type CollaborationReceiptLine = {
  label: string;
  workHours: number;
};

export type CollaborationReceipt = {
  brainRunId: string;
  totalWorkHours: number;
  employeeCount: number;
  lines: CollaborationReceiptLine[];
  attribution: string;
};

export type StewardExecutionStartResult = {
  brainRunId: string;
  plan: CollaborationPlan;
  progress: StewardProgressSnapshot;
  queuedStepIds: string[];
  /** Responders ready to queue via queueAgentRuns */
  readySteps: CollaborationPlanStep[];
  blockedReason?: string;
};
