import type {
  PlaybookDefinitionV1,
  PlaybookRoleAssignment,
} from "./contracts";

export type ExecutionPlanStep = {
  stepKey: string;
  roleKey: string;
  employeeId: string | null;
  kind: string;
  capability: string;
  dependsOn: string[];
  estimatedWh: number;
  procedureKey?: string;
  wave: number;
};

export type ExecutionPlanSnapshot = {
  playbookKey: string;
  schemaVersion: 1;
  waves: Array<{
    wave: number;
    stepKeys: string[];
  }>;
  steps: ExecutionPlanStep[];
  roleAssignments: PlaybookRoleAssignment[];
  inputPayload: Record<string, unknown>;
  createdAt: string;
};

/**
 * Build an ordered execution plan with parallel waves (ready groups).
 * Wave 0 = no deps; later waves unlock as dependencies complete.
 */
export function buildExecutionPlan(
  definition: PlaybookDefinitionV1,
  roleAssignments: PlaybookRoleAssignment[],
  inputPayload: Record<string, unknown>,
): ExecutionPlanSnapshot {
  const employeeByRole = new Map<string, string>();
  for (const a of roleAssignments) {
    if (!employeeByRole.has(a.roleKey)) {
      employeeByRole.set(a.roleKey, a.employeeId);
    }
  }

  const stepByKey = new Map(definition.steps.map((s) => [s.stepKey, s]));
  const waveByKey = new Map<string, number>();

  function waveOf(stepKey: string, stack: Set<string> = new Set()): number {
    if (waveByKey.has(stepKey)) return waveByKey.get(stepKey)!;
    if (stack.has(stepKey)) throw new Error(`Cycle while planning at ${stepKey}`);
    const step = stepByKey.get(stepKey);
    if (!step) throw new Error(`Unknown step in plan: ${stepKey}`);
    stack.add(stepKey);
    const deps = step.dependsOn ?? [];
    const wave = deps.length === 0 ? 0 : Math.max(...deps.map((d) => waveOf(d, stack))) + 1;
    stack.delete(stepKey);
    waveByKey.set(stepKey, wave);
    return wave;
  }

  for (const step of definition.steps) {
    waveOf(step.stepKey);
  }

  const steps: ExecutionPlanStep[] = definition.steps.map((step) => ({
    stepKey: step.stepKey,
    roleKey: step.roleKey,
    employeeId: employeeByRole.get(step.roleKey) ?? null,
    kind: step.kind,
    capability: step.capability,
    dependsOn: [...(step.dependsOn ?? [])],
    estimatedWh: step.estimatedWh,
    procedureKey: step.procedureKey,
    wave: waveByKey.get(step.stepKey) ?? 0,
  }));

  const maxWave = steps.reduce((m, s) => Math.max(m, s.wave), 0);
  const waves = Array.from({ length: maxWave + 1 }, (_, wave) => ({
    wave,
    stepKeys: steps.filter((s) => s.wave === wave).map((s) => s.stepKey),
  }));

  return {
    playbookKey: definition.key,
    schemaVersion: 1,
    waves,
    steps,
    roleAssignments,
    inputPayload: { ...inputPayload },
    createdAt: new Date().toISOString(),
  };
}
