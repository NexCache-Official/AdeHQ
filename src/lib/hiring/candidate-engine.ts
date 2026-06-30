import {
  defaultModelModeForRole,
  resolveModel,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import type { EmployeeRoleKey } from "@/lib/types";
import type { AiEmployeeApplicant, AiEmployeeJobBrief, CandidateTier } from "./types";
import { getRoleByKey } from "./role-library";
import { hiringRoleToEmployeeRoleKey } from "./map-candidate";

const TIER_GRADS: Record<CandidateTier, string> = {
  high_capacity: "linear-gradient(135deg,#fbbf24,#f97316 55%,#ef4444)",
  recommended: "linear-gradient(135deg,#6366f1,#3b82f6 55%,#8b5cf6)",
  premium: "linear-gradient(135deg,#64748b,#7c3aed 65%,#1e293b)",
};

const TIER_ENGINE: Record<CandidateTier, string> = {
  high_capacity: "Efficient Intelligence",
  recommended: "Balanced Intelligence",
  premium: "Strong Intelligence",
};

const TIER_HOURS: Record<CandidateTier, number> = {
  high_capacity: 120,
  recommended: 80,
  premium: 30,
};

const TIER_CAP: Record<CandidateTier, number> = {
  high_capacity: 0.96,
  recommended: 0.66,
  premium: 0.27,
};

function tierModelMode(tier: CandidateTier, roleKey: EmployeeRoleKey): ModelMode {
  if (tier === "high_capacity") {
    return roleKey === "engineering" || roleKey === "gamedev" ? "cheap" : "cheap";
  }
  if (tier === "recommended") {
    return defaultModelModeForRole(roleKey);
  }
  return roleKey === "engineering" || roleKey === "gamedev" ? "strong" : "strong";
}

function tierMetrics(tier: CandidateTier) {
  if (tier === "high_capacity") {
    return {
      quality: "standard" as const,
      speed: "fast" as const,
      costIntensity: "low" as const,
      qualityLevel: 1,
      speedLevel: 3,
      costLevel: 1,
    };
  }
  if (tier === "premium") {
    return {
      quality: "premium" as const,
      speed: "slower" as const,
      costIntensity: "high" as const,
      qualityLevel: 3,
      speedLevel: 1,
      costLevel: 3,
    };
  }
  return {
    quality: "high" as const,
    speed: "standard" as const,
    costIntensity: "medium" as const,
    qualityLevel: 2,
    speedLevel: 2,
    costLevel: 2,
  };
}

function defaultNames(brief: AiEmployeeJobBrief, tier: CandidateTier): { name: string; title: string } {
  const isEng = brief.technicalFocus.length > 0 || brief.roleTitle.toLowerCase().includes("engineer");
  if (isEng) {
    if (tier === "high_capacity") return { name: "Leo Grant", title: "AI Systems Optimization Assistant" };
    if (tier === "premium") return { name: "Adrian Vale", title: "Senior AI Performance Architect" };
    return { name: "Maya Chen", title: "Enterprise AI Performance Engineer" };
  }
  if (tier === "high_capacity") return { name: "Nova Reed", title: `Fast ${brief.roleTitle} Assistant` };
  if (tier === "premium") return { name: "Marcus Vale", title: `Senior ${brief.roleTitle}` };
  return { name: "Eleanor Price", title: brief.roleTitle };
}

function defaultWhy(tier: CandidateTier, brief: AiEmployeeJobBrief): string {
  if (tier === "high_capacity") {
    return `High capacity for quick first-pass work on ${brief.domain.toLowerCase()} — great for routine checks and fast drafts.`;
  }
  if (tier === "premium") {
    return `Premium tier for complex ${brief.domain.toLowerCase()} decisions — deeper reasoning with lower weekly capacity.`;
  }
  return `Recommended because this role needs balanced technical reasoning, enough weekly capacity, and reliable structured planning.`;
}

function defaultStrengths(tier: CandidateTier, brief: AiEmployeeJobBrief): string[] {
  if (brief.technicalFocus.length > 0) {
    if (tier === "high_capacity")
      return ["Quick performance scans", "Fast optimization drafts", "Routine latency checks", "High-volume analysis"];
    if (tier === "premium")
      return ["Complex architecture tradeoffs", "Deep performance strategy", "Executive-grade technical reasoning", "Risk-aware optimization"];
    return ["Practical optimization planning", "Technical reasoning", "Balanced recommendations", "Structured follow-through"];
  }
  if (tier === "high_capacity")
    return ["High-volume output", "Fast follow-ups", "Quick first drafts", "Energetic execution"];
  if (tier === "premium")
    return ["Strategic depth", "Senior stakeholder messaging", "Complex problem framing", "High-risk review"];
  return ["Balanced quality and capacity", "Professional communication", "Reliable day-to-day output", "Clear next steps"];
}

function defaultWatchOuts(tier: CandidateTier): string[] {
  if (tier === "high_capacity")
    return ["Less strategic depth", "Needs review for senior stakeholders"];
  if (tier === "premium")
    return ["Lower weekly capacity", "Higher cost intensity"];
  return ["May escalate highly complex decisions", "Not the deepest specialist on every edge case"];
}

export type ApplicantCopy = Partial<
  Pick<
    AiEmployeeApplicant,
    "name" | "title" | "personalityTags" | "strengths" | "watchOuts" | "bestFor" | "whyThisCandidate"
  >
>;

function personaCopy(
  tier: CandidateTier,
  roleKey?: string | null,
): ApplicantCopy | undefined {
  const role = getRoleByKey(roleKey ?? undefined);
  if (!role) return undefined;
  const persona = role.candidatePersonas[tier];
  return {
    title: persona.title,
    strengths: persona.strengths,
    bestFor: persona.bestFor,
    whyThisCandidate: persona.whyRecommended ?? persona.bestFor,
  };
}

export function buildDeterministicApplicant(
  tier: CandidateTier,
  brief: AiEmployeeJobBrief,
  departmentId: string | null,
  roleKey?: string | null,
  copy?: ApplicantCopy,
): AiEmployeeApplicant {
  const employeeRoleKey = hiringRoleToEmployeeRoleKey(roleKey, departmentId);
  const modelMode = tierModelMode(tier, employeeRoleKey);
  const resolvedModelId = resolveModel("siliconflow", modelMode);
  const metrics = tierMetrics(tier);
  const personaDefaults = personaCopy(tier, roleKey);
  const defaults = defaultNames(brief, tier);
  const name = copy?.name ?? defaults.name;
  const title = copy?.title ?? personaDefaults?.title ?? defaults.title;
  const first = name.split(" ")[0] ?? name;

  return {
    id: tier,
    tier,
    name,
    first,
    title,
    modelMode,
    resolvedModelId,
    engineLabel: TIER_ENGINE[tier],
    weeklyWorkHours: TIER_HOURS[tier],
    costIntensity: metrics.costIntensity,
    speed: metrics.speed,
    quality: metrics.quality,
    qualityLevel: metrics.qualityLevel,
    speedLevel: metrics.speedLevel,
    costLevel: metrics.costLevel,
    strengths: copy?.strengths ?? personaDefaults?.strengths ?? defaultStrengths(tier, brief),
    watchOuts: copy?.watchOuts ?? defaultWatchOuts(tier),
    bestFor: copy?.bestFor ?? personaDefaults?.bestFor ?? (tier === "high_capacity"
        ? "Fast execution and high-volume work"
        : tier === "premium"
          ? `Important ${brief.domain.toLowerCase()} decisions`
          : `Day-to-day ${brief.roleTitle.toLowerCase()} work`),
    whyThisCandidate:
      copy?.whyThisCandidate ??
      personaDefaults?.whyThisCandidate ??
      defaultWhy(tier, brief),
    recommended: tier === "recommended",
    personalityTags:
      copy?.personalityTags ??
      (tier === "high_capacity"
        ? ["energetic", "practical", "fast"]
        : tier === "premium"
          ? ["analytical", "senior", "strategic"]
          : ["polished", "balanced", "reliable"]),
    grad: TIER_GRADS[tier],
    badge:
      tier === "recommended" ? "Recommended" : tier === "high_capacity" ? "High capacity" : "Premium quality",
    badgeKind: tier === "recommended" ? "rec" : "neutral",
    cap: TIER_CAP[tier],
  };
}

export function generateDeterministicCandidates(
  brief: AiEmployeeJobBrief,
  departmentId: string | null,
  roleKey?: string | null,
  copies?: Partial<Record<CandidateTier, ApplicantCopy>>,
): AiEmployeeApplicant[] {
  const tiers: CandidateTier[] = ["high_capacity", "recommended", "premium"];
  return tiers.map((tier) =>
    buildDeterministicApplicant(
      tier,
      brief,
      departmentId,
      roleKey,
      copies?.[tier] ?? personaCopy(tier, roleKey),
    ),
  );
}
