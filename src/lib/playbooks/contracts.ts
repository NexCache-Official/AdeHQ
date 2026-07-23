/**
 * PR-25 Playbook contracts — role-keyed DAG definitions and run types.
 * Definitions never embed employee IDs; binding happens at run time.
 */

export type PlaybookStatus = "draft" | "published" | "deprecated" | "archived";

export type PlaybookVisibility = "platform" | "workspace" | "private";

export type PlaybookCategory =
  | "research"
  | "product"
  | "engineering"
  | "sales"
  | "marketing"
  | "operations"
  | "customer_success"
  | "general";

export type PlaybookStepKind =
  | "reasoning"
  | "search"
  | "procedure"
  | "artifact_compose"
  | "review";

export type PlaybookShareScope = "private" | "room" | "workspace";

export type PlaybookCollaborationLevel = 0 | 1 | 2 | 3;

export type PlaybookRunStatus =
  | "draft"
  | "awaiting_input"
  | "estimating"
  | "awaiting_approval"
  | "queued"
  | "running"
  | "blocked"
  | "reviewing"
  | "rendering"
  | "completed"
  | "failed"
  | "cancelled";

export type PlaybookStepStatus =
  | "pending"
  | "ready"
  | "leased"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export type PlaybookInputBindingSource =
  | "run_input"
  | "step_output"
  | "room_context"
  | "artifact";

export type PlaybookInputBinding = {
  /** Dotted path on the step input object to write into. */
  target: string;
  source: PlaybookInputBindingSource;
  /** Dotted path within the selected source. */
  path: string;
  /** Required when source is step_output. */
  stepKey?: string;
  /** Optional artifact key / id hint when source is artifact. */
  artifactKey?: string;
};

export type PlaybookRoleRequirement = {
  roleKey: string;
  label?: string;
  capabilityTags?: string[];
  roleTags?: string[];
  minCount?: number;
  maxCount?: number;
};

export type PlaybookArtifactIntent = {
  schemaKey: string;
  schemaVersion: string | number;
  kind: string;
  sectionKeys?: string[];
  outputKey?: string;
};

export type PlaybookStepDefinition = {
  stepKey: string;
  roleKey: string;
  kind: PlaybookStepKind;
  objective: string;
  /** Maps onto brain_capability_steps.capability */
  capability: string;
  dependsOn: string[];
  procedureKey?: string;
  artifactIntent?: PlaybookArtifactIntent;
  estimatedWh: number;
  approvalRequired?: boolean;
  shareScope: PlaybookShareScope;
  inputBindings?: PlaybookInputBinding[];
};

export type PlaybookInputDefinition = {
  key: string;
  type: "string" | "text" | "number" | "boolean" | "file" | "json" | "enum";
  required?: boolean;
  label?: string;
  description?: string;
  enumValues?: string[];
  defaultValue?: unknown;
};

export type PlaybookOutputContract = {
  key: string;
  kind: string;
  schemaKey?: string;
  schemaVersion?: string | number;
  description?: string;
  producedByStepKey?: string;
};

export type PlaybookSuccessCheck =
  | { type: "all_steps_completed" }
  | { type: "artifact_present"; artifactKey: string; stepKey?: string }
  | { type: "output_field"; path: string; equals?: unknown }
  | { type: "quality_pass"; stepKey?: string };

export type PlaybookPolicies = {
  hardWhLimit: number;
  collaborationMaxLevel: PlaybookCollaborationLevel;
  requireApprovalBeforeStart?: boolean;
  allowCustomRoles?: boolean;
};

/** Versioned playbook definition stored in playbook_versions.definition */
export type PlaybookDefinitionV1 = {
  schemaVersion: 1;
  key: string;
  name: string;
  description?: string;
  category: PlaybookCategory;
  industryTags?: string[];
  visibility?: PlaybookVisibility;
  status?: PlaybookStatus;
  roleRequirements: PlaybookRoleRequirement[];
  inputs: PlaybookInputDefinition[];
  steps: PlaybookStepDefinition[];
  outputs: PlaybookOutputContract[];
  successChecks: PlaybookSuccessCheck[];
  policies: PlaybookPolicies;
};

export type PlaybookRoleAssignment = {
  roleKey: string;
  employeeId: string;
  score: number;
  matchedTags: string[];
};

export type PlaybookEstimateCategory =
  | "Research"
  | "Analysis"
  | "Drafting"
  | "Review"
  | "Document export";

export type PlaybookEstimateBreakdownLine = {
  category: PlaybookEstimateCategory;
  estimatedWh: number;
  stepKeys: string[];
};

export type PlaybookEstimate = {
  estimatedWhMin: number;
  estimatedWhMax: number;
  hardWhLimit: number;
  breakdown: PlaybookEstimateBreakdownLine[];
  totalEstimatedWh: number;
};

export type PlaybookRoleCandidate = {
  employeeId: string;
  capabilityTags: string[];
  roleTags: string[];
  workload?: number;
};
