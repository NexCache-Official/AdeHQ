import { getCachedPlatformFlag } from "@/lib/admin/platform-flags";

function resolveBoolFlag(
  platformKey: "adehq_procedure_runtime_v1",
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

/** PR-25 procedure backpack — default OFF. */
export function isProcedureRuntimeV1Enabled(): boolean {
  return resolveBoolFlag("adehq_procedure_runtime_v1", "ADEHQ_PROCEDURE_RUNTIME_V1", false);
}
