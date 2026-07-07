// ===========================================================================
// Autonomous employees — types for the plan → act → observe → report loop.
// ===========================================================================

import type { ToolCallEffectItem } from "@/lib/types";

export type AutonomousSessionStatus =
  | "queued"
  | "planning"
  | "running"
  | "waiting_approval"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

export type AutonomousSession = {
  id: string;
  workspaceId: string;
  employeeId: string;
  createdByUserId?: string;
  roomId?: string;
  topicId?: string;
  taskId?: string;
  objective: string;
  status: AutonomousSessionStatus;
  stepBudget: number;
  stepsUsed: number;
  costBudgetUsd: number;
  costUsedUsd: number;
  plan?: string[];
  pendingApprovalId?: string;
  resultSummary?: string;
  stopRequested: boolean;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type AutonomousStepKind =
  | "plan"
  | "thought"
  | "tool_call"
  | "observation"
  | "approval"
  | "report"
  | "error"
  | "status";

export type AutonomousSessionStep = {
  id: string;
  workspaceId: string;
  sessionId: string;
  seq: number;
  kind: AutonomousStepKind;
  title: string;
  detail?: string;
  toolName?: string;
  toolRunId?: string;
  status: "running" | "success" | "failed" | "pending";
  metadata: Record<string, unknown>;
  createdAt: string;
};

/**
 * The model's decision for one iteration. `status`:
 *  - "continue" → execute toolCalls, then loop again.
 *  - "done"     → objective complete; `report` is the final summary.
 *  - "blocked"  → cannot proceed (missing info / capability); `report` explains.
 */
export type AutonomyDecision = {
  thought: string;
  status: "continue" | "done" | "blocked";
  toolCalls: ToolCallEffectItem[];
  report?: string;
  plan?: string[];
  /** Real model cost for this decision (USD), when the brain can report it. */
  usageCostUsd?: number;
};

/** Observation fed back into the next iteration (one per executed tool call). */
export type AutonomyObservation = {
  tool: string;
  status: string;
  summary: string;
};

export type AutonomyBrainContext = {
  objective: string;
  employeeName: string;
  employeeRole: string;
  iteration: number;
  stepBudget: number;
  stepsUsed: number;
  /** Registry tool docs the employee may call. */
  toolCatalog: string;
  /** Prior thoughts + observations, newest last. */
  history: Array<{ thought: string; observations: AutonomyObservation[] }>;
  /** Set when resuming after an approval was resolved. */
  lastApprovalOutcome?: { approved: boolean; summary: string };
};

/** Injectable model call — real impl uses Runtime V2; tests script it. */
export type AutonomyBrain = (ctx: AutonomyBrainContext) => Promise<AutonomyDecision>;

export type IterationOutcome = {
  status: AutonomousSessionStatus;
  /** True when the caller should immediately schedule another iteration. */
  shouldContinue: boolean;
};
