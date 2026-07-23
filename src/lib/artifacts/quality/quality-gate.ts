import { isArtifactExportV1Enabled } from "../flags";
import { schemaCheck, type QualityCheckResult } from "./schema-check";
import { completenessCheck } from "./completeness-check";
import { provenanceCheck, type ProvenanceRow } from "./provenance-check";
import { numericCheck } from "./numeric-check";
import { linkCheck } from "./link-check";
import { readabilityCheck } from "./readability-check";
import { exportCheck } from "./export-check";
import { visualCheck } from "./visual-check";

export type QualityGateInput = {
  canonical: unknown;
  requiredSectionKeys?: string[];
  requiredProvenancePaths?: string[];
  provenance?: ProvenanceRow[];
  format?: string;
  runVisual?: boolean;
  previewHtml?: string;
};

export type QualityGateResult = {
  ok: boolean;
  outcome: "pass" | "fail";
  checks: QualityCheckResult[];
};

export async function runQualityGate(input: QualityGateInput): Promise<QualityGateResult> {
  const schema = schemaCheck(input.canonical);
  const completeness = completenessCheck(input.canonical, input.requiredSectionKeys);
  const provenance = provenanceCheck(input.requiredProvenancePaths, input.provenance);
  const numeric = numericCheck(input.canonical);
  const links = linkCheck(input.canonical);
  const readability = readabilityCheck(input.canonical);
  const exportability = exportCheck({
    hasCanonical: Boolean(input.canonical),
    schemaValid: schema.ok,
    exportEnabled: isArtifactExportV1Enabled(),
    format: input.format,
  });

  const checks: QualityCheckResult[] = [
    schema,
    completeness,
    provenance,
    numeric,
    links,
    readability,
    exportability,
  ];

  if (input.runVisual) {
    checks.push(await visualCheck({ previewHtml: input.previewHtml }));
  }

  // Export flag off should not fail draft quality — only gate exportability
  const blocking = checks.filter((c) => c.check !== "export" && !c.ok);
  const ok = blocking.length === 0;
  return { ok, outcome: ok ? "pass" : "fail", checks };
}

export {
  schemaCheck,
  completenessCheck,
  provenanceCheck,
  numericCheck,
  linkCheck,
  readabilityCheck,
  exportCheck,
  visualCheck,
};
