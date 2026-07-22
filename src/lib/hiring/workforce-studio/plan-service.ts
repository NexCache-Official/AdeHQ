// Orchestrates team_hire_plans: create once per approved blueprint revision
// (idempotency-key deduped), advance in small batches with exclusive
// per-step ownership, and compensate (rollback) on terminal step failure.

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { getBlueprint } from "./blueprint-service";
import { logEvent } from "./blueprint-service";
import { buildPlanSteps, executeStep, compensateStep, MAX_STEPS_PER_BATCH, BATCH_DEADLINE_MS } from "./plan-executor";
import type { TeamHirePlanRecord, TeamHirePlanStep, TeamHirePlanStepStatus } from "./types";

const MAX_ATTEMPTS_PER_STEP = 3;

type PlanRow = {
  id: string;
  workspace_id: string;
  blueprint_id: string;
  blueprint_revision: number;
  approval_hash: string;
  idempotency_key: string;
  status: string;
  total_steps: number;
  completed_steps: number;
  error: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type StepRow = {
  id: string;
  plan_id: string;
  step_index: number;
  step_type: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  provenance: Record<string, unknown>;
  depends_on_step_indexes: number[];
  attempts: number;
  last_error: string | null;
};

function rowToPlan(row: PlanRow): TeamHirePlanRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    blueprintId: row.blueprint_id,
    blueprintRevision: row.blueprint_revision,
    approvalHash: row.approval_hash,
    idempotencyKey: row.idempotency_key,
    status: row.status as TeamHirePlanRecord["status"],
    totalSteps: row.total_steps,
    completedSteps: row.completed_steps,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function rowToStep(row: StepRow): TeamHirePlanStep {
  return {
    id: row.id,
    planId: row.plan_id,
    stepIndex: row.step_index,
    stepType: row.step_type as TeamHirePlanStep["stepType"],
    status: row.status as TeamHirePlanStepStatus,
    payload: row.payload,
    result: row.result,
    provenance: row.provenance,
    dependsOnStepIndexes: row.depends_on_step_indexes,
    attempts: row.attempts,
    lastError: row.last_error,
  };
}

const PLAN_COLUMNS =
  "id, workspace_id, blueprint_id, blueprint_revision, approval_hash, idempotency_key, status, total_steps, completed_steps, error, created_at, updated_at, completed_at";
const STEP_COLUMNS =
  "id, plan_id, step_index, step_type, status, payload, result, provenance, depends_on_step_indexes, attempts, last_error";

export async function getPlanWithSteps(
  client: SupabaseClient,
  workspaceId: string,
  planId: string,
): Promise<{ plan: TeamHirePlanRecord; steps: TeamHirePlanStep[] }> {
  const { data: planData, error: planError } = await client
    .from("team_hire_plans")
    .select(PLAN_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", planId)
    .maybeSingle();
  if (planError) throw planError;
  if (!planData) throw new Error("Team hire plan not found.");

  const { data: stepData, error: stepError } = await client
    .from("team_hire_plan_steps")
    .select(STEP_COLUMNS)
    .eq("plan_id", planId)
    .order("step_index", { ascending: true });
  if (stepError) throw stepError;

  return {
    plan: rowToPlan(planData as PlanRow),
    steps: (stepData ?? []).map((row) => rowToStep(row as StepRow)),
  };
}

/** Plan statuses that represent a fully-finished, unrecoverable attempt —
 * compensation already rolled back every succeeded step, so nothing from
 * that attempt is left behind to collide with a fresh one. */
const TERMINAL_FAILURE_STATUSES = new Set(["failed", "compensated", "cancelled"]);

/** Create (or return the existing) provisioning plan for this blueprint's
 * approved revision. Idempotent for a live attempt — calling twice while a
 * plan is pending/running/completed never double-provisions. If the most
 * recent attempt for this revision ended in terminal failure (compensated
 * everything it created), this starts a fresh numbered attempt instead of
 * handing back the dead plan forever, so an admin can retry after fixing
 * whatever caused the failure without ever duplicating objects — the failed
 * attempt's rows were already removed by compensation. */
export async function createHirePlan(
  client: SupabaseClient,
  params: { workspaceId: string; blueprintId: string; userId: string },
): Promise<{ plan: TeamHirePlanRecord; steps: TeamHirePlanStep[] }> {
  const blueprint = await getBlueprint(client, params.workspaceId, params.blueprintId);
  if (blueprint.status !== "approved" && blueprint.status !== "provisioning" && blueprint.status !== "active") {
    throw new Error(`Blueprint must be approved before provisioning (status=${blueprint.status}).`);
  }
  if (!blueprint.approvedPayload || !blueprint.approvalHash || blueprint.approvedRevision == null) {
    throw new Error("Blueprint has no frozen approved snapshot to provision from.");
  }

  const baseIdempotencyKey = `blueprint:${blueprint.id}:rev:${blueprint.approvedRevision}`;

  const { data: priorAttempts } = await client
    .from("team_hire_plans")
    .select(PLAN_COLUMNS)
    .eq("workspace_id", params.workspaceId)
    .eq("blueprint_id", blueprint.id)
    .eq("blueprint_revision", blueprint.approvedRevision)
    .order("created_at", { ascending: false });

  const latest = (priorAttempts as PlanRow[] | null)?.[0];
  if (latest && !TERMINAL_FAILURE_STATUSES.has(latest.status)) {
    return getPlanWithSteps(client, params.workspaceId, latest.id);
  }

  const attemptNumber = (priorAttempts?.length ?? 0) + 1;
  const idempotencyKey = attemptNumber === 1 ? baseIdempotencyKey : `${baseIdempotencyKey}:retry:${attemptNumber}`;

  const stepInputs = buildPlanSteps(blueprint.approvedPayload);

  const { data: planData, error: planError } = await client
    .from("team_hire_plans")
    .insert({
      workspace_id: params.workspaceId,
      blueprint_id: blueprint.id,
      blueprint_revision: blueprint.approvedRevision,
      approval_hash: blueprint.approvalHash,
      idempotency_key: idempotencyKey,
      status: "pending",
      total_steps: stepInputs.length,
      completed_steps: 0,
      created_by: params.userId,
    })
    .select(PLAN_COLUMNS)
    .single();
  if (planError || !planData) {
    // Race: another request created it first under the same idempotency key.
    const { data: race } = await client
      .from("team_hire_plans")
      .select(PLAN_COLUMNS)
      .eq("workspace_id", params.workspaceId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (race) return getPlanWithSteps(client, params.workspaceId, (race as PlanRow).id);
    throw planError ?? new Error("Failed to create team hire plan.");
  }

  const plan = rowToPlan(planData as PlanRow);
  const stepRows = stepInputs.map((step, index) => ({
    plan_id: plan.id,
    step_index: index,
    step_type: step.stepType,
    status: "pending" as const,
    payload: step.payload,
    depends_on_step_indexes: step.dependsOn,
  }));
  if (stepRows.length) {
    const { error: stepsError } = await client.from("team_hire_plan_steps").insert(stepRows);
    if (stepsError) throw stepsError;
  }

  await client
    .from("workforce_blueprints")
    .update({ status: "provisioning" })
    .eq("workspace_id", params.workspaceId)
    .eq("id", blueprint.id)
    .eq("status", "approved");

  await logEvent(client, {
    workspaceId: params.workspaceId,
    blueprintId: blueprint.id,
    planId: plan.id,
    eventType: attemptNumber === 1 ? "plan_created" : "plan_retried",
    payload: { totalSteps: stepRows.length, attemptNumber, previousPlanId: latest?.id ?? null },
    createdBy: params.userId,
  });

  return getPlanWithSteps(client, params.workspaceId, plan.id);
}

function stepsReady(step: StepRow, succeededOrSkipped: Set<number>): boolean {
  return step.depends_on_step_indexes.every((idx) => succeededOrSkipped.has(idx));
}

/** Process up to MAX_STEPS_PER_BATCH steps (or until the wall-clock budget
 * runs out), then return the current plan/step state. Safe to call
 * repeatedly — the client should poll this until status is terminal. */
export async function advanceHirePlan(
  client: SupabaseClient,
  params: { workspaceId: string; planId: string },
): Promise<{ plan: TeamHirePlanRecord; steps: TeamHirePlanStep[] }> {
  const { plan: initialPlan } = await getPlanWithSteps(client, params.workspaceId, params.planId);
  if (["completed", "failed", "cancelled", "compensated"].includes(initialPlan.status)) {
    return getPlanWithSteps(client, params.workspaceId, params.planId);
  }

  const blueprint = await getBlueprint(client, params.workspaceId, initialPlan.blueprintId);

  if (initialPlan.status === "pending") {
    await client
      .from("team_hire_plans")
      .update({ status: "running" })
      .eq("workspace_id", params.workspaceId)
      .eq("id", params.planId)
      .eq("status", "pending");
  }

  const { data: stepRows, error: stepsError } = await client
    .from("team_hire_plan_steps")
    .select(STEP_COLUMNS)
    .eq("plan_id", params.planId)
    .order("step_index", { ascending: true });
  if (stepsError) throw stepsError;
  const steps = (stepRows ?? []).map((r) => r as StepRow);

  const succeededOrSkipped = new Set(
    steps.filter((s) => s.status === "succeeded" || s.status === "skipped").map((s) => s.step_index),
  );

  const deadline = Date.now() + BATCH_DEADLINE_MS;
  let processed = 0;
  let terminalFailure: StepRow | null = null;

  for (const step of steps) {
    if (processed >= MAX_STEPS_PER_BATCH || Date.now() > deadline) break;
    if (step.status !== "pending") continue;
    if (!stepsReady(step, succeededOrSkipped)) continue;

    const ownerToken = randomUUID();
    const { data: claimed } = await client
      .from("team_hire_plan_steps")
      .update({ status: "running", owner_token: ownerToken, owner_acquired_at: new Date().toISOString() })
      .eq("id", step.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue; // lost the race to another concurrent advance call

    processed += 1;

    try {
      const result = await executeStep(client, {
        workspaceId: params.workspaceId,
        blueprint,
        planId: params.planId,
        step: { stepType: step.step_type as StepRow["step_type"] as never, payload: step.payload },
      });
      await client
        .from("team_hire_plan_steps")
        .update({
          status: "succeeded",
          result,
          attempts: step.attempts + 1,
          provenance: { blueprintId: blueprint.id, blueprintRevision: blueprint.approvedRevision, planId: params.planId },
        })
        .eq("id", step.id);
      succeededOrSkipped.add(step.step_index);
      await client
        .from("team_hire_plans")
        .update({ completed_steps: steps.filter((s) => succeededOrSkipped.has(s.step_index)).length })
        .eq("id", params.planId);
    } catch (error) {
      const attempts = step.attempts + 1;
      const message = error instanceof Error ? error.message : String(error);
      if (attempts < MAX_ATTEMPTS_PER_STEP) {
        await client
          .from("team_hire_plan_steps")
          .update({ status: "pending", attempts, last_error: message, owner_token: null })
          .eq("id", step.id);
      } else {
        await client
          .from("team_hire_plan_steps")
          .update({ status: "failed", attempts, last_error: message })
          .eq("id", step.id);
        terminalFailure = { ...step, attempts, last_error: message };
        break;
      }
    }
  }

  if (terminalFailure) {
    await compensatePlan(client, params.workspaceId, params.planId, terminalFailure.last_error ?? "Step failed");
    return getPlanWithSteps(client, params.workspaceId, params.planId);
  }

  const { data: finalStepRows } = await client
    .from("team_hire_plan_steps")
    .select("status")
    .eq("plan_id", params.planId);
  const allDone = (finalStepRows ?? []).every((s) => s.status === "succeeded" || s.status === "skipped");

  if (allDone) {
    await client
      .from("team_hire_plans")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", params.planId)
      .eq("workspace_id", params.workspaceId);
    await client
      .from("workforce_blueprints")
      .update({ status: "active" })
      .eq("workspace_id", params.workspaceId)
      .eq("id", initialPlan.blueprintId)
      .eq("status", "provisioning");
    await logEvent(client, {
      workspaceId: params.workspaceId,
      blueprintId: initialPlan.blueprintId,
      planId: params.planId,
      eventType: "plan_completed",
      payload: {},
    });
  }

  return getPlanWithSteps(client, params.workspaceId, params.planId);
}

async function compensatePlan(
  client: SupabaseClient,
  workspaceId: string,
  planId: string,
  errorMessage: string,
): Promise<void> {
  await client
    .from("team_hire_plans")
    .update({ status: "compensating", error: { message: errorMessage } })
    .eq("id", planId)
    .eq("workspace_id", workspaceId);

  const { data: stepRows } = await client
    .from("team_hire_plan_steps")
    .select(STEP_COLUMNS)
    .eq("plan_id", planId)
    .order("step_index", { ascending: false });

  for (const row of stepRows ?? []) {
    const step = row as StepRow;
    if (step.status !== "succeeded") continue;
    try {
      await compensateStep(client, workspaceId, {
        stepType: step.step_type as StepRow["step_type"] as never,
        payload: step.payload,
      });
      await client.from("team_hire_plan_steps").update({ status: "compensated" }).eq("id", step.id);
    } catch (error) {
      console.error("[workforce-studio] compensation failed for step", step.id, error);
    }
  }

  await client
    .from("team_hire_plans")
    .update({ status: "compensated" })
    .eq("id", planId)
    .eq("workspace_id", workspaceId);

  await logEvent(client, {
    workspaceId,
    planId,
    eventType: "plan_compensated",
    payload: { errorMessage },
  });
}
