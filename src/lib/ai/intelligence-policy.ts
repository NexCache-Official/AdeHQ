import type { ModelMode } from "@/lib/ai/model-catalog";
import { defaultModelModeForRole } from "@/lib/ai/model-catalog";
import type { AIEmployee, EmployeeIntelligencePolicy, EmployeeRoleKey } from "@/lib/types";

export type IntelligenceMode =
  | "auto"
  | "efficient"
  | "balanced"
  | "strong"
  | "long_context"
  | "coding";

export type WorkHourProfile = "light" | "moderate" | "heavy";

export type BrowserAccess = "none" | "research_only" | "full_later";

export type RoutingPreference = "auto" | "cost_saver" | "quality_first" | "fastest";

/** Member-facing modes when Brain V1 is on — AdeHQ picks the route per task. */
export const BRAIN_INTELLIGENCE_MODE_OPTIONS: IntelligenceMode[] = ["auto"];

export const INTELLIGENCE_MODE_OPTIONS: IntelligenceMode[] = [
  "auto",
  "efficient",
  "balanced",
  "strong",
  "long_context",
  "coding",
];

/** Legacy tiers shown only when ADEHQ_BRAIN_V1=0. */
export const LEGACY_INTELLIGENCE_MODE_OPTIONS: IntelligenceMode[] = [
  "efficient",
  "balanced",
  "strong",
  "long_context",
  "coding",
];

export const ROUTING_PREFERENCE_OPTIONS: RoutingPreference[] = [
  "auto",
  "cost_saver",
  "quality_first",
  "fastest",
];

export const WORK_HOUR_PROFILE_OPTIONS: WorkHourProfile[] = ["light", "moderate", "heavy"];

export const BROWSER_ACCESS_OPTIONS: BrowserAccess[] = ["none", "research_only", "full_later"];

export const INTELLIGENCE_MODE_LABELS: Record<IntelligenceMode, string> = {
  auto: "Auto",
  efficient: "Efficient",
  balanced: "Balanced",
  strong: "Strong",
  long_context: "Long context",
  coding: "Coding",
};

/** Map legacy explicit tiers → intensity floor bias (preserved until admin edits policy). */
export function preferredIntensityFloorFromMode(
  mode: IntelligenceMode | string,
): "fast" | "standard" | "deep" | "research" | null {
  switch (mode) {
    case "efficient":
      return "fast";
    case "strong":
      return "deep";
    case "long_context":
    case "coding":
    case "balanced":
      return "standard";
    case "auto":
    default:
      return null;
  }
}

export const ROUTING_PREFERENCE_LABELS: Record<RoutingPreference, string> = {
  auto: "Auto",
  cost_saver: "Cost saver",
  quality_first: "Quality first",
  fastest: "Fastest",
};

export const ROUTING_PREFERENCE_DESCRIPTIONS: Record<RoutingPreference, string> = {
  auto: "Uses the cheapest capable model and upgrades when needed",
  cost_saver: "Prefers lower-cost routes when quality is sufficient",
  quality_first: "Prefers stronger models for harder work",
  fastest: "Prefers the quickest responsive route available",
};

export const WORK_HOUR_PROFILE_LABELS: Record<WorkHourProfile, string> = {
  light: "Light",
  moderate: "Moderate",
  heavy: "Heavy",
};

export const BROWSER_ACCESS_LABELS: Record<BrowserAccess, string> = {
  none: "None",
  research_only: "Research only",
  full_later: "Full (later)",
};

const DEFAULT_POLICY: EmployeeIntelligencePolicy = {
  defaultMode: "auto",
  allowedModes: ["auto"],
  preferredIntensityFloor: null,
  routingPreference: "auto",
  browserAccess: "none",
  workHourProfile: "moderate",
};

function isIntelligenceMode(value: string): value is IntelligenceMode {
  return INTELLIGENCE_MODE_OPTIONS.includes(value as IntelligenceMode);
}

function normalizeWorkHourProfile(value: unknown): WorkHourProfile {
  if (value === "light" || value === "moderate" || value === "heavy") return value;
  if (value === "low") return "light";
  if (value === "high") return "heavy";
  return "moderate";
}

export function normalizeBrowserAccess(value: unknown): BrowserAccess {
  if (value === "none" || value === "research_only" || value === "full_later") return value;
  if (value === "approved") return "full_later";
  return "none";
}

function normalizeRoutingPreference(value: unknown): RoutingPreference {
  if (
    value === "auto" ||
    value === "cost_saver" ||
    value === "quality_first" ||
    value === "fastest"
  ) {
    return value;
  }
  if (value === "siliconflow") return "auto";
  if (value === "vercel") return "quality_first";
  if (value === "mock") return "auto";
  return "auto";
}

export function modelModeFromIntelligenceMode(mode: IntelligenceMode): ModelMode {
  switch (mode) {
    case "efficient":
      return "cheap";
    case "strong":
      return "strong";
    case "long_context":
      return "long_context";
    case "coding":
      return "coding";
    case "auto":
    default:
      return "balanced";
  }
}

export function intelligenceModeFromModelMode(mode?: ModelMode | string | null): IntelligenceMode {
  switch (mode) {
    case "auto":
      return "auto";
    case "cheap":
    case "efficient":
      return "efficient";
    case "strong":
      return "strong";
    case "long_context":
      return "long_context";
    case "coding":
      return "coding";
    case "creative":
    case "balanced":
    default:
      return "balanced";
  }
}

export function normalizeIntelligencePolicy(
  raw: Partial<EmployeeIntelligencePolicy> | null | undefined,
  fallback?: Partial<EmployeeIntelligencePolicy> & {
    modelMode?: ModelMode;
    roleKey?: EmployeeRoleKey;
    preferredIntensityFloor?: EmployeeIntelligencePolicy["preferredIntensityFloor"];
  },
): EmployeeIntelligencePolicy {
  const derivedMode = intelligenceModeFromModelMode(
    fallback?.defaultMode && isIntelligenceMode(fallback.defaultMode)
      ? fallback.defaultMode
      : fallback?.modelMode ?? defaultModelModeForRole(fallback?.roleKey ?? "pm"),
  );

  const defaultModeRaw = raw?.defaultMode ?? fallback?.defaultMode ?? derivedMode;
  const defaultMode = isIntelligenceMode(defaultModeRaw) ? defaultModeRaw : derivedMode;

  const allowedModes = (raw?.allowedModes ?? fallback?.allowedModes ?? DEFAULT_POLICY.allowedModes)
    .map((mode) => (isIntelligenceMode(mode) ? mode : intelligenceModeFromModelMode(mode)))
    .filter((mode, index, arr) => arr.indexOf(mode) === index);

  const floor =
    raw?.preferredIntensityFloor !== undefined
      ? raw.preferredIntensityFloor
      : fallback?.preferredIntensityFloor;

  return {
    defaultMode,
    allowedModes: allowedModes.length ? allowedModes : DEFAULT_POLICY.allowedModes,
    preferredIntensityFloor: floor ?? null,
    routingPreference: normalizeRoutingPreference(
      raw?.routingPreference ?? fallback?.routingPreference ?? DEFAULT_POLICY.routingPreference,
    ),
    browserAccess: normalizeBrowserAccess(
      raw?.browserAccess ??
        fallback?.browserAccess ??
        (fallback?.roleKey === "research" ? "research_only" : DEFAULT_POLICY.browserAccess),
    ),
    workHourProfile: normalizeWorkHourProfile(
      raw?.workHourProfile ?? fallback?.workHourProfile ?? DEFAULT_POLICY.workHourProfile,
    ),
    notes: raw?.notes ?? fallback?.notes,
  };
}

export function resolveEmployeeIntelligencePolicy(employee: Pick<
  AIEmployee,
  "intelligencePolicy" | "modelMode" | "roleKey"
>): EmployeeIntelligencePolicy {
  return normalizeIntelligencePolicy(employee.intelligencePolicy, {
    modelMode: employee.modelMode,
    roleKey: employee.roleKey,
  });
}

export function buildIntelligencePolicyForHire(params: {
  modelMode: ModelMode;
  roleKey?: EmployeeRoleKey;
  browserAccess?: BrowserAccess;
  workHourProfile?: WorkHourProfile;
  routingPreference?: RoutingPreference;
  notes?: string;
}): EmployeeIntelligencePolicy {
  // Hires always start on Auto. Former tier becomes intensity floor bias only
  // (dropped the first time an admin edits the policy).
  const legacyMode = intelligenceModeFromModelMode(params.modelMode);
  const browserAccess =
    params.browserAccess ??
    (params.roleKey === "research" ? "research_only" : "none");

  return normalizeIntelligencePolicy({
    defaultMode: "auto",
    allowedModes: ["auto"],
    preferredIntensityFloor: preferredIntensityFloorFromMode(legacyMode),
    routingPreference: params.routingPreference ?? "auto",
    browserAccess,
    workHourProfile: params.workHourProfile ?? "moderate",
    notes: params.notes,
  });
}

export function intelligencePolicyToLegacyModelMode(
  policy: EmployeeIntelligencePolicy,
): ModelMode {
  return modelModeFromIntelligenceMode(
    isIntelligenceMode(policy.defaultMode)
      ? policy.defaultMode
      : intelligenceModeFromModelMode(policy.defaultMode),
  );
}

export function formatEmployeeIntelligenceSummary(
  employee: Pick<AIEmployee, "intelligencePolicy" | "modelMode" | "roleKey">,
): string {
  const policy = resolveEmployeeIntelligencePolicy(employee);
  if (policy.defaultMode === "auto") return "Auto intelligence";
  return `${INTELLIGENCE_MODE_LABELS[policy.defaultMode as IntelligenceMode] ?? "Auto"} intelligence`;
}

export function formatIntelligencePolicyLines(
  policy: EmployeeIntelligencePolicy,
): Array<{ label: string; value: string }> {
  const normalized = normalizeIntelligencePolicy(policy);
  const mode = normalized.defaultMode as IntelligenceMode;
  const routing = normalizeRoutingPreference(normalized.routingPreference);
  const workHourProfile = normalizeWorkHourProfile(normalized.workHourProfile);
  const browserAccess = normalizeBrowserAccess(normalized.browserAccess);

  const lines: Array<{ label: string; value: string }> = [
    {
      label: "Intelligence",
      value:
        mode === "auto"
          ? "Auto — AdeHQ picks the brain per task"
          : INTELLIGENCE_MODE_LABELS[mode],
    },
    {
      label: "Routing",
      value: `${ROUTING_PREFERENCE_LABELS[routing]} — ${ROUTING_PREFERENCE_DESCRIPTIONS[routing]}`,
    },
    {
      label: "Work profile",
      value: WORK_HOUR_PROFILE_LABELS[workHourProfile],
    },
    {
      label: "Browser access",
      value: BROWSER_ACCESS_LABELS[browserAccess],
    },
  ];

  return lines;
}

export function applyIntelligencePolicyUpdate(
  current: Pick<AIEmployee, "intelligencePolicy" | "modelMode" | "roleKey">,
  patch: Partial<EmployeeIntelligencePolicy>,
): { intelligencePolicy: EmployeeIntelligencePolicy; modelMode: ModelMode } {
  // Admin edit is the consent moment — drop legacy intensity bias.
  const intelligencePolicy = normalizeIntelligencePolicy(
    {
      ...resolveEmployeeIntelligencePolicy(current),
      ...patch,
      preferredIntensityFloor: null,
    },
    { modelMode: current.modelMode, roleKey: current.roleKey },
  );
  return {
    intelligencePolicy,
    modelMode: intelligencePolicyToLegacyModelMode(intelligencePolicy),
  };
}
