import type { KnownPlanCode, PlanEntitlements } from "./types";

/** Locked Plan Entitlement Matrix V1 — docs/billing/plan-entitlement-matrix-v1.md */
export const PLAN_ENTITLEMENT_MATRIX_V1: Record<
  Exclude<KnownPlanCode, "enterprise">,
  PlanEntitlements
> = {
  free: {
    weeklyWh: 10,
    searchEnabled: true,
    browserEnabled: true,
    voiceEnabled: true,
    imageEnabled: true,
    videoEnabled: false,
    videoRequiresApproval: false,
    maxConcurrentRuns: 1,
    maxStewardCollaborators: 0,
    maxStewardSteps: 0,
    maxAutomaticRunWh: 5,
    sharedMemoryEnabled: true,
    memoryRetentionDays: 14,
    artifactStorageBytes: 1_073_741_824,
    usageDashboardLevel: "basic",
    adminControlsLevel: "basic",
    supportLevel: "standard",
    intelligencePolicy: "standard",
    humanMembersUnlimited: true,
    aiEmployeesUnlimited: true,
  },
  pro: {
    weeklyWh: 125,
    searchEnabled: true,
    browserEnabled: true,
    voiceEnabled: true,
    imageEnabled: true,
    videoEnabled: true,
    videoRequiresApproval: true,
    maxConcurrentRuns: 3,
    maxStewardCollaborators: 2,
    maxStewardSteps: 12,
    maxAutomaticRunWh: 40,
    sharedMemoryEnabled: true,
    memoryRetentionDays: 90,
    artifactStorageBytes: 26_843_545_600,
    usageDashboardLevel: "team",
    adminControlsLevel: "basic",
    supportLevel: "standard",
    intelligencePolicy: "balanced",
    humanMembersUnlimited: true,
    aiEmployeesUnlimited: true,
  },
  team: {
    weeklyWh: 250,
    searchEnabled: true,
    browserEnabled: true,
    voiceEnabled: true,
    imageEnabled: true,
    videoEnabled: true,
    videoRequiresApproval: true,
    maxConcurrentRuns: 5,
    maxStewardCollaborators: 4,
    maxStewardSteps: 20,
    maxAutomaticRunWh: 80,
    sharedMemoryEnabled: true,
    memoryRetentionDays: 180,
    artifactStorageBytes: 107_374_182_400,
    usageDashboardLevel: "team",
    adminControlsLevel: "standard",
    supportLevel: "priority",
    intelligencePolicy: "advanced",
    humanMembersUnlimited: true,
    aiEmployeesUnlimited: true,
  },
  business: {
    weeklyWh: 650,
    searchEnabled: true,
    browserEnabled: true,
    voiceEnabled: true,
    imageEnabled: true,
    videoEnabled: true,
    videoRequiresApproval: false,
    maxConcurrentRuns: 10,
    maxStewardCollaborators: 8,
    maxStewardSteps: 40,
    maxAutomaticRunWh: 200,
    sharedMemoryEnabled: true,
    memoryRetentionDays: 365,
    artifactStorageBytes: 536_870_912_000,
    usageDashboardLevel: "advanced",
    adminControlsLevel: "advanced",
    supportLevel: "priority",
    intelligencePolicy: "advanced",
    humanMembersUnlimited: true,
    aiEmployeesUnlimited: true,
  },
};

export function parsePlanEntitlements(raw: unknown): PlanEntitlements {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const num = (k: string, d: number) => {
    const v = Number(o[k]);
    return Number.isFinite(v) ? v : d;
  };
  const bool = (k: string, d: boolean) => (typeof o[k] === "boolean" ? (o[k] as boolean) : d);
  return {
    weeklyWh: num("weeklyWh", 0),
    searchEnabled: bool("searchEnabled", true),
    browserEnabled: bool("browserEnabled", true),
    voiceEnabled: bool("voiceEnabled", false),
    imageEnabled: bool("imageEnabled", true),
    videoEnabled: bool("videoEnabled", false),
    videoRequiresApproval: bool("videoRequiresApproval", true),
    maxConcurrentRuns: num("maxConcurrentRuns", 1),
    maxStewardCollaborators: num("maxStewardCollaborators", 0),
    maxStewardSteps: num("maxStewardSteps", 0),
    maxAutomaticRunWh: num("maxAutomaticRunWh", 5),
    sharedMemoryEnabled: bool("sharedMemoryEnabled", true),
    memoryRetentionDays:
      o.memoryRetentionDays == null ? null : num("memoryRetentionDays", 14),
    artifactStorageBytes: num("artifactStorageBytes", 1_073_741_824),
    usageDashboardLevel: (["basic", "team", "advanced"].includes(String(o.usageDashboardLevel))
      ? String(o.usageDashboardLevel)
      : "basic") as PlanEntitlements["usageDashboardLevel"],
    adminControlsLevel: (["basic", "standard", "advanced"].includes(String(o.adminControlsLevel))
      ? String(o.adminControlsLevel)
      : "basic") as PlanEntitlements["adminControlsLevel"],
    supportLevel: (["standard", "priority", "dedicated"].includes(String(o.supportLevel))
      ? String(o.supportLevel)
      : "standard") as PlanEntitlements["supportLevel"],
    intelligencePolicy: (["standard", "balanced", "advanced", "custom"].includes(
      String(o.intelligencePolicy),
    )
      ? String(o.intelligencePolicy)
      : "standard") as PlanEntitlements["intelligencePolicy"],
    humanMembersUnlimited: bool("humanMembersUnlimited", true),
    aiEmployeesUnlimited: bool("aiEmployeesUnlimited", true),
    unlimited_work_hours: bool("unlimited_work_hours", false) || undefined,
  };
}
