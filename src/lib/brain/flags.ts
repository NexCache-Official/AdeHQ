import { getCachedPlatformFlag } from "@/lib/admin/platform-flags";

/**
 * AdeHQ Brain V1 kill switch — gates routing / UX / decision persistence only.
 * Metering fixes (recordBrainUsage) are NEVER behind this flag.
 *
 * ADEHQ_BRAIN_V1=0 (or platform flag false) restores prior selection path.
 */
export function isBrainV1Enabled(): boolean {
  const cached = getCachedPlatformFlag("adehq_brain_v1");
  if (cached !== undefined && cached !== null) {
    if (typeof cached === "boolean") return cached;
    const raw = String(cached).trim().toLowerCase();
    if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
    if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  }

  const env = process.env.ADEHQ_BRAIN_V1?.trim().toLowerCase();
  if (env === "0" || env === "false" || env === "off" || env === "no") return false;
  // Default ON once Brain ships so new installs get auto intelligence.
  if (env === undefined || env === "") return true;
  return env === "1" || env === "true" || env === "on" || env === "yes";
}
