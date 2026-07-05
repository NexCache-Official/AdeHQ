import {
  defaultModelModeForRole,
  resolveModel,
  type ModelMode,
} from "@/lib/ai/model-catalog";
import type { EmployeeRoleKey } from "@/lib/types";
import { tierBadgeLabel } from "./candidate-display";
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
    return `Fast first-pass work on ${brief.domain.toLowerCase()} — great for drafts and routine checks.`;
  }
  if (tier === "premium") {
    return `Deep reasoning for complex ${brief.domain.toLowerCase()} decisions with lower weekly capacity.`;
  }
  return `Balanced quality, capacity, and planning for day-to-day ${brief.roleTitle.toLowerCase()} work.`;
}

function defaultStrengths(tier: CandidateTier, brief: AiEmployeeJobBrief): string[] {
  if (brief.technicalFocus.length > 0) {
    if (tier === "high_capacity")
      return ["Quick performance scans", "Fast optimization drafts", "Routine latency checks"];
    if (tier === "premium")
      return ["Complex architecture tradeoffs", "Deep performance strategy", "Executive-grade reasoning"];
    return ["Practical optimization planning", "Technical reasoning", "Structured follow-through"];
  }
  if (tier === "high_capacity")
    return ["High-volume output", "Fast follow-ups", "Quick first drafts"];
  if (tier === "premium")
    return ["Strategic depth", "Senior stakeholder messaging", "Complex problem framing"];
  return ["Balanced quality and capacity", "Clear communication", "Reliable day-to-day output"];
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
    | "name"
    | "title"
    | "personalityTags"
    | "strengths"
    | "watchOuts"
    | "bestFor"
    | "whyThisCandidate"
    | "candidatePitch"
    | "howIWork"
    | "communicationStyle"
    | "autonomyLevel"
    | "proactivityLevel"
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
  sessionScope?: string,
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
    id: sessionScope ? `${sessionScope}:${tier}` : tier,
    tier,
    name,
    first,
    title,
    roleKey: roleKey ?? undefined,
    roleTitle: brief.roleTitle,
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
        ? ["energetic", "practical", "fast-moving", "direct"]
        : tier === "premium"
          ? ["analytical", "senior", "thoughtful", "precise"]
          : ["pragmatic", "balanced", "collaborative", "reliable"]),
    candidatePitch:
      copy?.candidatePitch ??
      (tier === "high_capacity"
        ? `Best for fast ${brief.roleTitle.toLowerCase()} work — clear goals, quick updates, practical delivery.`
        : tier === "premium"
          ? `Strongest when ${brief.domain.toLowerCase()} work needs senior judgment and careful tradeoffs.`
          : `Strong fit for day-to-day ${brief.roleTitle.toLowerCase()} work — reliable delivery without overcomplicating things.`),
    howIWork:
      copy?.howIWork ??
      (tier === "high_capacity"
        ? [
            "Short implementation loops",
            "Lightweight status updates",
            "Asks before risky changes",
          ]
        : tier === "premium"
          ? [
              "Frames decisions before deep execution",
              "Summarizes tradeoffs clearly",
              "Prefers fewer, higher-quality tasks",
            ]
          : [
              "Short implementation loops",
              "Asks before risky changes",
              "Summarizes decisions clearly",
            ]),
    communicationStyle:
      copy?.communicationStyle ??
      (tier === "premium" ? "Clear and executive-ready" : "Concise and collaborative"),
    autonomyLevel:
      copy?.autonomyLevel ?? (tier === "premium" ? "high" : tier === "high_capacity" ? "balanced" : "balanced"),
    proactivityLevel: copy?.proactivityLevel ?? (tier === "high_capacity" ? "high" : "balanced"),
    grad: TIER_GRADS[tier],
    badge: tierBadgeLabel(tier),
    badgeKind: tier === "recommended" ? "rec" : "neutral",
    cap: TIER_CAP[tier],
  };
}

export function generateDeterministicCandidates(
  brief: AiEmployeeJobBrief,
  departmentId: string | null,
  roleKey?: string | null,
  copies?: Partial<Record<CandidateTier, ApplicantCopy>>,
  sessionScope?: string,
): AiEmployeeApplicant[] {
  const tiers: CandidateTier[] = ["high_capacity", "recommended", "premium"];
  return tiers.map((tier) =>
    buildDeterministicApplicant(
      tier,
      brief,
      departmentId,
      roleKey,
      copies?.[tier] ?? personaCopy(tier, roleKey),
      sessionScope,
    ),
  );
}
