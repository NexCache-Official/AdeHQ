import type { RuntimeProviderPref, RuntimeV2Mode } from "./types";

const VALID_MODES: RuntimeV2Mode[] = ["off", "shadow", "on"];
const VALID_PREFS: RuntimeProviderPref[] = ["auto", "siliconflow", "vercel", "mock"];

function normalizeMode(raw: string | undefined): RuntimeV2Mode {
  if (raw !== undefined && raw.trim() !== "") {
    const value = raw.trim().toLowerCase();
    if (VALID_MODES.includes(value as RuntimeV2Mode)) {
      return value as RuntimeV2Mode;
    }
  }

  // Legacy env compatibility (normalize to enum — do not use in new code).
  const legacyEnabled = process.env.AI_RUNTIME_V2_ENABLED?.trim().toLowerCase();
  const legacyShadow = process.env.AI_RUNTIME_V2_SHADOW_MODE?.trim().toLowerCase();
  if (legacyEnabled === "true" || legacyEnabled === "1") return "on";
  if (legacyShadow === "true" || legacyShadow === "1") return "shadow";

  return "off";
}

function normalizeProviderPref(raw: string | undefined): RuntimeProviderPref {
  const value = (raw ?? "auto").trim().toLowerCase();
  if (VALID_PREFS.includes(value as RuntimeProviderPref)) {
    return value as RuntimeProviderPref;
  }
  return "auto";
}

export type RuntimeFlagSnapshot = {
  mode: RuntimeV2Mode;
  providerPref: RuntimeProviderPref;
  /** Direct employee respond path — requires AI_RUNTIME_V2_MODE=on. Default false. */
  employeeDirectExecution: boolean;
  /** Queued orchestration employee runs — requires AI_RUNTIME_V2_MODE=on. Default false. */
  employeeQueuedExecution: boolean;
  legacyEnabled?: string;
  legacyShadow?: string;
};

function normalizeBooleanFlag(raw: string | undefined, defaultValue = false): boolean {
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const value = raw.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

/** Read runtime feature flags from environment. Default: off / auto / direct execution false. */
export function getRuntimeFlags(overrides?: {
  mode?: RuntimeV2Mode;
  providerPref?: RuntimeProviderPref;
  employeeDirectExecution?: boolean;
  employeeQueuedExecution?: boolean;
}): RuntimeFlagSnapshot {
  return {
    mode: overrides?.mode ?? normalizeMode(process.env.AI_RUNTIME_V2_MODE),
    providerPref:
      overrides?.providerPref ??
      normalizeProviderPref(process.env.AI_RUNTIME_V2_PROVIDER_PREF),
    employeeDirectExecution:
      overrides?.employeeDirectExecution ??
      normalizeBooleanFlag(process.env.AI_RUNTIME_V2_EMPLOYEE_DIRECT_EXECUTION, false),
    employeeQueuedExecution:
      overrides?.employeeQueuedExecution ??
      normalizeBooleanFlag(process.env.AI_RUNTIME_V2_EMPLOYEE_QUEUED_EXECUTION, false),
    legacyEnabled: process.env.AI_RUNTIME_V2_ENABLED,
    legacyShadow: process.env.AI_RUNTIME_V2_SHADOW_MODE,
  };
}

/** True only when direct employee replies may execute Runtime V2 (hot-path gated). */
export function isEmployeeDirectRuntimeExecutionEnabled(
  overrides?: Pick<RuntimeFlagSnapshot, "mode" | "employeeDirectExecution">,
): boolean {
  const flags = overrides
    ? {
        mode: overrides.mode ?? normalizeMode(process.env.AI_RUNTIME_V2_MODE),
        employeeDirectExecution:
          overrides.employeeDirectExecution ??
          normalizeBooleanFlag(process.env.AI_RUNTIME_V2_EMPLOYEE_DIRECT_EXECUTION, false),
      }
    : getRuntimeFlags();
  return flags.mode === "on" && flags.employeeDirectExecution;
}

/** True only when queued employee runs may execute Runtime V2 (hot-path gated). */
export function isEmployeeQueuedRuntimeExecutionEnabled(
  overrides?: Pick<RuntimeFlagSnapshot, "mode" | "employeeQueuedExecution">,
): boolean {
  const flags = overrides
    ? {
        mode: overrides.mode ?? normalizeMode(process.env.AI_RUNTIME_V2_MODE),
        employeeQueuedExecution:
          overrides.employeeQueuedExecution ??
          normalizeBooleanFlag(process.env.AI_RUNTIME_V2_EMPLOYEE_QUEUED_EXECUTION, false),
      }
    : getRuntimeFlags();
  return flags.mode === "on" && flags.employeeQueuedExecution;
}

export function isRuntimeExecutionAllowed(mode: RuntimeV2Mode): boolean {
  return mode === "on";
}

export function isRuntimeShadowMode(mode: RuntimeV2Mode): boolean {
  return mode === "shadow";
}

export function isRuntimeOff(mode: RuntimeV2Mode): boolean {
  return mode === "off";
}
