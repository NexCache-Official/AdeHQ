export type OutputContract =
  | { type: "text" }
  | { type: "json"; schemaId: string }
  | { type: "artifact"; artifactType: string };

/** Minimal schema registry — expands in later phases. */
export const BRAIN_SCHEMA_REGISTRY: Record<string, { description: string }> = {
  employee_response_v1: { description: "Employee chat response object" },
  classifier_plan_v1: { description: "Orchestration classifier plan" },
  steward_decision_v1: { description: "Steward Core decision" },
};

export function textContract(): OutputContract {
  return { type: "text" };
}

export function jsonContract(schemaId: string): OutputContract {
  return { type: "json", schemaId };
}
