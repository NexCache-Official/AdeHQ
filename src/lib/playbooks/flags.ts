import { getCachedPlatformFlag } from "@/lib/admin/platform-flags";

function resolveBoolFlag(
  platformKey:
    | "adehq_playbook_runtime_v1"
    | "adehq_custom_playbooks_v1",
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

/**
 * PR-25 playbook runtime kill switch — default OFF.
 * ADEHQ_PLAYBOOK_RUNTIME_V1=1 / platform adehq_playbook_runtime_v1 enables run create + DAG.
 */
export function isPlaybookRuntimeV1Enabled(): boolean {
  return resolveBoolFlag("adehq_playbook_runtime_v1", "ADEHQ_PLAYBOOK_RUNTIME_V1", false);
}

/**
 * PR-25 custom (workspace) playbook builder — default OFF.
 * ADEHQ_CUSTOM_PLAYBOOKS_V1=1 enables Maya custom playbook authoring.
 */
export function isCustomPlaybooksV1Enabled(): boolean {
  return resolveBoolFlag("adehq_custom_playbooks_v1", "ADEHQ_CUSTOM_PLAYBOOKS_V1", false);
}

/**
 * Public UI entry points for playbooks — env only (NEXT_PUBLIC_*).
 * Default OFF when unset.
 */
export function isPlaybooksUiEnabled(): boolean {
  const env = process.env.NEXT_PUBLIC_ADEHQ_PLAYBOOKS_V1?.trim().toLowerCase();
  if (env === undefined || env === "") return false;
  if (env === "0" || env === "false" || env === "off" || env === "no") return false;
  return env === "1" || env === "true" || env === "on" || env === "yes";
}
