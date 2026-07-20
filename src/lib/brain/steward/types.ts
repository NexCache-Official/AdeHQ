/**
 * PR-19 Multi-agent Steward — typed collaboration plan (shadow + future execute).
 */

import type { SavedArtifactType } from "@/lib/types";

export type CollaborationMode =
  | "single_employee"
  | "delegated"
  | "parallel_research"
  | "produce_and_review";

export type CollaborationShareScope = "private" | "room" | "workspace";

export type CollaborationStepCapability =
  | "reasoning"
  | "search"
  | "vision"
  | "coding"
  | "image"
  | "video"
  | "speech_to_text"
  | "text_to_speech"
  | "tool"
  | "synthesis"
  | "review";

export type CollaborationPlanStep = {
  stepId: string;
  objective: string;
  capability: CollaborationStepCapability;
  employeeId: string;
  dependsOn: string[];
  expectedOutput: string;
  shareScope: CollaborationShareScope;
  estimatedWh: number;
};

export type CollaborationPlan = {
  objective: string;
  leadEmployeeId: string;
  mode: CollaborationMode;
  steps: CollaborationPlanStep[];
  artifactIntent?: {
    type: SavedArtifactType;
    instruction?: string;
  };
  maxCollaborators: number;
  maxSteps: number;
  estimatedWhMin: number;
  estimatedWhMax: number;
  hardWhLimit: number;
  approvalRequired: boolean;
};

export type MultiAgentPolicy = {
  maxEmployees: number;
  maxSteps: number;
  autoWhLimit: number;
  reviewEnabled: boolean;
};

export type CollaborationTriggerReason =
  | "explicit_multi_mention"
  | "cross_domain"
  | "research_plus_artifact"
  | "verification_requested"
  | "coding_plus_review"
  | "consequential_review"
  | "multi_system"
  | "legacy_collaboration_mode";

export type CollaborationSkipReason =
  | "greeting"
  | "simple_factual"
  | "ordinary_search"
  | "short_writing"
  | "basic_calculation"
  | "single_employee_sufficient"
  | "private_dm"
  | "no_accessible_employees"
  | "silent";

export type CollaborationTriggerDecision = {
  collaborate: boolean;
  reasons: CollaborationTriggerReason[];
  skipReasons: CollaborationSkipReason[];
};

export type CollaborationPlanValidation = {
  ok: boolean;
  errors: string[];
};

/** Diff vs existing ConversationPlan / OrchestrationPlan for shadow quality. */
export type StewardShadowComparison = {
  leadMatches: boolean;
  modeFamilyMatches: boolean;
  collaboratorOverlap: number;
  notes: string[];
};

export type StewardShadowPlanResult = {
  plan: CollaborationPlan | null;
  trigger: CollaborationTriggerDecision;
  validation: CollaborationPlanValidation;
  comparison: StewardShadowComparison | null;
  shadow: true;
  executed: false;
};
