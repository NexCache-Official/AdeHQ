import { isArtifactVisualQaV1Enabled } from "../flags";
import type { QualityCheckResult } from "./schema-check";

/**
 * Vision-based visual QA — gated behind ADEHQ_ARTIFACT_VISUAL_QA_V1 (default OFF).
 * Stub returns pass-through when disabled.
 */
export async function visualCheck(_input?: {
  previewHtml?: string;
  exportBuffer?: Buffer;
}): Promise<QualityCheckResult> {
  if (!isArtifactVisualQaV1Enabled()) {
    return {
      check: "visual",
      ok: true,
      errors: [],
    };
  }
  // Stub: real vision QA wires in later
  return {
    check: "visual",
    ok: true,
    errors: [],
  };
}
