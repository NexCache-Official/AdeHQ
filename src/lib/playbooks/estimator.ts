import type {
  PlaybookDefinitionV1,
  PlaybookEstimate,
  PlaybookEstimateBreakdownLine,
  PlaybookEstimateCategory,
  PlaybookStepDefinition,
} from "./contracts";

export type EstimatePlaybookOpts = {
  /** Multiplier applied to max (default 1.25). */
  contingencyFactor?: number;
  /** Floor for min as fraction of nominal (default 0.85). */
  minFactor?: number;
};

function categoryForStep(step: PlaybookStepDefinition): PlaybookEstimateCategory {
  if (step.kind === "search") return "Research";
  if (step.kind === "review") return "Review";
  if (step.kind === "artifact_compose") {
    if (step.procedureKey?.includes("render") || step.procedureKey?.includes("export")) {
      return "Document export";
    }
    return "Drafting";
  }
  if (step.kind === "procedure") {
    if (
      step.procedureKey?.includes("render") ||
      step.procedureKey?.includes("export") ||
      step.capability === "export"
    ) {
      return "Document export";
    }
    if (step.capability === "search" || step.procedureKey?.includes("profile")) {
      return "Research";
    }
    return "Analysis";
  }
  // reasoning
  return "Analysis";
}

/**
 * Estimate WH for a playbook definition with category breakdown.
 * Categories: Research / Analysis / Drafting / Review / Document export.
 */
export function estimatePlaybookWh(
  definition: PlaybookDefinitionV1,
  opts?: EstimatePlaybookOpts,
): PlaybookEstimate {
  const contingency = opts?.contingencyFactor ?? 1.25;
  const minFactor = opts?.minFactor ?? 0.85;

  const byCategory = new Map<PlaybookEstimateCategory, { wh: number; stepKeys: string[] }>();
  let total = 0;

  for (const step of definition.steps) {
    const category = categoryForStep(step);
    const wh = Math.max(0, step.estimatedWh);
    total += wh;
    const entry = byCategory.get(category) ?? { wh: 0, stepKeys: [] };
    entry.wh += wh;
    entry.stepKeys.push(step.stepKey);
    byCategory.set(category, entry);
  }

  const order: PlaybookEstimateCategory[] = [
    "Research",
    "Analysis",
    "Drafting",
    "Review",
    "Document export",
  ];

  const breakdown: PlaybookEstimateBreakdownLine[] = order
    .filter((c) => byCategory.has(c))
    .map((category) => {
      const entry = byCategory.get(category)!;
      return {
        category,
        estimatedWh: Number(entry.wh.toFixed(3)),
        stepKeys: entry.stepKeys,
      };
    });

  const estimatedWhMin = Number((total * minFactor).toFixed(3));
  const estimatedWhMax = Number((total * contingency).toFixed(3));
  const hardWhLimit = Math.max(
    definition.policies.hardWhLimit,
    estimatedWhMax,
  );

  return {
    estimatedWhMin,
    estimatedWhMax,
    hardWhLimit,
    breakdown,
    totalEstimatedWh: Number(total.toFixed(3)),
  };
}
