/**
 * PR-25 — runtime flags default OFF when env unset (no DB).
 */
import { invalidatePlatformFlagCache } from "../src/lib/admin/platform-flags";
import {
  isPlaybookRuntimeV1Enabled,
  isCustomPlaybooksV1Enabled,
  isPlaybooksUiEnabled,
} from "../src/lib/playbooks/flags";
import {
  isArtifactRuntimeV1Enabled,
  isArtifactExportV1Enabled,
  isArtifactVisualQaV1Enabled,
  isArtifactsUiEnabled,
} from "../src/lib/artifacts/flags";
import { isProcedureRuntimeV1Enabled } from "../src/lib/procedures/flags";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ENV_KEYS = [
  "ADEHQ_PLAYBOOK_RUNTIME_V1",
  "NEXT_PUBLIC_ADEHQ_PLAYBOOKS_V1",
  "ADEHQ_CUSTOM_PLAYBOOKS_V1",
  "ADEHQ_ARTIFACT_RUNTIME_V1",
  "NEXT_PUBLIC_ADEHQ_ARTIFACTS_V1",
  "ADEHQ_ARTIFACT_EXPORT_V1",
  "ADEHQ_ARTIFACT_VISUAL_QA_V1",
  "ADEHQ_PROCEDURE_RUNTIME_V1",
] as const;

const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  saved[key] = process.env[key];
  delete process.env[key];
}
invalidatePlatformFlagCache();

console.log("\n=== PR-25 flags default OFF ===\n");

check("isPlaybookRuntimeV1Enabled false", isPlaybookRuntimeV1Enabled() === false);
check("isPlaybooksUiEnabled false", isPlaybooksUiEnabled() === false);
check("isCustomPlaybooksV1Enabled false", isCustomPlaybooksV1Enabled() === false);
check("isArtifactRuntimeV1Enabled false", isArtifactRuntimeV1Enabled() === false);
check("isArtifactsUiEnabled false", isArtifactsUiEnabled() === false);
check("isArtifactExportV1Enabled false", isArtifactExportV1Enabled() === false);
check("isArtifactVisualQaV1Enabled false", isArtifactVisualQaV1Enabled() === false);
check("isProcedureRuntimeV1Enabled false", isProcedureRuntimeV1Enabled() === false);

// restore
for (const key of ENV_KEYS) {
  if (saved[key] === undefined) delete process.env[key];
  else process.env[key] = saved[key];
}

console.log(`\n${failed ? `Failed: ${failed}` : "All PR-25 flag default-off checks passed."}\n`);
process.exit(failed ? 1 : 0);
