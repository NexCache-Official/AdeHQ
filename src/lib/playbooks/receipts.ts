import type { PlaybookEstimateCategory } from "./contracts";
import type { PlaybookRunEnvelope, PlaybookRunEnvelopeStep } from "./executor";
import { estimatePlaybookWh } from "./estimator";
import type { PlaybookDefinitionV1 } from "./contracts";

export type PlaybookReceiptLine = {
  category: PlaybookEstimateCategory | string;
  label: string;
  workHours: number;
};

export type PlaybookReceipt = {
  playbookKey: string;
  brainRunId: string | null;
  status: string;
  estimatedWhMin: number;
  estimatedWhMax: number;
  actualWh: number;
  lines: PlaybookReceiptLine[];
  /** Customer-facing attribution — never includes model/provider names. */
  attribution: string;
};

function categoryLabel(step: PlaybookRunEnvelopeStep, definition?: PlaybookDefinitionV1): string {
  const defStep = definition?.steps.find((s) => s.stepKey === step.stepKey);
  if (!defStep) return step.stepKey.replace(/_/g, " ");
  switch (defStep.kind) {
    case "search":
      return "Research";
    case "review":
      return "Review";
    case "artifact_compose":
      return "Drafting";
    case "procedure":
      if (defStep.procedureKey?.includes("render") || defStep.capability === "export") {
        return "Document export";
      }
      return "Analysis";
    default:
      return "Analysis";
  }
}

/**
 * Customer-facing WH receipt — never includes model or provider names.
 */
export function buildPlaybookReceipt(
  run: PlaybookRunEnvelope,
  steps: PlaybookRunEnvelopeStep[] = run.steps,
  definition?: PlaybookDefinitionV1,
): PlaybookReceipt {
  const collapsed = new Map<string, number>();
  for (const step of steps) {
    const wh = step.actualWh > 0 ? step.actualWh : 0;
    if (wh <= 0 && step.status !== "completed") continue;
    const label = categoryLabel(step, definition);
    const useWh = step.actualWh > 0 ? step.actualWh : step.estimatedWh * 0.85;
    collapsed.set(label, (collapsed.get(label) ?? 0) + useWh);
  }

  const lines: PlaybookReceiptLine[] = [...collapsed.entries()].map(([label, workHours]) => ({
    category: label as PlaybookEstimateCategory,
    label,
    workHours: Number(workHours.toFixed(2)),
  }));

  const actualWh = Number(
    (run.actualWh > 0
      ? run.actualWh
      : lines.reduce((n, l) => n + l.workHours, 0)
    ).toFixed(2),
  );

  const roles = [...new Set(run.roleAssignments.map((a) => a.roleKey))];
  const attribution =
    roles.length <= 1
      ? "Prepared by your AdeHQ workspace."
      : `Prepared across ${roles.length} roles in your AdeHQ workspace.`;

  let estimatedWhMin = run.estimatedWhMin;
  let estimatedWhMax = run.estimatedWhMax;
  if (definition) {
    const est = estimatePlaybookWh(definition);
    estimatedWhMin = est.estimatedWhMin;
    estimatedWhMax = est.estimatedWhMax;
  }

  return {
    playbookKey: run.playbookKey,
    brainRunId: run.brainRunId,
    status: run.status,
    estimatedWhMin,
    estimatedWhMax,
    actualWh,
    lines,
    attribution,
  };
}
