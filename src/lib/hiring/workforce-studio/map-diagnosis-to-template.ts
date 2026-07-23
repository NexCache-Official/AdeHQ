// PR-22B — map BusinessOperatingDiagnosis → archetype/modules/pack → TemplateManifest.

import type { BusinessOperatingDiagnosis, ClarificationAnswer } from "./diagnosis-types";
import { confidenceAfterAnswers } from "./adaptive-questions";
import { forecastWorkHours } from "./simulation";
import { composeBlueprintFromTemplate } from "./composer";
import { getTemplateManifest } from "./templates/registry";
import type { ArchitectComposeResult } from "./diagnosis-types";
import { selectArchetypeAndPack } from "./ontology/select-pack";
import type { TemplateManifest } from "./templates/types";

export type TemplateMapping = {
  templateKey: string;
  intakeAnswers: Record<string, unknown>;
  teamName: string;
  designReasons: string[];
  mappingReason: string;
  archetypeId: string;
  moduleIds: string[];
  adaptationId: string;
  /** Resolved manifest used for compose (legacy or ontology-compiled). */
  manifest: TemplateManifest;
};

/**
 * Deterministic pack selection from diagnosis + clarification answers.
 * Pure — unit-tested without LLM calls.
 */
export function mapDiagnosisToTemplate(
  diagnosis: BusinessOperatingDiagnosis,
  answers: ClarificationAnswer[] = [],
): TemplateMapping {
  const selection = selectArchetypeAndPack(diagnosis, answers);
  let manifest = selection.manifest;
  let templateKey = selection.pack?.key ?? selection.manifest.key;

  // Swap in real legacy manifest when select-pack reserved a legacy key.
  if (["software_house", "saas_startup", "general_ops"].includes(selection.manifest.key)) {
    const legacy = getTemplateManifest(selection.manifest.key);
    if (legacy) {
      manifest = legacy;
      templateKey = legacy.key;
    }
  }

  const intakeAnswers: Record<string, unknown> = { ...selection.intakeAnswers };
  for (const q of manifest.intakeQuestions) {
    if (intakeAnswers[q.id] == null && q.defaultValue != null) {
      intakeAnswers[q.id] = q.defaultValue;
    }
  }

  // Drop intake keys the target manifest doesn't understand.
  const allowed = new Set(manifest.intakeQuestions.map((q) => q.id));
  for (const key of Object.keys(intakeAnswers)) {
    if (!allowed.has(key)) delete intakeAnswers[key];
  }

  const companyLabel =
    diagnosis.businessType?.trim() || diagnosis.industry?.trim() || "your business";
  const teamName = `${companyLabel} team`.slice(0, 80);

  const designReasons =
    diagnosis.designReasons?.length >= 2
      ? diagnosis.designReasons.slice(0, 3)
      : [
          selection.mappingReason,
          `Modules: ${selection.moduleIds.slice(0, 4).join(", ")}.`,
          intakeAnswers.team_size_preference === "lean"
            ? "Started lean so weekly Work Hours stay manageable."
            : "Sized for the workload you described.",
        ];

  return {
    templateKey,
    intakeAnswers,
    teamName,
    designReasons,
    mappingReason: selection.mappingReason,
    archetypeId: selection.archetype.id,
    moduleIds: selection.moduleIds,
    adaptationId: selection.adaptationId,
    manifest,
  };
}

/** Compose a payload from the mapping and attach WH band estimates for reveal. */
export function buildArchitectComposePreview(
  diagnosis: BusinessOperatingDiagnosis,
  answers: ClarificationAnswer[],
  companyProfileRevision: number | null,
): ArchitectComposeResult & { mapping: TemplateMapping } {
  const mapping = mapDiagnosisToTemplate(diagnosis, answers);
  const payload = composeBlueprintFromTemplate(
    mapping.manifest,
    mapping.intakeAnswers,
    companyProfileRevision,
  );
  const bands = forecastWorkHours(payload.seats);
  const expectedWeeklyWhLow = Math.round(bands.reduce((sum, b) => sum + b.lowWh, 0));
  const expectedWeeklyWhHigh = Math.round(bands.reduce((sum, b) => sum + b.highWh, 0));

  return {
    templateKey: mapping.templateKey,
    intakeAnswers: mapping.intakeAnswers,
    teamName: mapping.teamName,
    designReasons: mapping.designReasons,
    expectedWeeklyWhLow,
    expectedWeeklyWhHigh,
    mapping,
  };
}

export function architectConfidence(
  diagnosis: BusinessOperatingDiagnosis,
  answers: ClarificationAnswer[],
): number {
  return confidenceAfterAnswers(diagnosis, answers);
}
