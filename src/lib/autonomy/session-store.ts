// ===========================================================================
// Autonomous session persistence — sessions + streamable step timeline.
// ===========================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AutonomousSession, AutonomousSessionStep, AutonomousStepKind } from "./types";

type DbRow = Record<string, unknown>;

export const DEFAULT_STEP_BUDGET = 8;
export const DEFAULT_COST_BUDGET_USD = 0.5;
export const MAX_STEP_BUDGET = 20;
export const MAX_COST_BUDGET_USD = 25;

export function sessionFromRow(row: DbRow): AutonomousSession {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    employeeId: String(row.employee_id),
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : undefined,
    roomId: row.room_id ? String(row.room_id) : undefined,
    topicId: row.topic_id ? String(row.topic_id) : undefined,
    taskId: row.task_id ? String(row.task_id) : undefined,
    objective: String(row.objective),
    status: row.status as AutonomousSession["status"],
    stepBudget: Number(row.step_budget ?? DEFAULT_STEP_BUDGET),
    stepsUsed: Number(row.steps_used ?? 0),
    costBudgetUsd: Number(row.cost_budget_usd ?? DEFAULT_COST_BUDGET_USD),
    costUsedUsd: Number(row.cost_used_usd ?? 0),
    plan: Array.isArray(row.plan) ? (row.plan as string[]) : undefined,
    pendingApprovalId: row.pending_approval_id ? String(row.pending_approval_id) : undefined,
    resultSummary: row.result_summary ? String(row.result_summary) : undefined,
    stopRequested: Boolean(row.stop_requested),
    errorMessage: row.error_message ? String(row.error_message) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
    startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
  };
}

function stepFromRow(row: DbRow): AutonomousSessionStep {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    seq: Number(row.seq),
    kind: row.kind as AutonomousStepKind,
    title: String(row.title),
    detail: row.detail ? String(row.detail) : undefined,
    toolName: row.tool_name ? String(row.tool_name) : undefined,
    toolRunId: row.tool_run_id ? String(row.tool_run_id) : undefined,
    status: row.status as AutonomousSessionStep["status"],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
  };
}

export type CreateSessionParams = {
  workspaceId: string;
  employeeId: string;
  objective: string;
  createdByUserId?: string;
  roomId?: string;
  topicId?: string;
  taskId?: string;
  stepBudget?: number;
  costBudgetUsd?: number;
};

export async function createSession(
  client: SupabaseClient,
  params: CreateSessionParams,
): Promise<AutonomousSession> {
  const stepBudget = Math.min(MAX_STEP_BUDGET, Math.max(1, params.stepBudget ?? DEFAULT_STEP_BUDGET));
  const requestedCostBudget = params.costBudgetUsd ?? DEFAULT_COST_BUDGET_USD;
  const costBudgetUsd = Number.isFinite(requestedCostBudget)
    ? Math.min(MAX_COST_BUDGET_USD, Math.max(0.01, requestedCostBudget))
    : DEFAULT_COST_BUDGET_USD;
  const { data, error } = await client
    .from("autonomous_sessions")
    .insert({
      workspace_id: params.workspaceId,
      employee_id: params.employeeId,
      created_by_user_id: params.createdByUserId ?? null,
      room_id: params.roomId ?? null,
      topic_id: params.topicId ?? null,
      task_id: params.taskId ?? null,
      objective: params.objective.trim(),
      status: "queued",
      step_budget: stepBudget,
      cost_budget_usd: costBudgetUsd,
    })
    .select("*")
    .single();
  if (error) throw error;
  return sessionFromRow(data as DbRow);
}

export async function getSession(
  client: SupabaseClient,
  sessionId: string,
): Promise<AutonomousSession | null> {
  const { data, error } = await client
    .from("autonomous_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data ? sessionFromRow(data as DbRow) : null;
}

export async function updateSession(
  client: SupabaseClient,
  sessionId: string,
  patch: Partial<{
    status: AutonomousSession["status"];
    stepsUsed: number;
    costUsedUsd: number;
    plan: string[];
    pendingApprovalId: string | null;
    resultSummary: string | null;
    stopRequested: boolean;
    errorMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
  }>,
): Promise<AutonomousSession | null> {
  const update: DbRow = {};
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.stepsUsed !== undefined) update.steps_used = patch.stepsUsed;
  if (patch.costUsedUsd !== undefined) update.cost_used_usd = patch.costUsedUsd;
  if (patch.plan !== undefined) update.plan = patch.plan;
  if (patch.pendingApprovalId !== undefined) update.pending_approval_id = patch.pendingApprovalId;
  if (patch.resultSummary !== undefined) update.result_summary = patch.resultSummary;
  if (patch.stopRequested !== undefined) update.stop_requested = patch.stopRequested;
  if (patch.errorMessage !== undefined) update.error_message = patch.errorMessage;
  if (patch.startedAt !== undefined) update.started_at = patch.startedAt;
  if (patch.completedAt !== undefined) update.completed_at = patch.completedAt;

  const { data, error } = await client
    .from("autonomous_sessions")
    .update(update)
    .eq("id", sessionId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ? sessionFromRow(data as DbRow) : null;
}

/**
 * Atomically claim a session for processing: flips queued/running → running
 * only if not already claimed by a concurrent iteration. Returns null when the
 * session can't be advanced (already finished, paused, waiting, or racing).
 */
export async function claimForIteration(
  client: SupabaseClient,
  sessionId: string,
): Promise<AutonomousSession | null> {
  const { data, error } = await client
    .from("autonomous_sessions")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", sessionId)
    .in("status", ["queued"])
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ? sessionFromRow(data as DbRow) : null;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export async function appendStep(
  client: SupabaseClient,
  params: {
    workspaceId: string;
    sessionId: string;
    seq: number;
    kind: AutonomousStepKind;
    title: string;
    detail?: string;
    toolName?: string;
    toolRunId?: string;
    status?: AutonomousSessionStep["status"];
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await client.from("autonomous_session_steps").insert({
    workspace_id: params.workspaceId,
    session_id: params.sessionId,
    seq: params.seq,
    kind: params.kind,
    title: params.title,
    detail: params.detail ?? null,
    tool_name: params.toolName ?? null,
    tool_run_id: params.toolRunId ?? null,
    status: params.status ?? "success",
    metadata: params.metadata ?? {},
  });
  // Duplicate seq (concurrent iteration) — ignore.
  if (error && (error as { code?: string }).code !== "23505") throw error;
}

export async function listSteps(
  client: SupabaseClient,
  sessionId: string,
): Promise<AutonomousSessionStep[]> {
  const { data, error } = await client
    .from("autonomous_session_steps")
    .select("*")
    .eq("session_id", sessionId)
    .order("seq", { ascending: true });
  if (error) throw error;
  return ((data as DbRow[] | null) ?? []).map(stepFromRow);
}

export async function nextSeq(client: SupabaseClient, sessionId: string): Promise<number> {
  const { data, error } = await client
    .from("autonomous_session_steps")
    .select("seq")
    .eq("session_id", sessionId)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? Number(data.seq) + 1 : 0;
}
