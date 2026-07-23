import type { QualityCheckResult } from "./schema-check";

export function exportCheck(opts: {
  hasCanonical: boolean;
  schemaValid: boolean;
  exportEnabled: boolean;
  format?: string;
}): QualityCheckResult {
  const errors: string[] = [];
  if (!opts.exportEnabled) errors.push("artifact export flag is off");
  if (!opts.hasCanonical) errors.push("canonical content required before export");
  if (!opts.schemaValid) errors.push("canonical content failed schema validation");
  if (opts.format && !["docx", "pptx", "xlsx", "pdf", "html", "markdown", "csv"].includes(opts.format)) {
    errors.push(`unsupported export format: ${opts.format}`);
  }
  return { check: "export", ok: errors.length === 0, errors };
}
