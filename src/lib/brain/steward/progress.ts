import type { CollaborationPlan } from "./types";
import type {
  StewardProgressSnapshot,
  StewardStepProgress,
  StewardStepProgressStatus,
} from "./types-execution";

export function buildInitialProgress(
  brainRunId: string,
  plan: CollaborationPlan,
  nameById: Map<string, string>,
): StewardProgressSnapshot {
  const steps: StewardStepProgress[] = plan.steps.map((s) => ({
    stepId: s.stepId,
    objective: s.objective,
    employeeId: s.employeeId,
    employeeName: nameById.get(s.employeeId),
    capability: s.capability,
    status: "queued",
    estimatedWh: s.estimatedWh,
  }));

  const collaboratorNames = [
    ...new Set(
      plan.steps
        .filter((s) => s.employeeId !== plan.leadEmployeeId)
        .map((s) => nameById.get(s.employeeId) ?? s.employeeId),
    ),
  ];

  return {
    brainRunId,
    leadEmployeeId: plan.leadEmployeeId,
    leadEmployeeName: nameById.get(plan.leadEmployeeId),
    mode: plan.mode,
    status: plan.approvalRequired ? "waiting_for_approval" : "running",
    steps,
    collaboratorNames,
    estimatedWhMin: plan.estimatedWhMin,
    estimatedWhMax: plan.estimatedWhMax,
    actualWh: 0,
    approvalRequired: plan.approvalRequired,
  };
}

export function updateStepProgress(
  snapshot: StewardProgressSnapshot,
  stepId: string,
  status: StewardStepProgressStatus,
  actualWh?: number,
): StewardProgressSnapshot {
  const steps = snapshot.steps.map((s) =>
    s.stepId === stepId
      ? { ...s, status, actualWh: actualWh ?? s.actualWh }
      : s,
  );
  const actualTotal = steps.reduce((n, s) => n + (s.actualWh ?? 0), 0);
  let runStatus = snapshot.status;
  if (steps.every((s) => s.status === "completed" || s.status === "skipped")) {
    runStatus = "completed";
  } else if (steps.some((s) => s.status === "failed") && steps.every((s) =>
    ["completed", "failed", "cancelled", "skipped"].includes(s.status),
  )) {
    runStatus = "failed";
  } else if (steps.every((s) => s.status === "cancelled")) {
    runStatus = "cancelled";
  } else if (runStatus === "waiting_for_approval") {
    /* keep */
  } else {
    runStatus = "running";
  }
  return { ...snapshot, steps, actualWh: Number(actualTotal.toFixed(2)), status: runStatus };
}

/** Lightweight coordination copy for the room UI. */
export function formatCoordinationLine(snapshot: StewardProgressSnapshot): string {
  const lead = snapshot.leadEmployeeName ?? "the lead";
  if (snapshot.collaboratorNames.length === 0) {
    return `${lead} is handling this.`;
  }
  if (snapshot.collaboratorNames.length === 1) {
    return `${lead} is coordinating with ${snapshot.collaboratorNames[0]}.`;
  }
  const last = snapshot.collaboratorNames[snapshot.collaboratorNames.length - 1];
  const rest = snapshot.collaboratorNames.slice(0, -1).join(", ");
  return `${lead} is coordinating with ${rest} and ${last}.`;
}

export function formatStepLine(step: StewardStepProgress): string {
  const name = step.employeeName ?? "Teammate";
  const verb =
    step.capability === "search"
      ? "researched"
      : step.capability === "review"
        ? "reviewed"
        : step.capability === "synthesis"
          ? "prepared the final recommendation"
          : "worked on";
  if (step.status === "completed") return `✓ ${name} ${verb} the findings`;
  if (step.status === "running" || step.status === "leased") {
    return `• ${name} is ${step.capability === "review" ? "reviewing" : step.capability === "synthesis" ? "preparing the final recommendation" : "working"}…`;
  }
  if (step.status === "failed") return `✗ ${name}'s step could not complete`;
  if (step.status === "cancelled") return `○ ${name} — cancelled`;
  return `○ ${name} will ${step.capability === "synthesis" ? "prepare the final recommendation" : "contribute"}`;
}
