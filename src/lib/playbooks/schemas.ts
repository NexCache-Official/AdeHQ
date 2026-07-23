import type {
  PlaybookDefinitionV1,
  PlaybookInputBinding,
  PlaybookStepDefinition,
} from "./contracts";

export type ValidationResult = {
  ok: boolean;
  errors: string[];
};

const STEP_KINDS = new Set([
  "reasoning",
  "search",
  "procedure",
  "artifact_compose",
  "review",
]);

const BINDING_SOURCES = new Set([
  "run_input",
  "step_output",
  "room_context",
  "artifact",
]);

export function validatePlaybookDag(steps: PlaybookStepDefinition[]): ValidationResult {
  const errors: string[] = [];
  const keys = new Set<string>();

  for (const step of steps) {
    if (!step.stepKey?.trim()) {
      errors.push("step missing stepKey");
      continue;
    }
    if (keys.has(step.stepKey)) {
      errors.push(`duplicate stepKey: ${step.stepKey}`);
    }
    keys.add(step.stepKey);
  }

  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!keys.has(dep)) {
        errors.push(`step ${step.stepKey} depends on missing step: ${dep}`);
      }
      if (dep === step.stepKey) {
        errors.push(`step ${step.stepKey} cannot depend on itself`);
      }
    }
  }

  // Cycle detection (Kahn)
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const key of keys) {
    indegree.set(key, 0);
    adjacency.set(key, []);
  }
  for (const step of steps) {
    if (!keys.has(step.stepKey)) continue;
    for (const dep of step.dependsOn ?? []) {
      if (!keys.has(dep)) continue;
      adjacency.get(dep)!.push(step.stepKey);
      indegree.set(step.stepKey, (indegree.get(step.stepKey) ?? 0) + 1);
    }
  }

  const queue = [...indegree.entries()]
    .filter(([, d]) => d === 0)
    .map(([k]) => k);
  let seen = 0;
  while (queue.length) {
    const node = queue.shift()!;
    seen += 1;
    for (const next of adjacency.get(node) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (keys.size > 0 && seen !== keys.size) {
    errors.push("playbook DAG contains a cycle");
  }

  return { ok: errors.length === 0, errors };
}

export function validateInputBindings(
  bindings: PlaybookInputBinding[] | undefined,
  stepKeys?: Set<string>,
): ValidationResult {
  const errors: string[] = [];
  if (!bindings) return { ok: true, errors };

  for (const [i, binding] of bindings.entries()) {
    if (!binding.target?.trim()) {
      errors.push(`binding[${i}] missing target`);
    }
    if (!binding.path?.trim()) {
      errors.push(`binding[${i}] missing path`);
    }
    if (!BINDING_SOURCES.has(binding.source)) {
      errors.push(`binding[${i}] invalid source: ${String(binding.source)}`);
    }
    if (binding.source === "step_output") {
      if (!binding.stepKey?.trim()) {
        errors.push(`binding[${i}] step_output requires stepKey`);
      } else if (stepKeys && !stepKeys.has(binding.stepKey)) {
        errors.push(`binding[${i}] step_output references unknown step: ${binding.stepKey}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validatePlaybookDefinition(def: unknown): ValidationResult {
  const errors: string[] = [];
  if (!def || typeof def !== "object") {
    return { ok: false, errors: ["definition must be an object"] };
  }

  const d = def as Partial<PlaybookDefinitionV1>;
  if (d.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!d.key?.trim()) errors.push("key is required");
  if (!d.name?.trim()) errors.push("name is required");
  if (!d.category) errors.push("category is required");
  if (!d.policies || typeof d.policies !== "object") {
    errors.push("policies are required");
  } else {
    if (!(typeof d.policies.hardWhLimit === "number") || d.policies.hardWhLimit <= 0) {
      errors.push("policies.hardWhLimit must be a positive number");
    }
    const level = d.policies.collaborationMaxLevel;
    if (level !== 0 && level !== 1 && level !== 2 && level !== 3) {
      errors.push("policies.collaborationMaxLevel must be 0|1|2|3");
    }
  }

  if (!Array.isArray(d.roleRequirements) || d.roleRequirements.length === 0) {
    errors.push("roleRequirements must be a non-empty array");
  } else {
    for (const role of d.roleRequirements) {
      if (!role.roleKey?.trim()) errors.push("roleRequirement missing roleKey");
    }
  }

  if (!Array.isArray(d.inputs)) errors.push("inputs must be an array");
  if (!Array.isArray(d.outputs)) errors.push("outputs must be an array");
  if (!Array.isArray(d.successChecks)) errors.push("successChecks must be an array");

  if (!Array.isArray(d.steps) || d.steps.length === 0) {
    errors.push("steps must be a non-empty array");
  } else {
    const roleKeys = new Set((d.roleRequirements ?? []).map((r) => r.roleKey));
    for (const step of d.steps) {
      if (!step.stepKey?.trim()) errors.push("step missing stepKey");
      if (!step.roleKey?.trim()) errors.push(`step ${step.stepKey ?? "?"} missing roleKey`);
      else if (!roleKeys.has(step.roleKey)) {
        errors.push(`step ${step.stepKey} references unknown roleKey: ${step.roleKey}`);
      }
      if (!STEP_KINDS.has(step.kind)) {
        errors.push(`step ${step.stepKey} has invalid kind: ${String(step.kind)}`);
      }
      if (!step.objective?.trim()) errors.push(`step ${step.stepKey} missing objective`);
      if (!step.capability?.trim()) errors.push(`step ${step.stepKey} missing capability`);
      if (!(typeof step.estimatedWh === "number") || step.estimatedWh < 0) {
        errors.push(`step ${step.stepKey} estimatedWh must be >= 0`);
      }
      if (step.kind === "procedure" && !step.procedureKey?.trim()) {
        errors.push(`step ${step.stepKey} procedure kind requires procedureKey`);
      }
      // Never allow employee IDs in definitions
      const raw = step as Record<string, unknown>;
      if ("employeeId" in raw || "employee_id" in raw) {
        errors.push(`step ${step.stepKey} must not embed employeeId`);
      }

      const bindingResult = validateInputBindings(
        step.inputBindings,
        new Set(d.steps.map((s) => s.stepKey)),
      );
      errors.push(...bindingResult.errors);
    }

    const dag = validatePlaybookDag(d.steps as PlaybookStepDefinition[]);
    errors.push(...dag.errors);
  }

  return { ok: errors.length === 0, errors };
}
