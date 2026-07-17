import type {
  CollaborationPlan,
  CollaborationPlanValidation,
  MultiAgentPolicy,
} from "./types";

export type ValidateCollaborationPlanContext = {
  accessibleEmployeeIds: Set<string> | string[];
  permittedCapabilities?: Set<string> | string[];
  /** Room/topic employees allowed to participate. */
  roomEmployeeIds?: Set<string> | string[];
  isPrivateDm?: boolean;
  policy: MultiAgentPolicy;
};

function asSet(value: Set<string> | string[] | undefined): Set<string> {
  if (!value) return new Set();
  return value instanceof Set ? value : new Set(value);
}

function hasCycle(steps: CollaborationPlan["steps"]): boolean {
  const byId = new Map(steps.map((s) => [s.stepId, s]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(id: string): boolean {
    if (visited.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    const step = byId.get(id);
    for (const dep of step?.dependsOn ?? []) {
      if (dfs(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  return steps.some((s) => dfs(s.stepId));
}

/**
 * Deterministic validation before any execution (shadow or live).
 */
export function validateCollaborationPlan(
  plan: CollaborationPlan,
  ctx: ValidateCollaborationPlanContext,
): CollaborationPlanValidation {
  const errors: string[] = [];
  const accessible = asSet(ctx.accessibleEmployeeIds);
  const room = asSet(ctx.roomEmployeeIds);
  const permitted = asSet(ctx.permittedCapabilities);

  if (!plan.leadEmployeeId) errors.push("leadEmployeeId_required");
  else if (!accessible.has(plan.leadEmployeeId)) {
    errors.push(`lead_not_accessible:${plan.leadEmployeeId}`);
  } else if (room.size && !room.has(plan.leadEmployeeId)) {
    errors.push(`lead_not_in_room:${plan.leadEmployeeId}`);
  }

  if (plan.steps.length === 0) errors.push("steps_empty");
  if (plan.steps.length > ctx.policy.maxSteps) {
    errors.push(`steps_exceed_max:${plan.steps.length}>${ctx.policy.maxSteps}`);
  }
  if (plan.maxSteps > ctx.policy.maxSteps) {
    errors.push(`maxSteps_exceeds_policy:${plan.maxSteps}`);
  }
  if (plan.maxCollaborators > ctx.policy.maxEmployees) {
    errors.push(`maxCollaborators_exceeds_policy:${plan.maxCollaborators}`);
  }

  const employeeIds = new Set(plan.steps.map((s) => s.employeeId));
  employeeIds.add(plan.leadEmployeeId);
  if (employeeIds.size > ctx.policy.maxEmployees) {
    errors.push(`employees_exceed_max:${employeeIds.size}>${ctx.policy.maxEmployees}`);
  }

  const stepIds = new Set<string>();
  for (const step of plan.steps) {
    if (stepIds.has(step.stepId)) errors.push(`duplicate_step:${step.stepId}`);
    stepIds.add(step.stepId);

    if (!accessible.has(step.employeeId)) {
      errors.push(`employee_not_accessible:${step.employeeId}`);
    } else if (room.size && !room.has(step.employeeId)) {
      errors.push(`employee_not_in_room:${step.employeeId}`);
    }

    if (permitted.size && !permitted.has(step.capability) && step.capability !== "review") {
      errors.push(`capability_unavailable:${step.capability}`);
    }

    if (ctx.isPrivateDm && step.shareScope !== "private") {
      errors.push(`private_dm_share_scope:${step.stepId}`);
    }
    if (ctx.isPrivateDm && step.employeeId !== plan.leadEmployeeId) {
      errors.push(`private_dm_no_delegation:${step.stepId}`);
    }
  }

  for (const step of plan.steps) {
    for (const dep of step.dependsOn) {
      if (!plan.steps.some((s) => s.stepId === dep)) {
        errors.push(`missing_dependency:${step.stepId}->${dep}`);
      }
    }
  }

  if (hasCycle(plan.steps)) errors.push("dependency_cycle");

  if (plan.estimatedWhMin < 0 || plan.estimatedWhMax < plan.estimatedWhMin) {
    errors.push("invalid_budget_range");
  }
  if (plan.hardWhLimit < plan.estimatedWhMin) {
    errors.push("hardWhLimit_below_estimate");
  }

  // V1: no recursive delegation — synthesis/review only by lead at end
  const leadSynthesis = plan.steps.filter(
    (s) => s.capability === "synthesis" && s.employeeId !== plan.leadEmployeeId,
  );
  if (leadSynthesis.length) {
    errors.push("synthesis_must_be_lead");
  }

  return { ok: errors.length === 0, errors };
}
