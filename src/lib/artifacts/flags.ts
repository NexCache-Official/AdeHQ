import { getCachedPlatformFlag } from "@/lib/admin/platform-flags";

function resolveBoolFlag(
  platformKey:
    | "adehq_artifact_runtime_v1"
    | "adehq_artifact_export_v1"
    | "adehq_artifact_visual_qa_v1",
  envKey: string,
  defaultOn: boolean,
): boolean {
  const cached = getCachedPlatformFlag(platformKey);
  if (cached !== undefined && cached !== null) {
    if (typeof cached === "boolean") return cached;
    const raw = String(cached).trim().toLowerCase();
    if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
    if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  }

  const env = process.env[envKey]?.trim().toLowerCase();
  if (env === "0" || env === "false" || env === "off" || env === "no") return false;
  if (env === undefined || env === "") return defaultOn;
  return env === "1" || env === "true" || env === "on" || env === "yes";
}

/** PR-25 structured artifact runtime — default OFF. */
export function isArtifactRuntimeV1Enabled(): boolean {
  return resolveBoolFlag("adehq_artifact_runtime_v1", "ADEHQ_ARTIFACT_RUNTIME_V1", false);
}

/** PR-25 artifact export jobs — default OFF. */
export function isArtifactExportV1Enabled(): boolean {
  return resolveBoolFlag("adehq_artifact_export_v1", "ADEHQ_ARTIFACT_EXPORT_V1", false);
}

/** PR-25 vision-based visual QA — default OFF. */
export function isArtifactVisualQaV1Enabled(): boolean {
  return resolveBoolFlag("adehq_artifact_visual_qa_v1", "ADEHQ_ARTIFACT_VISUAL_QA_V1", false);
}

/** Public UI entry points for artifacts — env only. Default OFF. */
export function isArtifactsUiEnabled(): boolean {
  const env = process.env.NEXT_PUBLIC_ADEHQ_ARTIFACTS_V1?.trim().toLowerCase();
  if (env === undefined || env === "") return false;
  if (env === "0" || env === "false" || env === "off" || env === "no") return false;
  return env === "1" || env === "true" || env === "on" || env === "yes";
}
