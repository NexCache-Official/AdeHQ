import { buildCollaborationPlan, type BuildCollaborationPlanInput } from "./build-plan";
import { validateCollaborationPlan } from "./validate-plan";
import type {
  CollaborationPlan,
  StewardShadowComparison,
  StewardShadowPlanResult,
} from "./types";

export type LegacyPlanSnapshot = {
  mode?: string | null;
  leadEmployeeId?: string | null;
  participantEmployeeIds?: string[];
  selectedEmployeeIds?: string[];
};

function modeFamily(mode: string | null | undefined): string {
  const m = (mode ?? "").toLowerCase();
  if (
    !m ||
    m === "direct_reply" ||
    m === "ambient_smart" ||
    m === "silent" ||
    m === "single_employee" ||
    m === "broadcast_social"
  ) {
    return "single";
  }
  if (m === "produce_and_review") return "review";
  // Legacy lead/handoff/panel and Steward delegated/parallel all mean multi-employee work
  if (
    m === "panel_response" ||
    m === "parallel_research" ||
    m === "brainstorm" ||
    m === "lead_collaborator" ||
    m === "handoff" ||
    m === "delegated" ||
    m === "multi_employee_collaboration" ||
    m === "ambient_collaboration"
  ) {
    return "multi";
  }
  return m;
}

export function compareWithLegacyPlan(
  plan: CollaborationPlan,
  legacy: LegacyPlanSnapshot | null | undefined,
): StewardShadowComparison {
  if (!legacy) {
    return {
      leadMatches: true,
      modeFamilyMatches: true,
      collaboratorOverlap: 1,
      notes: ["no_legacy_plan"],
    };
  }

  const notes: string[] = [];
  const legacyLead =
    legacy.leadEmployeeId ||
    legacy.participantEmployeeIds?.[0] ||
    legacy.selectedEmployeeIds?.[0] ||
    null;
  const leadMatches = !legacyLead || legacyLead === plan.leadEmployeeId;
  if (!leadMatches) {
    notes.push(`lead_diff shadow=${plan.leadEmployeeId} legacy=${legacyLead}`);
  }

  const modeFamilyMatches = modeFamily(plan.mode) === modeFamily(legacy.mode ?? null);
  if (!modeFamilyMatches) {
    notes.push(`mode_family_diff shadow=${plan.mode} legacy=${legacy.mode}`);
  }

  const shadowIds = new Set(plan.steps.map((s) => s.employeeId));
  const legacyIds = new Set([
    ...(legacy.participantEmployeeIds ?? []),
    ...(legacy.selectedEmployeeIds ?? []),
  ]);
  let overlap = 0;
  if (legacyIds.size === 0) {
    overlap = 1;
  } else {
    let hits = 0;
    for (const id of legacyIds) if (shadowIds.has(id)) hits += 1;
    overlap = hits / legacyIds.size;
    if (overlap < 1) notes.push(`collaborator_overlap=${overlap.toFixed(2)}`);
  }

  return { leadMatches, modeFamilyMatches, collaboratorOverlap: overlap, notes };
}

/**
 * Shadow-only: build + validate a CollaborationPlan. Never executes delegation.
 */
export function buildStewardShadowPlan(
  input: BuildCollaborationPlanInput & { legacy?: LegacyPlanSnapshot | null },
): StewardShadowPlanResult {
  const { plan, trigger, policy } = buildCollaborationPlan(input);

  if (!plan) {
    return {
      plan: null,
      trigger,
      validation: { ok: false, errors: ["no_plan"] },
      comparison: null,
      shadow: true,
      executed: false,
    };
  }

  const validation = validateCollaborationPlan(plan, {
    accessibleEmployeeIds: input.accessibleEmployeeIds,
    roomEmployeeIds: input.roomEmployeeIds,
    permittedCapabilities: input.permittedCapabilities,
    isPrivateDm: input.isPrivateDm,
    policy,
  });

  const comparison = compareWithLegacyPlan(plan, input.legacy ?? null);

  return {
    plan,
    trigger,
    validation,
    comparison,
    shadow: true,
    executed: false,
  };
}
