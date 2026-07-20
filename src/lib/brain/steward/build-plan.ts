import { getMultiAgentPolicy } from "./policy";
import { selectCollaborators, selectLeadEmployee, type LeadCandidate } from "./lead-selection";
import { shouldCollaborate } from "./should-collaborate";
import type {
  CollaborationMode,
  CollaborationPlan,
  CollaborationPlanStep,
  CollaborationTriggerDecision,
  MultiAgentPolicy,
} from "./types";
import type { SavedArtifactType } from "@/lib/types";

export type BuildCollaborationPlanInput = {
  message: string;
  objective?: string;
  candidates: LeadCandidate[];
  accessibleEmployeeIds: string[];
  preferredEmployeeIds?: string[];
  orchestrationSelectedIds?: string[];
  roomEmployeeIds?: string[];
  dmEmployeeId?: string | null;
  isPrivateDm?: boolean;
  legacyMode?: string | null;
  policy?: MultiAgentPolicy;
  /** Available capabilities for this workspace/run. */
  permittedCapabilities?: string[];
  /** Explicit artifact request detected at the human-message boundary. */
  artifactIntent?: {
    type: SavedArtifactType;
    instruction?: string;
  };
};

function pickMode(
  trigger: CollaborationTriggerDecision,
  collaboratorCount: number,
  reviewEnabled: boolean,
): CollaborationMode {
  if (!trigger.collaborate || collaboratorCount === 0) return "single_employee";
  if (trigger.reasons.includes("verification_requested") && reviewEnabled) {
    return "produce_and_review";
  }
  if (trigger.reasons.includes("coding_plus_review") && reviewEnabled) {
    return "produce_and_review";
  }
  if (
    trigger.reasons.includes("research_plus_artifact") ||
    trigger.reasons.includes("explicit_multi_mention")
  ) {
    return collaboratorCount >= 2 ? "parallel_research" : "delegated";
  }
  return "delegated";
}

function step(
  stepId: string,
  objective: string,
  capability: CollaborationPlanStep["capability"],
  employeeId: string,
  dependsOn: string[],
  expectedOutput: string,
  estimatedWh: number,
  shareScope: CollaborationPlanStep["shareScope"] = "room",
): CollaborationPlanStep {
  return {
    stepId,
    objective,
    capability,
    employeeId,
    dependsOn,
    expectedOutput,
    shareScope,
    estimatedWh,
  };
}

/**
 * Build a typed CollaborationPlan. Pure — no DB, no execution.
 */
export function buildCollaborationPlan(input: BuildCollaborationPlanInput): {
  plan: CollaborationPlan | null;
  trigger: CollaborationTriggerDecision;
  policy: MultiAgentPolicy;
} {
  const policy = input.policy ?? getMultiAgentPolicy();
  const accessible = new Set(input.accessibleEmployeeIds);
  const candidates = input.candidates.filter((c) => accessible.has(c.id));
  const preferred =
    input.preferredEmployeeIds?.filter((id) => accessible.has(id)) ?? [];

  const trigger = shouldCollaborate({
    message: input.message,
    mentionedEmployeeCount: preferred.length,
    isPrivateDm: Boolean(input.isPrivateDm),
    accessibleEmployeeCount: candidates.length,
    legacyMode: input.legacyMode,
  });

  const lead = selectLeadEmployee({
    message: input.message,
    candidates,
    preferredEmployeeIds: preferred,
    orchestrationSelectedIds: input.orchestrationSelectedIds,
    dmEmployeeId: input.dmEmployeeId,
    isPrivateDm: input.isPrivateDm,
  });

  if (!lead) {
    return { plan: null, trigger, policy };
  }

  const objective =
    input.objective?.trim() ||
    input.message.trim().slice(0, 240) ||
    "Complete the requested work";

  if (!trigger.collaborate) {
    const single: CollaborationPlan = {
      objective,
      leadEmployeeId: lead.id,
      mode: "single_employee",
      steps: [
        step(
          "s1",
          objective,
          "reasoning",
          lead.id,
          [],
          "Final user-facing answer",
          0.4,
          input.isPrivateDm ? "private" : "room",
        ),
      ],
      maxCollaborators: 1,
      maxSteps: 1,
      estimatedWhMin: 0.2,
      estimatedWhMax: 1,
      hardWhLimit: Math.max(1, policy.autoWhLimit),
      approvalRequired: false,
    };
    return { plan: single, trigger, policy };
  }

  const collaborators = selectCollaborators(
    candidates,
    lead.id,
    preferred,
    policy.maxEmployees,
  );
  const mode = pickMode(trigger, collaborators.length, policy.reviewEnabled);
  const shareScope = input.isPrivateDm ? "private" : "room";
  const steps: CollaborationPlanStep[] = [];
  const mediaCapability =
    input.artifactIntent?.type === "image" || input.artifactIntent?.type === "video"
      ? input.artifactIntent.type
      : null;

  if (mediaCapability && collaborators[0]) {
    const ideator = collaborators[0];
    steps.push(
      step(
        "s_ideate",
        `Develop a strong creative direction and production brief for: ${objective}`,
        "reasoning",
        ideator.id,
        [],
        "Concise creative direction, composition, style, and constraints",
        0.7,
        shareScope,
      ),
    );
    const reviewer = policy.reviewEnabled ? collaborators[1] : undefined;
    if (reviewer) {
      steps.push(
        step(
          "s_review",
          "Review the creative direction for clarity, quality, safety, and fidelity to the request",
          "review",
          reviewer.id,
          ["s_ideate"],
          "Actionable production notes",
          0.5,
          shareScope,
        ),
      );
    }
    steps.push(
      step(
        "s_create",
        `${mediaCapability === "video" ? "Create the requested five-second video" : "Create the requested image"} using the shared creative findings`,
        mediaCapability,
        lead.id,
        [reviewer ? "s_review" : "s_ideate"],
        `${mediaCapability === "video" ? "Video" : "Image"} artifact and concise user-facing delivery`,
        mediaCapability === "video" ? 1.2 : 0.9,
        shareScope,
      ),
    );
  } else if (mode === "parallel_research") {
    const researchIds: string[] = [];
    collaborators.slice(0, 2).forEach((c, i) => {
      const id = `s_research_${i + 1}`;
      researchIds.push(id);
      steps.push(
        step(
          id,
          `Research aspect ${i + 1} of: ${objective}`,
          "search",
          c.id,
          [],
          "Structured finding with evidence ids",
          0.7,
          shareScope,
        ),
      );
    });
    if (policy.reviewEnabled && collaborators[2]) {
      steps.push(
        step(
          "s_review",
          "Review research findings for gaps and risks",
          "review",
          collaborators[2].id,
          researchIds,
          "Review notes",
          0.6,
          shareScope,
        ),
      );
      steps.push(
        step(
          "s_synth",
          "Synthesize final recommendation for the user",
          "synthesis",
          lead.id,
          ["s_review"],
          "Lead answer with citations and WH receipt",
          1.2,
          shareScope,
        ),
      );
    } else {
      steps.push(
        step(
          "s_synth",
          "Synthesize final recommendation for the user",
          "synthesis",
          lead.id,
          researchIds,
          "Lead answer with citations and WH receipt",
          1.2,
          shareScope,
        ),
      );
    }
  } else if (mode === "produce_and_review") {
    const producer = collaborators[0] ?? lead;
    steps.push(
      step(
        "s_produce",
        `Produce draft for: ${objective}`,
        trigger.reasons.includes("coding_plus_review") ? "coding" : "reasoning",
        producer.id,
        [],
        "Draft artifact or analysis",
        1.0,
        shareScope,
      ),
    );
    const reviewer =
      collaborators.find((c) => c.id !== producer.id) ??
      (producer.id === lead.id ? collaborators[0] : lead);
    if (reviewer && policy.reviewEnabled) {
      steps.push(
        step(
          "s_review",
          "Review draft for correctness and risk",
          "review",
          reviewer.id,
          ["s_produce"],
          "Review findings",
          0.6,
          shareScope,
        ),
      );
      steps.push(
        step(
          "s_revise",
          "Revise draft from review",
          "reasoning",
          producer.id,
          ["s_review"],
          "Revised draft",
          0.5,
          shareScope,
        ),
      );
      steps.push(
        step(
          "s_synth",
          "Deliver final answer to the user",
          "synthesis",
          lead.id,
          ["s_revise"],
          "Final lead answer",
          0.8,
          shareScope,
        ),
      );
    } else {
      steps.push(
        step(
          "s_synth",
          "Deliver final answer to the user",
          "synthesis",
          lead.id,
          ["s_produce"],
          "Final lead answer",
          0.8,
          shareScope,
        ),
      );
    }
  } else {
    // delegated
    const specialist = collaborators[0];
    if (specialist) {
      steps.push(
        step(
          "s_delegate",
          `Specialist work for: ${objective}`,
          trigger.reasons.includes("research_plus_artifact") ? "search" : "reasoning",
          specialist.id,
          [],
          "Specialist finding",
          0.8,
          shareScope,
        ),
      );
      steps.push(
        step(
          "s_synth",
          "Synthesize and respond to the user",
          "synthesis",
          lead.id,
          ["s_delegate"],
          "Final lead answer",
          1.0,
          shareScope,
        ),
      );
    } else {
      steps.push(
        step(
          "s1",
          objective,
          "reasoning",
          lead.id,
          [],
          "Final user-facing answer",
          0.5,
          shareScope,
        ),
      );
    }
  }

  const capped = steps.slice(0, policy.maxSteps);
  const estimatedWhMin = capped.reduce((s, x) => s + x.estimatedWh, 0) * 0.7;
  const estimatedWhMax = capped.reduce((s, x) => s + x.estimatedWh, 0) * 1.15;
  // Media tools enforce their own cost/approval policy. In particular,
  // video.create is always approval-gated at the tool boundary (29 WH).
  const approvalRequired =
    mediaCapability === null && estimatedWhMax > policy.autoWhLimit;

  const plan: CollaborationPlan = {
    objective,
    leadEmployeeId: lead.id,
    mode: capped.length <= 1 ? "single_employee" : mediaCapability ? "delegated" : mode,
    steps: capped,
    artifactIntent: mediaCapability ? input.artifactIntent : undefined,
    maxCollaborators: Math.min(policy.maxEmployees, 1 + collaborators.length),
    maxSteps: policy.maxSteps,
    estimatedWhMin: Number(estimatedWhMin.toFixed(2)),
    estimatedWhMax: Number(estimatedWhMax.toFixed(2)),
    hardWhLimit: Math.max(estimatedWhMax, policy.autoWhLimit),
    approvalRequired,
  };

  return { plan, trigger, policy };
}
