import type { QualityCheckResult } from "./schema-check";

export type ProvenanceRow = {
  artifact_path: string;
  source_type: string;
  source_id: string;
};

export function provenanceCheck(
  requiredPaths: string[] | undefined,
  provenance: ProvenanceRow[] | undefined,
): QualityCheckResult {
  const errors: string[] = [];
  if (!requiredPaths?.length) {
    return { check: "provenance", ok: true, errors: [] };
  }
  const covered = new Set((provenance ?? []).map((p) => p.artifact_path));
  for (const path of requiredPaths) {
    if (![...covered].some((c) => c === path || c.startsWith(`${path}.`))) {
      errors.push(`missing provenance for ${path}`);
    }
  }
  for (const row of provenance ?? []) {
    if (!row.source_type || !row.source_id) {
      errors.push(`invalid provenance row at ${row.artifact_path}`);
    }
  }
  return { check: "provenance", ok: errors.length === 0, errors };
}
