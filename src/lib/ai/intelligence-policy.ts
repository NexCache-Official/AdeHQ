import type { ModelMode } from "@/lib/ai/model-catalog";
import { defaultModelModeForRole } from "@/lib/ai/model-catalog";
import type { AIEmployee, EmployeeIntelligencePolicy, EmployeeRoleKey } from "@/lib/types";

export type IntelligenceMode =
  | "efficient"
  | "balanced"
  | "strong"
  | "long_context"
  | "coding";

export type WorkHourProfile = "light" | "moderate" | "heavy";

export type BrowserAccess = "none" | "research_only" | "full_later";

export type RoutingPreference = "auto" | "cost_saver" | "quality_first" | "fastest";

export const INTELLIGENCE_MODE_OPTIONS: IntelligenceMode[] = [
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
  efficient: "Efficient",
  balanced: "Balanced",
  strong: "Strong",
  long_context: "Long context",
  coding: "Coding",
};

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
  defaultMode: "balanced",
  allowedModes: ["efficient", "balanced", "strong"],
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
    default:
      return "balanced";
  }
}

export function intelligenceModeFromModelMode(mode?: ModelMode | string | null): IntelligenceMode {
  switch (mode) {
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
  fallback?: Partial<EmployeeIntelligencePolicy> & { modelMode?: ModelMode; roleKey?: EmployeeRoleKey },
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

  return {
    defaultMode,
    allowedModes: allowedModes.length ? allowedModes : DEFAULT_POLICY.allowedModes,
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
}): EmployeeIntelligencePolicy {
  const defaultMode = intelligenceModeFromModelMode(params.modelMode);
  const browserAccess =
    params.browserAccess ??
    (params.roleKey === "research" ? "research_only" : "none");

  return normalizeIntelligencePolicy({
    defaultMode,
    allowedModes: ["efficient", "balanced", "strong", "long_context", "coding"].includes(defaultMode)
      ? [defaultMode, "balanced", "efficient"]
      : DEFAULT_POLICY.allowedModes,
    routingPreference: "auto",
    browserAccess,
    workHourProfile: params.workHourProfile ?? "moderate",
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
  return `${INTELLIGENCE_MODE_LABELS[policy.defaultMode as IntelligenceMode] ?? "Balanced"} intelligence`;
}

export function formatIntelligencePolicyLines(
  policy: EmployeeIntelligencePolicy,
): Array<{ label: string; value: string }> {
  const normalized = normalizeIntelligencePolicy(policy);
  const mode = normalized.defaultMode as IntelligenceMode;
  const routing = normalizeRoutingPreference(normalized.routingPreference);
  const workHourProfile = normalizeWorkHourProfile(normalized.workHourProfile);
  const browserAccess = normalizeBrowserAccess(normalized.browserAccess);

  return [
    {
      label: "Intelligence",
      value: INTELLIGENCE_MODE_LABELS[mode],
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
}

export function applyIntelligencePolicyUpdate(
  current: Pick<AIEmployee, "intelligencePolicy" | "modelMode" | "roleKey">,
  patch: Partial<EmployeeIntelligencePolicy>,
): { intelligencePolicy: EmployeeIntelligencePolicy; modelMode: ModelMode } {
  const intelligencePolicy = normalizeIntelligencePolicy(
    { ...resolveEmployeeIntelligencePolicy(current), ...patch },
    { modelMode: current.modelMode, roleKey: current.roleKey },
  );
  return {
    intelligencePolicy,
    modelMode: intelligencePolicyToLegacyModelMode(intelligencePolicy),
  };
}
