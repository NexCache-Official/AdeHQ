import { getCachedPlatformFlag } from "@/lib/admin/platform-flags";

function resolveBoolFlag(
  platformKey:
    | "adehq_brain_v1"
    | "adehq_brain_search_v1"
    | "adehq_brain_vision_v1"
    | "adehq_brain_image_v1",
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
 * AdeHQ Brain V1 kill switch — gates routing / UX / decision persistence only.
 * Metering fixes (recordBrainUsage) are NEVER behind this flag.
 *
 * ADEHQ_BRAIN_V1=0 (or platform flag false) restores prior selection path.
 */
export function isBrainV1Enabled(): boolean {
  return resolveBoolFlag("adehq_brain_v1", "ADEHQ_BRAIN_V1", true);
}

/**
 * PR-14 Exa-first search kill switch.
 * When off: restore single-backup search path; preserve metering records.
 * ADEHQ_BRAIN_SEARCH_V1=0 restores the previous live search path.
 */
export function isBrainSearchV1Enabled(): boolean {
  return resolveBoolFlag("adehq_brain_search_v1", "ADEHQ_BRAIN_SEARCH_V1", true);
}

/** Workspace search cache (PR-14). Default ON. */
export function isBrainSearchCacheEnabled(): boolean {
  const env = process.env.ADEHQ_SEARCH_CACHE?.trim().toLowerCase();
  if (env === "0" || env === "false" || env === "off" || env === "no") return false;
  return true;
}

/**
 * PR-15 vision kill switch.
 * When off: skip VL understanding; text file retrieval remains.
 * ADEHQ_BRAIN_VISION_V1=0 restores pre-vision attachment behavior.
 */
export function isBrainVisionV1Enabled(): boolean {
  return resolveBoolFlag("adehq_brain_vision_v1", "ADEHQ_BRAIN_VISION_V1", true);
}

/**
 * PR-16 image creation/edit kill switch.
 * When off: image tools refuse generation; catalog routes stay for Control.
 * ADEHQ_BRAIN_IMAGE_V1=0 disables live image artifact workflows.
 */
export function isBrainImageV1Enabled(): boolean {
  return resolveBoolFlag("adehq_brain_image_v1", "ADEHQ_BRAIN_IMAGE_V1", true);
}
