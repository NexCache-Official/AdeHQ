import type {
  PlaybookDefinitionV1,
  PlaybookInputDefinition,
  PlaybookOutputContract,
  PlaybookRoleRequirement,
  PlaybookStepDefinition,
  PlaybookSuccessCheck,
  PlaybookCategory,
} from "../contracts";

export function def(opts: {
  key: string;
  name: string;
  description: string;
  category: PlaybookCategory;
  industryTags?: string[];
  roleRequirements: PlaybookRoleRequirement[];
  inputs: PlaybookInputDefinition[];
  steps: PlaybookStepDefinition[];
  outputs: PlaybookOutputContract[];
  successChecks?: PlaybookSuccessCheck[];
  hardWhLimit: number;
  collaborationMaxLevel?: 0 | 1 | 2 | 3;
}): PlaybookDefinitionV1 {
  return {
    schemaVersion: 1,
    key: opts.key,
    name: opts.name,
    description: opts.description,
    category: opts.category,
    industryTags: opts.industryTags ?? [],
    visibility: "platform",
    status: "published",
    roleRequirements: opts.roleRequirements,
    inputs: opts.inputs,
    steps: opts.steps,
    outputs: opts.outputs,
    successChecks: opts.successChecks ?? [{ type: "all_steps_completed" }],
    policies: {
      hardWhLimit: opts.hardWhLimit,
      collaborationMaxLevel: opts.collaborationMaxLevel ?? 2,
      requireApprovalBeforeStart: false,
    },
  };
}

export function step(
  partial: Omit<PlaybookStepDefinition, "shareScope" | "dependsOn"> &
    Partial<Pick<PlaybookStepDefinition, "shareScope" | "dependsOn">>,
): PlaybookStepDefinition {
  return {
    ...partial,
    shareScope: partial.shareScope ?? "room",
    dependsOn: partial.dependsOn ?? [],
  };
}
