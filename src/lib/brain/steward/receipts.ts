import { displayWorkHours } from "@/lib/billing/costing/work-hours";
import type { CollaborationPlan } from "./types";
import type { CollaborationReceipt, StewardProgressSnapshot } from "./types-execution";

function labelForCapability(capability: string): string {
  switch (capability) {
    case "search":
      return "Research";
    case "review":
      return "Specialist review";
    case "synthesis":
      return "Final synthesis";
    case "coding":
      return "Implementation";
    case "reasoning":
      return "Analysis";
    case "tool":
      return "Actions";
    default:
      return capability.replace(/_/g, " ");
  }
}

/**
 * Build a member-facing collaboration receipt (no provider names).
 */
export function buildCollaborationReceipt(
  plan: CollaborationPlan,
  progress: StewardProgressSnapshot,
  nameById: Map<string, string>,
): CollaborationReceipt {
  const lines = progress.steps
    .filter((s) => (s.actualWh ?? 0) > 0 || s.status === "completed")
    .map((s) => ({
      label: labelForCapability(s.capability),
      workHours: displayWorkHours(s.actualWh ?? s.estimatedWh * 0.85),
    }));

  // Collapse duplicate labels
  const collapsed = new Map<string, number>();
  for (const line of lines) {
    collapsed.set(line.label, (collapsed.get(line.label) ?? 0) + line.workHours);
  }
  const merged = [...collapsed.entries()].map(([label, workHours]) => ({
    label,
    workHours: Number(workHours.toFixed(2)),
  }));

  const total = Number(
    merged.reduce((n, l) => n + l.workHours, 0).toFixed(2),
  );
  const employeeIds = new Set(progress.steps.map((s) => s.employeeId));
  const lead = nameById.get(plan.leadEmployeeId) ?? "the lead";
  const others = [...employeeIds]
    .filter((id) => id !== plan.leadEmployeeId)
    .map((id) => nameById.get(id) ?? id);

  let attribution = `Prepared by ${lead}`;
  if (others.length === 1) attribution += ` with research from ${others[0]}`;
  else if (others.length === 2) {
    attribution += ` with research from ${others[0]} and review by ${others[1]}`;
  } else if (others.length > 2) {
    attribution += ` with ${others.length} collaborators`;
  }
  attribution += ".";

  return {
    brainRunId: progress.brainRunId,
    totalWorkHours: total,
    employeeCount: employeeIds.size,
    lines: merged,
    attribution,
  };
}

export function formatReceiptSummary(receipt: CollaborationReceipt): string {
  return `Used ${receipt.totalWorkHours.toFixed(1)} Work Hours · ${receipt.employeeCount} employee${receipt.employeeCount === 1 ? "" : "s"} collaborated`;
}

/** Failure copy — never raw provider errors. */
export function formatStewardFailureMessage(
  failedEmployeeName: string | undefined,
  leadName: string | undefined,
): string {
  const failed = failedEmployeeName ?? "A collaborator";
  const lead = leadName ?? "the lead";
  return `${failed}'s research step could not complete, so ${lead} continued using the available evidence. No Work Hours were charged for the failed step.`;
}
