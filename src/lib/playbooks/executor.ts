import type {
  PlaybookDefinitionV1,
  PlaybookRoleAssignment,
  PlaybookRunStatus,
  PlaybookStepDefinition,
  PlaybookStepStatus,
} from "./contracts";
import { estimatePlaybookWh } from "./estimator";
import { buildExecutionPlan, type ExecutionPlanSnapshot } from "./planner";
import { isTerminalPlaybookStepStatus } from "./state-machine";

export type PlaybookRunEnvelopeStep = {
  stepKey: string;
  status: PlaybookStepStatus;
  roleKey: string;
  employeeId: string | null;
  dependsOn: string[];
  estimatedWh: number;
  actualWh: number;
  brainCapabilityStepId: string | null;
  brainRunId: string | null;
  outputPayload?: Record<string, unknown> | null;
  errorCode?: string | null;
};

export type PlaybookRunEnvelope = {
  playbookKey: string;
  definitionSchemaVersion: 1;
  status: PlaybookRunStatus;
  brainRunId: string | null;
  roleAssignments: PlaybookRoleAssignment[];
  inputPayload: Record<string, unknown>;
  plan: ExecutionPlanSnapshot;
  estimatedWhMin: number;
  estimatedWhMax: number;
  hardWhLimit: number;
  actualWh: number;
  steps: PlaybookRunEnvelopeStep[];
};

export type CreatePlaybookRunEnvelopeInput = {
  definition: PlaybookDefinitionV1;
  roleAssignments: PlaybookRoleAssignment[];
  inputPayload: Record<string, unknown>;
  brainRunId?: string | null;
  status?: PlaybookRunStatus;
};

/** Pure in-memory envelope — no DB. Suitable for unit tests. */
export function createPlaybookRunEnvelope(
  input: CreatePlaybookRunEnvelopeInput,
): PlaybookRunEnvelope {
  const estimate = estimatePlaybookWh(input.definition);
  const plan = buildExecutionPlan(
    input.definition,
    input.roleAssignments,
    input.inputPayload,
  );
  const employeeByRole = new Map(
    input.roleAssignments.map((a) => [a.roleKey, a.employeeId] as const),
  );

  const steps: PlaybookRunEnvelopeStep[] = input.definition.steps.map((step) => {
    const ready = (step.dependsOn ?? []).length === 0;
    return {
      stepKey: step.stepKey,
      status: ready ? "ready" : "pending",
      roleKey: step.roleKey,
      employeeId: employeeByRole.get(step.roleKey) ?? null,
      dependsOn: [...(step.dependsOn ?? [])],
      estimatedWh: step.estimatedWh,
      actualWh: 0,
      brainCapabilityStepId: null,
      brainRunId: input.brainRunId ?? null,
    };
  });

  return {
    playbookKey: input.definition.key,
    definitionSchemaVersion: 1,
    status: input.status ?? "queued",
    brainRunId: input.brainRunId ?? null,
    roleAssignments: input.roleAssignments,
    inputPayload: { ...input.inputPayload },
    plan,
    estimatedWhMin: estimate.estimatedWhMin,
    estimatedWhMax: estimate.estimatedWhMax,
    hardWhLimit: estimate.hardWhLimit,
    actualWh: 0,
    steps,
  };
}

function depsSatisfied(
  step: PlaybookRunEnvelopeStep,
  byKey: Map<string, PlaybookRunEnvelopeStep>,
): boolean {
  return step.dependsOn.every((dep) => {
    const d = byKey.get(dep);
    return d?.status === "completed" || d?.status === "skipped";
  });
}

/**
 * Mark pending steps whose dependencies are satisfied as ready.
 * Returns a new steps array (does not mutate).
 */
export function advanceReadySteps(
  steps: PlaybookRunEnvelopeStep[],
  _definition?: PlaybookDefinitionV1,
): PlaybookRunEnvelopeStep[] {
  const byKey = new Map(steps.map((s) => [s.stepKey, s]));
  return steps.map((step) => {
    if (step.status !== "pending") return step;
    if (!depsSatisfied(step, byKey)) return step;
    return { ...step, status: "ready" };
  });
}

/**
 * Enforce hard WH cap before scheduling more work.
 * Returns allowed next max WH (0 if capped).
 */
export function enforceHardWhCap(
  actual: number,
  nextMax: number,
  hardLimit: number,
): { allowed: boolean; remaining: number; nextMax: number } {
  const remaining = Math.max(0, hardLimit - actual);
  if (remaining <= 0) {
    return { allowed: false, remaining: 0, nextMax: 0 };
  }
  return {
    allowed: true,
    remaining,
    nextMax: Math.min(nextMax, remaining),
  };
}

export function linkBrainRunId(
  envelope: PlaybookRunEnvelope,
  brainRunId: string,
): PlaybookRunEnvelope {
  return {
    ...envelope,
    brainRunId,
    steps: envelope.steps.map((s) => ({ ...s, brainRunId })),
  };
}

export function linkBrainCapabilityStepId(
  steps: PlaybookRunEnvelopeStep[],
  stepKey: string,
  brainCapabilityStepId: string,
): PlaybookRunEnvelopeStep[] {
  return steps.map((s) =>
    s.stepKey === stepKey ? { ...s, brainCapabilityStepId } : s,
  );
}

export function getDefinitionStep(
  definition: PlaybookDefinitionV1,
  stepKey: string,
): PlaybookStepDefinition | undefined {
  return definition.steps.find((s) => s.stepKey === stepKey);
}

export function allStepsTerminal(steps: PlaybookRunEnvelopeStep[]): boolean {
  return steps.every((s) => isTerminalPlaybookStepStatus(s.status));
}
